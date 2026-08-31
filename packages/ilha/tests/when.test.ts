import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";

import { atom, mount, when } from "../src/index.ts";

test("when interrupt: stale body does not paint", async () => {
  const order: string[] = [];
  const App = function* () {
    yield* when(Stream.fromIterable(["a", "b"]), function* (q) {
      order.push(`start:${q}`);
      yield Effect.sleep(q === "a" ? 40 : 5);
      order.push(`done:${q}`);
      yield `hit:${q}`;
    });
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(80);
  expect(el.textContent).toContain("hit:b");
  expect(order.includes("done:b")).toBe(true);
  unmount();
  el.remove();
});

test("when debounce: only last query remains", async () => {
  const App = function* () {
    const query = atom("");
    yield {
      $$ilha: 1 as const,
      type: "div",
      props: {},
      children: [
        {
          $$ilha: 1 as const,
          type: "input",
          props: {
            value: query,
            oninput: (e: Event) => query.set((e.currentTarget as HTMLInputElement).value),
          },
          children: [],
        },
        function* () {
          yield* when(Atom.toStream(query.atom).pipe(Stream.debounce(30)), function* (q) {
            if (!q) {
              yield "empty";
              return;
            }
            yield Effect.sleep(20);
            yield `hit:${q}`;
          });
        },
      ],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(5);
  const input = el.querySelector("input")!;
  input.value = "a";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await Bun.sleep(10);
  input.value = "ab";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await Bun.sleep(80);
  expect(el.textContent).toContain("hit:ab");
  expect(el.textContent?.includes("hit:a") && !el.textContent?.includes("hit:ab")).toBe(false);
  el.remove();
});

test("when re-yields same-tag vnode children", async () => {
  const App = function* () {
    yield* when(Stream.fromIterable(["q"]), function* (query) {
      yield {
        $$ilha: 1 as const,
        type: "p",
        props: {},
        children: [`searching ${query}`],
      };
      yield Effect.sleep(20);
      yield {
        $$ilha: 1 as const,
        type: "p",
        props: {},
        children: [`result for ${query}`],
      };
    });
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(10);
  expect(el.textContent).toContain("searching q");
  await Bun.sleep(40);
  expect(el.textContent).toContain("result for q");
  expect(el.textContent).not.toContain("searching");
  el.remove();
});
