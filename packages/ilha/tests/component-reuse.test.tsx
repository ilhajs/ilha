// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";

const StateChild = () => {
  const n = atom(0);
  return (
    <button id="child-btn" onclick={() => n.update((x: number) => x + 1)}>
      child:{n}
    </button>
  );
};

const StateParent = () => {
  const tick = atom(0);
  return (
    <div>
      <button id="parent-btn" onclick={() => tick.update((x: number) => x + 1)}>
        parent:{tick}
      </button>
      <StateChild />
    </div>
  );
};

test("unkeyed child keeps state when the parent rerenders", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, StateParent);
  await Bun.sleep(10);

  const childBefore = el.querySelector("#child-btn");
  if (!(childBefore instanceof HTMLButtonElement)) {
    throw new Error("child missing");
  }
  childBefore.click();
  await Bun.sleep(10);
  expect(el.textContent).toContain("child:1");

  const parentBtn = el.querySelector("#parent-btn");
  if (!(parentBtn instanceof HTMLButtonElement)) {
    throw new Error("parent button missing");
  }
  parentBtn.click();
  await Bun.sleep(10);

  expect(el.textContent).toContain("parent:1");
  // New props flow in, but the child hole is reused — no remount.
  expect(el.textContent).toContain("child:1");
  expect(el.querySelector("#child-btn")).toBe(childBefore);
  unmount();
  el.remove();
});

const PropsChild = ({ label }: { label?: unknown }) => {
  const n = atom(0);
  return (
    <button id="props-child" onclick={() => n.update((x: number) => x + 1)}>
      {String(label ?? "")}:{n}
    </button>
  );
};

const PropsParent = () => {
  const label = atom("a");
  return (
    <div>
      <button id="label-btn" onclick={() => label.set("b")}>
        switch
      </button>
      <PropsChild label={label()} />
    </div>
  );
};

test("unkeyed child receives new props without remounting", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, PropsParent);
  await Bun.sleep(10);

  const childBefore = el.querySelector("#props-child");
  childBefore?.click();
  await Bun.sleep(10);
  expect(el.textContent).toContain("a:1");

  el.querySelector("#label-btn")?.click();
  await Bun.sleep(10);

  expect(el.textContent).toContain("b:1");
  expect(el.querySelector("#props-child")).toBe(childBefore);
  unmount();
  el.remove();
});

const HydChild = () => {
  const n = atom(0);
  return <span id="hyd-child">child:{n}</span>;
};

const HydParent = () => {
  const tick = atom(0);
  return (
    <div>
      <button id="hyd-btn" onclick={() => tick.update((x: number) => x + 1)}>
        {tick}
      </button>
      <HydChild />
    </div>
  );
};

test("unkeyed child survives hydration and later rerenders", async () => {
  const html = await renderToString(HydParent);
  expect(html).toContain("hyd-child");

  const el = document.createElement("div");
  document.body.append(el);
  el.innerHTML = html;
  const unmount = mount(el, HydParent, { hydrate: true });
  await Bun.sleep(10);

  const childBefore = el.querySelector("#hyd-child");
  if (!childBefore) {
    throw new Error("hydrated child missing");
  }
  el.querySelector("#hyd-btn")?.click();
  await Bun.sleep(10);

  expect(el.textContent).toContain("child:0");
  expect(el.querySelector("#hyd-child")).toBe(childBefore);
  unmount();
  el.remove();
});
