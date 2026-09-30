// @jsxImportSource ../src
import { afterEach, expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";
import { ISLAND, ISLAND_MOUNT_INTERNAL } from "../src/shared.ts";

// Counts every time a live node leaves the document. Reused component, island,
// and atom hosts must stay in place across rerenders: detaching them blurs
// inputs, reloads iframes, closes modal dialogs, and re-runs custom element
// lifecycles.
const detachedProbes: Element[] = [];
customElements.define(
  "reuse-probe",
  class extends HTMLElement {
    disconnectedCallback(): void {
      detachedProbes.push(this);
    }
  }
);

afterEach(() => {
  document.body.replaceChildren();
  detachedProbes.length = 0;
});

const host = (): HTMLDivElement => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

const Probe = ({ id }: { id: string }) => (
  <p>
    <reuse-probe id={`probe-${id}`} />
    <input id={`in-${id}`} />
  </p>
);

const focusInput = (el: Element, id: string): HTMLInputElement => {
  const input = el.querySelector<HTMLInputElement>(`#in-${id}`);
  if (!input) {
    throw new Error(`input ${id} missing`);
  }
  input.focus();
  return input;
};

test("unkeyed child stays attached when its parent rerenders", async () => {
  let bump: (() => void) | undefined;
  const Parent = () => {
    const tick = atom(0);
    bump = () => tick.update((n) => n + 1);
    return (
      <div>
        <span>{tick()}</span>
        <section>
          <Probe id="a" />
        </section>
      </div>
    );
  };
  const el = host();
  mount(el, Parent);
  await Bun.sleep(10);
  const input = focusInput(el, "a");
  bump?.();
  await Bun.sleep(10);
  expect(el.querySelector("span")?.textContent).toBe("1");
  expect(el.querySelector("#in-a")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(detachedProbes.length).toBe(0);
});

test("keyed children in an element stay attached on insert and remove", async () => {
  let setItems: ((ids: string[]) => void) | undefined;
  const App = () => {
    const items = atom(["a", "b", "c"]);
    setItems = (ids) => items.set(ids);
    return (
      <ul>
        {items().map((id) => (
          <Probe key={id} id={id} />
        ))}
      </ul>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  const input = focusInput(el, "b");
  setItems?.(["a", "b", "c", "d"]);
  await Bun.sleep(10);
  setItems?.(["z", "a", "b", "c", "d"]);
  await Bun.sleep(10);
  setItems?.(["b", "c", "d"]);
  await Bun.sleep(10);
  expect(el.querySelectorAll("input").length).toBe(3);
  expect(el.querySelector("#in-b")).toBe(input);
  expect(document.activeElement).toBe(input);
  // Only the removed rows (z, a) leave the document.
  expect(detachedProbes.length).toBe(2);
});

test("keyed list returned from a component stays attached", async () => {
  let setItems: ((ids: string[]) => void) | undefined;
  const List = () => {
    const items = atom(["a", "b"]);
    setItems = (ids) => items.set(ids);
    return items().map((id) => <Probe key={id} id={id} />);
  };
  const el = host();
  mount(el, () => (
    <main>
      <List />
    </main>
  ));
  await Bun.sleep(10);
  const input = focusInput(el, "b");
  setItems?.(["a", "b", "c"]);
  await Bun.sleep(10);
  setItems?.(["x", "a", "b", "c"]);
  await Bun.sleep(10);
  setItems?.(["b", "c"]);
  await Bun.sleep(10);
  expect(el.querySelector("#in-b")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(detachedProbes.length).toBe(2);
});

test("reordering a keyed list keeps focus and caret", async () => {
  let setItems: ((ids: string[]) => void) | undefined;
  const List = () => {
    const items = atom(["a", "b", "c"]);
    setItems = (ids) => items.set(ids);
    return items().map((id) => <Probe key={id} id={id} />);
  };
  const el = host();
  mount(el, () => (
    <main>
      <List />
    </main>
  ));
  await Bun.sleep(10);
  const input = focusInput(el, "b");
  input.value = "hello";
  input.setSelectionRange(2, 3);
  setItems?.(["c", "b", "a"]);
  await Bun.sleep(10);
  expect(
    [...el.querySelectorAll("input")].map((i) => i.id.slice(3)).join("")
  ).toBe("cba");
  expect(el.querySelector("#in-b")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 3]);
});

test("keyed plain elements stay attached when the head is removed", async () => {
  let setItems: ((ids: string[]) => void) | undefined;
  const App = () => {
    const items = atom(["a", "b", "c"]);
    setItems = (ids) => items.set(ids);
    return (
      <ul>
        {items().map((id) => (
          <li key={id}>
            <reuse-probe />
            <input id={`in-${id}`} />
          </li>
        ))}
      </ul>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  const input = focusInput(el, "c");
  setItems?.(["b", "c"]);
  await Bun.sleep(10);
  expect(el.querySelector("#in-c")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(detachedProbes.length).toBe(1);
});

test("atom hole host stays attached when its parent rerenders", async () => {
  let bump: (() => void) | undefined;
  const App = () => {
    const tick = atom(0);
    const body = atom(<Probe id="atom" />);
    bump = () => tick.update((n) => n + 1);
    return (
      <div>
        <span>{tick()}</span>
        {body}
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  const input = focusInput(el, "atom");
  bump?.();
  await Bun.sleep(10);
  expect(el.querySelector("span")?.textContent).toBe("1");
  expect(el.querySelector("#in-atom")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(detachedProbes.length).toBe(0);
});

test("island host stays attached and receives new props", async () => {
  const seen: unknown[] = [];
  const Island = Object.assign(() => null, {
    [ISLAND]: true,
    [ISLAND_MOUNT_INTERNAL]: (el: Element, props?: { n?: number }) => {
      el.append(document.createElement("reuse-probe"));
      seen.push(props?.n);
      return {
        updateProps: (next?: { n?: number }) => {
          seen.push(next?.n);
        },
      };
    },
  });
  let bump: (() => void) | undefined;
  const App = () => {
    const tick = atom(0);
    bump = () => tick.update((n) => n + 1);
    return (
      <div>
        <span>{tick()}</span>
        <Island n={tick()} />
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  const islandHost = el.querySelector("[data-ilha]");
  bump?.();
  await Bun.sleep(10);
  expect(el.querySelector("[data-ilha]")).toBe(islandHost);
  expect(seen).toEqual([0, 1]);
  expect(detachedProbes.length).toBe(0);
});

test("keyed element list returned from a component keeps live rows", async () => {
  let setItems: ((ids: string[]) => void) | undefined;
  const List = () => {
    const items = atom(["a", "b"]);
    setItems = (ids) => items.set(ids);
    return items().map((id) => (
      <li key={id}>
        <reuse-probe />
        <input id={`in-${id}`} />
      </li>
    ));
  };
  const el = host();
  mount(el, () => (
    <ul>
      <List />
    </ul>
  ));
  await Bun.sleep(10);
  const input = focusInput(el, "b");
  input.value = "typed";
  setItems?.(["a", "b", "c"]);
  await Bun.sleep(10);
  setItems?.(["x", "a", "b", "c"]);
  await Bun.sleep(10);
  setItems?.(["b", "c"]);
  await Bun.sleep(10);
  expect(el.querySelector("#in-b")).toBe(input);
  expect(input.value).toBe("typed");
  expect(document.activeElement).toBe(input);
  // Only the removed rows (x, a) leave the document.
  expect(detachedProbes.length).toBe(2);
});
