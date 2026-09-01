import { expect, test } from "bun:test";

import { atom, mount, wait } from "../src/index.ts";

test("wait done: parent receives value", async () => {
  const App = function* () {
    const name = yield* wait<string>(function* (done) {
      const draft = atom("Ada");
      yield {
        $$ilha: 1 as const,
        type: "button",
        props: { id: "go", onclick: () => done(draft()) },
        children: ["go"],
      };
    });
    yield `Hello, ${name}`;
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  el.querySelector("#go")!.dispatchEvent(new Event("click", { bubbles: true }));
  await Bun.sleep(10);
  expect(el.textContent).toContain("Hello, Ada");
  unmount();
  el.remove();
});
