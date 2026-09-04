import { expect, test } from "bun:test";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import { mount } from "../src/index.ts";

const App = function* App() {
  const deferred = yield* Deferred.make<string>();
  yield {
    $$ilha: 1 as const,
    children: ["go"],
    props: {
      id: "go",
      onclick: () => Effect.runSync(Deferred.succeed(deferred, "Ada")),
    },
    type: "button",
  };
  const name = yield* Deferred.await(deferred);
  yield `Hello, ${name}`;
};

test("Deferred gate: parent receives value", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(20);
  const go = el.querySelector("#go");
  if (!go) {
    throw new Error("#go missing");
  }
  go.dispatchEvent(new Event("click", { bubbles: true }));
  await Bun.sleep(25);
  expect(el.textContent).toContain("Hello, Ada");
  unmount();
  el.remove();
});
