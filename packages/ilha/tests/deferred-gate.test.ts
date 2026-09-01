import { expect, test } from "bun:test";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import { mount } from "../src/index.ts";

test("Deferred gate: parent receives value", async () => {
  const App = function* () {
    const deferred = yield* Deferred.make<string>();
    yield {
      $$ilha: 1 as const,
      type: "button",
      props: {
        id: "go",
        onclick: () => Effect.runSync(Deferred.succeed(deferred, "Ada")),
      },
      children: ["go"],
    };
    const name = yield* Deferred.await(deferred);
    yield `Hello, ${name}`;
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(20);
  el.querySelector("#go")!.dispatchEvent(new Event("click", { bubbles: true }));
  await Bun.sleep(25);
  expect(el.textContent).toContain("Hello, Ada");
  unmount();
  el.remove();
});
