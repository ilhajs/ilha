// @jsxImportSource ../src
import { afterEach, expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";

// A rerender materializes fresh elements and morphs them onto the live ones.
// Everything the render binds (handlers, refs, value atoms) must end up on the
// live element the morph keeps, not on the discarded scratch copy.

afterEach(() => {
  document.body.replaceChildren();
});

const host = (): HTMLDivElement => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

const byId = <T extends Element>(root: Element, id: string): T => {
  const el = root.querySelector<T>(`#${id}`);
  if (!el) {
    throw new Error(`#${id} missing`);
  }
  return el;
};

test("event handlers see the latest render's closure", async () => {
  const seen: number[] = [];
  let bump: (() => void) | undefined;
  const App = () => {
    const tick = atom(0);
    bump = () => tick.update((n) => n + 1);
    const n = tick();
    return (
      <button id="b" type="button" onclick={() => seen.push(n)}>
        {n}
      </button>
    );
  };
  const el = host();
  mount(el, () => (
    <main>
      <App />
    </main>
  ));
  await Bun.sleep(10);
  bump?.();
  await Bun.sleep(10);
  byId<HTMLButtonElement>(el, "b").click();
  expect(seen).toEqual([1]);
});

test("a handler added on a later render fires", async () => {
  const seen: string[] = [];
  let arm: (() => void) | undefined;
  const App = () => {
    const armed = atom(false);
    arm = () => armed.set(true);
    const handlers = armed() ? { onclick: () => seen.push("click") } : {};
    return (
      <div>
        <button id="b" type="button" {...handlers}>
          go
        </button>
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  byId<HTMLButtonElement>(el, "b").click();
  arm?.();
  await Bun.sleep(10);
  byId<HTMLButtonElement>(el, "b").click();
  expect(seen).toEqual(["click"]);
});

test("a handler removed on a later render stops firing", async () => {
  const seen: string[] = [];
  let disarm: (() => void) | undefined;
  const App = () => {
    const armed = atom(true);
    disarm = () => armed.set(false);
    const handlers = armed() ? { onclick: () => seen.push("click") } : {};
    return (
      <div>
        <button id="b" type="button" {...handlers}>
          go
        </button>
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  disarm?.();
  await Bun.sleep(10);
  byId<HTMLButtonElement>(el, "b").click();
  expect(seen).toEqual([]);
});

test("ref receives the live element after a rerender", async () => {
  const refs: (Element | null)[] = [];
  let bump: (() => void) | undefined;
  const App = () => {
    const tick = atom(0);
    bump = () => tick.update((n) => n + 1);
    return (
      <div>
        <span>{tick()}</span>
        <input id="r" ref={(node: Element | null) => refs.push(node)} />
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  bump?.();
  await Bun.sleep(10);
  const input = byId(el, "r");
  expect(refs).toEqual([input, null, input]);
  expect(input.isConnected).toBe(true);
});

test("a value atom keeps driving the input after a rerender", async () => {
  let setText: ((next: string) => void) | undefined;
  let bump: (() => void) | undefined;
  const App = () => {
    const tick = atom(0);
    const text = atom("init");
    setText = (next) => text.set(next);
    bump = () => tick.update((n) => n + 1);
    return (
      <div>
        <span>{tick()}</span>
        <input id="v" value={text} />
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  bump?.();
  await Bun.sleep(10);
  setText?.("changed");
  await Bun.sleep(10);
  expect(byId<HTMLInputElement>(el, "v").value).toBe("changed");
});

test("a value atom on the root element survives a rerender", async () => {
  let setText: ((next: string) => void) | undefined;
  let bump: (() => void) | undefined;
  const App = () => {
    const tick = atom(0);
    const text = atom("init");
    setText = (next) => text.set(next);
    bump = () => tick.update((n) => n + 1);
    return <input id="v" value={text} data-tick={tick()} />;
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  bump?.();
  await Bun.sleep(10);
  setText?.("changed");
  await Bun.sleep(10);
  expect(byId<HTMLInputElement>(el, "v").value).toBe("changed");
});

test("uncontrolled contenteditable keeps the user's content", async () => {
  let bump: (() => void) | undefined;
  const App = () => {
    const tick = atom(0);
    bump = () => tick.update((n) => n + 1);
    return (
      <div>
        <span>{tick()}</span>
        <div id="ce" contenteditable="true" />
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  const editor = byId(el, "ce");
  editor.append("typed by the user");
  bump?.();
  await Bun.sleep(10);
  expect(byId(el, "ce")).toBe(editor);
  expect(editor.textContent).toBe("typed by the user");
});

test("controlled contenteditable follows the render", async () => {
  let setText: ((next: string) => void) | undefined;
  const App = () => {
    const text = atom("a");
    setText = (next) => text.set(next);
    return (
      <div>
        <div id="ce" contenteditable="true">
          {text()}
        </div>
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  setText?.("b");
  await Bun.sleep(10);
  expect(byId(el, "ce").textContent).toBe("b");
});

test("a ref-wrapped vanilla library lives on the node in the document", async () => {
  // The "Wrap a vanilla library" pattern from the render guide.
  const built: Element[] = [];
  const MapView = () => {
    let map: { destroy: () => void } | null = null;
    return (
      <div
        class="map"
        ref={(node: Element | null) => {
          if (node) {
            node.append(document.createElement("canvas"));
            built.push(node);
            map = { destroy: () => node.replaceChildren() };
          } else {
            map?.destroy();
            map = null;
          }
        }}
      />
    );
  };
  let bump: (() => void) | undefined;
  const App = () => {
    const tick = atom(0);
    bump = () => tick.update((n) => n + 1);
    return (
      <div>
        <span>{tick()}</span>
        <MapView />
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  bump?.();
  await Bun.sleep(10);
  const live = el.querySelector(".map");
  expect(built.every((node) => node === live)).toBe(true);
  expect(live?.querySelectorAll("canvas").length).toBe(1);
});

test("data-morph-preserve children keeps a library's DOM across rerenders", async () => {
  let bump: (() => void) | undefined;
  const App = () => {
    const tick = atom(0);
    bump = () => tick.update((n) => n + 1);
    return (
      <div>
        <div
          id="chart"
          class={`chart tick-${tick()}`}
          data-morph-preserve="children"
        >
          <p>loading</p>
        </div>
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  const chart = byId(el, "chart");
  // The first paint seeds the placeholder; the library then takes over.
  expect(chart.textContent).toBe("loading");
  const canvas = document.createElement("canvas");
  chart.replaceChildren(canvas);
  bump?.();
  await Bun.sleep(10);
  expect(byId(el, "chart")).toBe(chart);
  expect(chart.className).toBe("chart tick-1");
  expect([...chart.childNodes]).toEqual([canvas]);
});

test("data-morph-preserve children composes with attribute names", async () => {
  let bump: (() => void) | undefined;
  const App = () => {
    const tick = atom(0);
    bump = () => tick.update((n) => n + 1);
    return (
      <div>
        <div
          id="w"
          title="rendered"
          data-tick={tick()}
          data-morph-preserve="title children"
        />
      </div>
    );
  };
  const el = host();
  mount(el, App);
  await Bun.sleep(10);
  const widget = byId(el, "w");
  widget.title = "live";
  widget.append("owned by a widget");
  bump?.();
  await Bun.sleep(10);
  expect(widget.title).toBe("live");
  expect(widget.dataset.tick).toBe("1");
  expect(widget.textContent).toBe("owned by a widget");
});
