import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";

import { atom, mount, when } from "../src/index.ts";

test("when interrupt: stale body does not paint", async () => {
  const order: string[] = [];
  const App = function* App() {
    yield* when(Stream.fromIterable(["a", "b"]), function* body(q) {
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

const DebounceApp = function* DebounceApp() {
  const query = atom("");
  yield {
    $$ilha: 1 as const,
    children: [
      {
        $$ilha: 1 as const,
        children: [],
        props: {
          oninput: (e: Event) => {
            const target = e.currentTarget;
            // SAFETY: oninput is bound to the input element painted above.
            query.set((target as HTMLInputElement).value);
          },
          value: query,
        },
        type: "input",
      },
      function* whenSlot() {
        yield* when(
          Atom.toStream(query.atom).pipe(Stream.debounce(30)),
          function* whenBody(q) {
            if (!q) {
              yield "empty";
              return;
            }
            yield Effect.sleep(20);
            yield `hit:${q}`;
          }
        );
      },
    ],
    props: {},
    type: "div",
  };
};

test("when debounce: only last query remains", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, DebounceApp);
  await Bun.sleep(5);
  const input = el.querySelector("input");
  if (!input) {
    throw new Error("input missing");
  }
  input.value = "a";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await Bun.sleep(10);
  input.value = "ab";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await Bun.sleep(80);
  expect(el.textContent).toContain("hit:ab");
  expect(
    el.textContent?.includes("hit:a") && !el.textContent?.includes("hit:ab")
  ).toBe(false);
  el.remove();
});

const ReYieldApp = function* ReYieldApp() {
  yield* when(Stream.fromIterable(["q"]), function* searchBody(query) {
    yield {
      $$ilha: 1 as const,
      children: [`searching ${query}`],
      props: {},
      type: "p",
    };
    yield Effect.sleep(20);
    yield {
      $$ilha: 1 as const,
      children: [`result for ${query}`],
      props: {},
      type: "p",
    };
  });
};

test("when re-yields same-tag vnode children", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, ReYieldApp);
  await Bun.sleep(10);
  expect(el.textContent).toContain("searching q");
  await Bun.sleep(40);
  expect(el.textContent).toContain("result for q");
  expect(el.textContent).not.toContain("searching");
  el.remove();
});
