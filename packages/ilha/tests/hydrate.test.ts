import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";

test("hydrate reuses host markup and binds clicks", async () => {
  const Counter = async () => {
    const n = atom(0);
    return {
      $$ilha: 1 as const,
      type: "button",
      props: { onclick: () => n.update((x: number) => x + 1) },
      children: ["Count: ", n],
    };
  };
  const html = await renderToString(Counter);
  const el = document.createElement("div");
  el.append(...new DOMParser().parseFromString(html, "text/html").body.childNodes);
  document.body.append(el);
  const host = (el.querySelector("[data-ilha]") ?? el) as Element;
  const btn = host.querySelector("button")!;
  mount(host, Counter, { hydrate: true });
  await Bun.sleep(15);
  expect(host.querySelector("button")).toBe(btn);
  (btn as HTMLButtonElement).click();
  await Bun.sleep(10);
  expect(host.textContent).toContain("Count: 1");
  el.remove();
});
