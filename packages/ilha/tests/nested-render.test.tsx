// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount, renderToString, unsafe } from "../src/index.ts";
import type { AtomHandle } from "../src/index.ts";

const SlowInner = async () => {
  const n = atom(99);
  await Bun.sleep(5);
  return <em>{n()}</em>;
};

const Outer = async () => {
  const a = atom(1);
  const b = atom(2);
  // No `await Promise.resolve()` first: the nested root runs inside this
  // component's own render.
  const html = await renderToString(SlowInner);
  return (
    <section>
      <i>{a()}</i>
      <i>{b()}</i>
      {unsafe(html)}
    </section>
  );
};

const parse = (html: string) => {
  const wrapper = document.createElement("div");
  wrapper.append(
    ...new DOMParser().parseFromString(html, "text/html").body.childNodes
  );
  document.body.append(wrapper);
  const host = wrapper.querySelector("[data-ilha]");
  if (!host) {
    throw new Error("host missing");
  }
  return { host, wrapper };
};

test("a nested renderToString inside an async component stays isolated (SSR)", async () => {
  const html = await renderToString(Outer);
  const sections = html.match(/data-ilha-state="[^"]*"/gu) ?? [];
  // Inner and outer each carry their own snapshot.
  expect(sections.length).toBe(2);
  expect(html).toContain("<em>99</em>");
  // The outer wrapper opens first; the inner root is embedded after it.
  const outerState = sections[0] ?? "";
  expect(outerState).not.toContain("99");
});

test("outer state hydrates aligned after a nested render", async () => {
  const html = await renderToString(Outer);
  const { host, wrapper } = parse(html);
  const hydrate = host.matches("[data-ilha]") ? host : null;
  expect(hydrate).not.toBeNull();
  // The outermost wrapper is the last `data-ilha` ancestor of the section.
  const outer = host.closest("[data-ilha]");
  if (!outer) {
    throw new Error("outer missing");
  }
  mount(outer, Outer, { hydrate: true });
  await Bun.sleep(30);
  expect(outer.querySelectorAll(":scope > section > i").length).toBe(2);
  expect(outer.querySelectorAll(":scope > section > i")[1]?.textContent).toBe(
    "2"
  );
  wrapper.remove();
});

let outerCount: AtomHandle<number> | undefined;

const Starter = () => {
  const count = atom(0);
  outerCount = count;
  // A nested root that settles later than this render.
  void renderToString(SlowInner);
  return <p>{count()}</p>;
};

test("a nested render started during a parent render keeps the parent reactive", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  mount(host, Starter);
  await Bun.sleep(1);
  outerCount?.set(3);
  await Bun.sleep(20);
  expect(host.textContent).toBe("3");
  host.remove();
});
