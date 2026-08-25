import { expect, test } from "bun:test";

import { action, effect, ilha, html } from "./index";
import "../happydom.ts";

test("actions/effect.once keep first-render closures (mount-time captures stay valid)", async () => {
  const seen: string[] = [];
  const App = ilha<{ label: string }>(({ label }) => {
    let host: Element | null = null;
    const ping = action((v: string) => seen.push(`${v}:${label}:${!!host}`));
    effect.once(({ host: h }) => {
      host = h;
    });
    return html`<button onclick=${() => ping("x")}>go</button>`;
  });
  const el = document.createElement("div");
  document.body.appendChild(el);
  const unmount = App.mount(el, { label: "one" });
  await new Promise((r) => setTimeout(r, 20));
  // Push new props → component rerenders → naive closure refresh would orphan `host`.
  const internal = (App as unknown as Record<symbol, any>)[
    Symbol.for("ilha.islandMountInternal")
  ] as (host: Element, props?: unknown) => { unmount: () => void };
  const handle = internal(el, { label: "two" });
  await new Promise((r) => setTimeout(r, 20));
  el.querySelector("button")!.click();
  expect(seen).toEqual(["x:one:true"]);
  handle.unmount();
  void unmount;
});
