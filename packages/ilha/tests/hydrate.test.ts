import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";

const Counter = () => {
  const n = atom(0);
  return {
    $$ilha: 1 as const,
    children: ["Count: ", n],
    props: { onclick: () => n.update((x: number) => x + 1) },
    type: "button",
  };
};

test("hydrate reuses host markup and binds clicks", async () => {
  const html = await renderToString(Counter);
  const el = document.createElement("div");
  el.append(
    ...new DOMParser().parseFromString(html, "text/html").body.childNodes
  );
  document.body.append(el);
  const found = el.querySelector("[data-ilha]");
  // SAFETY: hydrate host is either the island root or the wrapper we created.
  const host = (found ?? el) as Element;
  const btn = host.querySelector("button");
  if (!btn) {
    throw new Error("button missing");
  }
  mount(host, Counter, { hydrate: true });
  await Bun.sleep(15);
  expect(host.querySelector("button")).toBe(btn);
  btn.click();
  await Bun.sleep(10);
  expect(host.textContent).toContain("Count: 1");
  el.remove();
});
