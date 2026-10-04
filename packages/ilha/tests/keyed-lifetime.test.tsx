// @jsxImportSource ../src
import { expect, spyOn, test } from "bun:test";

import { atom, mount, watch } from "../src/index.ts";

const events: string[] = [];

const Row = ({ id }: { id?: unknown }) => {
  const n = atom(0);
  watch.once(() => {
    events.push(`mount:${String(id)}`);
    return () => {
      events.push(`unmount:${String(id)}`);
    };
  });
  return (
    <button
      class={`row-${String(id)}`}
      onclick={() => n.update((x: number) => x + 1)}
    >
      {String(id)}:{n}
    </button>
  );
};

const button = (el: Element, selector: string): HTMLButtonElement => {
  const found = el.querySelector(selector);
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`${selector} missing`);
  }
  return found;
};

const ToggleApp = () => {
  const show = atom(true);
  return (
    <div>
      <button class="toggle" onclick={() => show.update((v: boolean) => !v)}>
        {show() ? "on" : "off"}
      </button>
      {show() ? <Row key="a" id="a" /> : null}
    </div>
  );
};

test("a keyed component the view drops is unmounted, not kept alive", async () => {
  events.length = 0;
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ToggleApp);
  await Bun.sleep(10);

  button(el, ".row-a").click();
  await Bun.sleep(10);
  expect(el.textContent).toContain("a:1");

  button(el, ".toggle").click();
  await Bun.sleep(10);
  expect(events).toEqual(["mount:a", "unmount:a"]);

  // The key returns as a new component: fresh state, mounted again.
  button(el, ".toggle").click();
  await Bun.sleep(10);
  expect(el.textContent).toContain("a:0");
  expect(events).toEqual(["mount:a", "unmount:a", "mount:a"]);

  unmount();
  el.remove();
});

const TickApp = () => {
  const tick = atom(0);
  return (
    <div>
      <button class="bump" onclick={() => tick.update((x: number) => x + 1)}>
        {tick}
      </button>
      <Row key="a" id="a" />
    </div>
  );
};

test("a keyed component keeps its state while the view keeps it", async () => {
  events.length = 0;
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, TickApp);
  await Bun.sleep(10);

  const before = button(el, ".row-a");
  before.click();
  await Bun.sleep(10);
  button(el, ".bump").click();
  await Bun.sleep(10);
  button(el, ".bump").click();
  await Bun.sleep(10);

  expect(el.textContent).toContain("a:1");
  expect(button(el, ".row-a")).toBe(before);
  expect(events).toEqual(["mount:a"]);

  unmount();
  el.remove();
});

const DuplicateApp = () => {
  const tick = atom(0);
  return (
    <div>
      <button class="bump" onclick={() => tick.update((x: number) => x + 1)}>
        {tick}
      </button>
      <ul class="first">
        <Row key="dup" id="one" />
      </ul>
      <ul class="second">
        <Row key="dup" id="two" />
      </ul>
    </div>
  );
};

test("a key used twice in one component warns and renders both", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, DuplicateApp);
  await Bun.sleep(10);

  expect(el.querySelector(".first")?.textContent).toBe("one:0");
  expect(el.querySelector(".second")?.textContent).toBe("two:0");

  button(el, ".row-two").click();
  await Bun.sleep(10);
  button(el, ".bump").click();
  await Bun.sleep(10);

  // Both survive the repaint, each in its own list, with its own state.
  expect(el.querySelector(".first")?.textContent).toBe("one:0");
  expect(el.querySelector(".second")?.textContent).toBe("two:1");
  expect(
    warn.mock.calls.filter((call) => String(call[0]).includes('key "dup"'))
  ).toHaveLength(1);

  warn.mockRestore();
  unmount();
  el.remove();
});
