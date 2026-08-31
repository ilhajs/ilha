/** @jsxImportSource ../src */
import { expect, test } from "bun:test";

import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type { AtomHandle } from "ilha";

import { atom, h, mount, renderToString } from "../src/index.ts";

test("renderToString takes only the first stream value", async () => {
  const html = await renderToString(() =>
    Stream.map(Stream.fromIterable([1, 2, 3]), (n: number) => h("li", null, `item-${n}`)),
  );
  expect(html).toContain("item-1");
  expect(html).not.toContain("item-2");
});

test("renderToString paints stream failure as text", async () => {
  const html = await renderToString(() => Stream.fail("boom") as never);
  expect(html).toContain("boom");
});

test("stream view repaints on each emission on the client", async () => {
  let source: AtomHandle<string> | undefined;
  const App = function* () {
    const s = atom("first");
    source ??= s;
    yield Stream.map(Atom.toStream(s.atom), (value: string) => h("p", null, value));
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(10);
  expect(el.textContent).toContain("first");
  source!.set("second");
  await Bun.sleep(10);
  expect(el.textContent).toContain("second");
  expect(el.textContent).not.toContain("first");
  unmount();
  el.remove();
});

test("live list via Atom.toStream repaints on update", async () => {
  let items: AtomHandle<string[]> | undefined;
  const App = function* () {
    const list = atom(["a", "b"]);
    items ??= list;
    yield Stream.map(Atom.toStream(list.atom), (values: string[]) => (
      <ul>
        {values.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    ));
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(10);
  expect(el.textContent).toContain("ab");
  items!.update((list) => [...list, "c"]);
  await Bun.sleep(10);
  expect(el.textContent).toContain("abc");
  items!.update((list) => list.filter((item) => item !== "a"));
  await Bun.sleep(10);
  expect(el.textContent).toContain("bc");
  expect(el.textContent).not.toContain("a");
  unmount();
  el.remove();
});

test("keyed function children in a stream hole reuse their fiber", async () => {
  let items: AtomHandle<string[]> | undefined;
  const built: string[] = [];
  let seq = 0;
  const Row = (props: Record<string, unknown>) => {
    const id = props.id as string;
    const stamp = `row-${id}-${seq++}`;
    built.push(stamp);
    return <li data-stamp={stamp}>{id}</li>;
  };
  const App = function* () {
    const list = atom(["a", "b"]);
    items ??= list;
    // Emit a keyed array so the hole reuses per-key fibers.
    yield Stream.map(Atom.toStream(list.atom), (values: string[]) =>
      values.map((id) => <Row key={id} id={id} />),
    );
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(10);
  expect(built).toHaveLength(2);
  items!.update(() => ["b", "a", "c"]);
  await Bun.sleep(10);
  // a and b fibers are reused; only c is new
  expect(built).toHaveLength(3);
  expect(el.textContent).toContain("bac");
  unmount();
  el.remove();
});
