import { describe, it, expect } from "bun:test";

import { __ilhaServerIsland } from "./server-island";
import {
  clientRefPublicId,
  generateServerIslandModule,
  scanServerIslands,
  serverIslandPublicId,
  splitServerImports,
} from "./server-islands";

// ─────────────────────────────────────────────
// scanServerIslands
// ─────────────────────────────────────────────

describe("scanServerIslands", () => {
  const SOURCE = `
import { ilha } from "ilha";

export async function* getTasks() {
  yield [];
}

export async function toggleTask(id: string) {}

export const Tasks = ilha(
  () => {
    const items = derived(async function* () {
      yield* getTasks();
    });
    const toggle = action((id: string) => toggleTask(id));
    void items;
    void toggle;
    return html\`<p>x</p>\`;
  },
  { as: "section" },
);

export const Plain = ilha(() => html\`<p>hi</p>\`);

export function helper(): string {
  return "x";
}
`;

  it("detects island exports and their wiring", () => {
    const scan = scanServerIslands(SOURCE);
    expect(scan.exports.sort()).toEqual(["Plain", "Tasks", "getTasks", "helper", "toggleTask"]);

    const tasks = scan.islands.find((i) => i.name === "Tasks")!;
    expect(tasks).toBeDefined();
    // { as: "section" } constructor option is scanned.
    expect(tasks.as).toBe("section");
    // Order-based ids: d0 = first streaming derived generator, a0 = first action.
    expect(tasks.streams).toEqual({ d0: "getTasks" });
    expect(tasks.actions).toEqual({ a0: "toggleTask" });

    const plain = scan.islands.find((i) => i.name === "Plain")!;
    expect(plain.as).toBe("div");
    expect(plain.streams).toEqual({});
    expect(plain.actions).toEqual({});
  });

  it("detects default island exports", () => {
    const scan = scanServerIslands(`export default ilha(() => "x");`);
    expect(scan.islands.map((i) => i.name)).toEqual(["default"]);
  });

  it("ignores non-island exports", () => {
    const scan = scanServerIslands(`export const notAnIsland = somethingElse();`);
    expect(scan.islands).toEqual([]);
  });

  it("collects imported JSX islands for client hydration", () => {
    const scan = scanServerIslands(`
      import { Checkbox as Box, Button } from "areia";
      export const Tasks = ilha(() => <Box checked />);
    `);
    expect(scan.clientRefs).toEqual([
      {
        id: clientRefPublicId("areia", "Checkbox"),
        local: "Box",
        imported: "Checkbox",
        spec: "areia",
      },
    ]);
  });
});

// ─────────────────────────────────────────────
// generateServerIslandModule
// ─────────────────────────────────────────────

describe("generateServerIslandModule", () => {
  it("wires streams to stub calls with signal threading", () => {
    const scan = scanServerIslands(`
      export async function* ticks(): AsyncGenerator<number> { yield 1; }
      export const T = ilha(() => {
        const tickStream = derived(async function* () {
          yield* ticks();
        });
        void tickStream;
        return "";
      });
    `);
    const code = generateServerIslandModule("/abs/tasks.server.ts", scan);
    // Plain JS only — \0 virtual modules bypass Vite's TS transform.
    expect(code).not.toContain("import type");
    expect(code).not.toContain("typeof $$types");
    expect(code).toContain(`import { client as $$rpc } from "virtual:oxide/client"`);
    expect(code).toContain(`__ilhaApplyHead(j.head)`);
    expect(code).toContain(`"d0": (signal) => $$call("ticks", [{ signal }])`);
    expect(code).toContain(`export const ticks = (...args) => $$call("ticks", args)`);
    const id = serverIslandPublicId("/abs/tasks.server.ts", "T");
    expect(code).toContain(`export const T = __ilhaServerIsland("${id}", "div"`);
    expect(code).toContain(
      `JSON.stringify({ id: "${id}", path: location.pathname + location.search })`,
    );
    expect(code).not.toContain("#T");
    expect(code).not.toContain("state })");
  });

  it("wires imported JSX islands into the client proxy", () => {
    const scan = scanServerIslands(`
      import { Checkbox } from "areia";
      export const T = ilha(() => <Checkbox checked />);
    `);
    const code = generateServerIslandModule("/abs/tasks.server.tsx", scan);
    const ref = clientRefPublicId("areia", "Checkbox");
    expect(code).toContain(`import { Checkbox as $$child0 } from "areia"`);
    expect(code).toContain(`children: { "${ref}": $$child0 }`);
  });

  it("handles default exports", () => {
    const scan = scanServerIslands(`export default ilha(() => "x");`);
    const code = generateServerIslandModule("/abs/x.server.ts", scan);
    expect(code).toContain("export default __ilhaServerIsland");
  });
});

// ─────────────────────────────────────────────
// splitServerImports
// ─────────────────────────────────────────────
//
describe("splitServerImports", () => {
  const ctxFor = (islands: string[], hasDefault = false) => ({
    islandNamesFor: () => ({ islands: new Set(islands), hasDefault }),
    virtualSpecFor: (spec: string) => `\0ilha:server-island:${spec}`,
  });

  it("routes island and action bindings through one virtual module", () => {
    const code = `import { Tasks, createTask } from "./tasks.server";\nconsole.log(Tasks, createTask);`;
    const out = splitServerImports(code, ctxFor(["Tasks"]));
    expect(out).not.toBeNull();
    expect(out).toContain(
      `import { Tasks, createTask } from "\\u0000ilha:server-island:./tasks.server";`,
    );
  });

  it("routes action-only imports from mixed server modules", () => {
    const code = `import { createTask } from "./tasks.server";`;
    expect(splitServerImports(code, ctxFor(["Tasks"]))).toContain(
      `import { createTask } from "\\u0000ilha:server-island:./tasks.server";`,
    );
  });

  it("splits aliased bindings and mixed clauses", () => {
    const code = `import T, { toggleTask } from "./tasks.server";`;
    const out = splitServerImports(code, ctxFor(["Tasks"], true));
    expect(out).toContain(
      `import T, { toggleTask } from "\\u0000ilha:server-island:./tasks.server";`,
    );
  });

  it("leaves type-only imports alone", () => {
    const code = `import type { Tasks } from "./tasks.server";`;
    expect(splitServerImports(code, ctxFor(["Tasks"]))).toBeNull();
  });
});

// ─────────────────────────────────────────────
// __ilhaServerIsland — hydration behavior
// ─────────────────────────────────────────────

describe("__ilhaServerIsland", () => {
  function makeHost(inner: string): Element {
    const host = document.createElement("div");
    host.innerHTML = inner;
    document.body.appendChild(host);
    return host;
  }

  it("preserves SSR DOM and wires sentinel events to actions", async () => {
    const calls: string[] = [];
    const Island = __ilhaServerIsland("tasks.server.tsx#Tasks", "ul", {
      actions: {
        remove: () => {
          calls.push("remove");
        },
      },
    });

    const host = makeHost(
      `<ul data-ilha="Tasks" data-ilha-state='{"tasks":[1]}' data-ilha-actions='{"click:0":"remove"}'>` +
        `<li><button data-ilha-on="click:0">Delete</button></li>` +
        `<li data-ilha-slot="p:0"><span>nested island stays alone</span></li></ul>`,
    );
    const root = host.firstElementChild!;
    const unmount = Island.mount(root);

    expect(root.querySelector("li")!.textContent).toContain("Delete");

    root.querySelector("button")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["remove"]);
    unmount();
  });

  it("resumes streams through the wired transport and aborts on unmount", async () => {
    let push: ((v: number) => void) | undefined;
    let observedAbort = false;
    async function* gen(signal: AbortSignal): AsyncGenerator<number> {
      signal.addEventListener("abort", () => {
        observedAbort = true;
        push?.(0);
      });
      yield 1;
      for (;;) {
        if (signal.aborted) return;
        yield await new Promise<number>((resolve) => (push = resolve));
      }
    }
    const Island = __ilhaServerIsland("t.server.tsx#T", "div", {
      streams: { count: (signal) => gen(signal) },
    });

    const host = makeHost(`<div data-ilha="T"></div>`);
    const unmount = Island.mount(host.firstElementChild!);
    await new Promise((resolve) => setTimeout(resolve, 0));

    push!(7);
    await new Promise((resolve) => setTimeout(resolve, 0));
    unmount();
    expect(observedAbort).toBe(true);
  });

  it("does not wire sentinels inside nested islands or slots", () => {
    const calls: string[] = [];
    const Island = __ilhaServerIsland("x.server.tsx#X", "div", {
      actions: { hit: () => calls.push("hit") },
    });

    const host = makeHost(
      `<div data-ilha-actions='{"click:0":"hit"}'>` +
        `<button data-ilha-on="click:0">mine</button>` +
        `<div data-ilha-slot="k:a"><button data-ilha-on="click:0">child's</button></div>` +
        `</div>`,
    );
    const root = host.firstElementChild!;
    const unmount = Island.mount(root);

    const buttons = root.querySelectorAll("button");
    (buttons[1] as HTMLElement).click();
    expect(calls).toEqual([]);
    (buttons[0] as HTMLElement).click();
    expect(calls).toEqual(["hit"]);
    unmount();
  });
});

describe("__ilhaServerIsland nested client islands", () => {
  it("mounts SSR child slots and updates their props after a frame", async () => {
    const ref = "checkbox-ref";
    const updates: unknown[] = [];
    const actions: unknown[] = [];
    let onCheckedChange: (() => Promise<unknown>) | undefined;
    const child = {
      [Symbol.for("ilha.islandMountInternal")]: (el: Element, props?: Record<string, unknown>) => {
        el.setAttribute("data-mounted", String(props?.checked));
        onCheckedChange = props?.onCheckedChange as typeof onCheckedChange;
        return {
          unmount: () => {},
          updateProps: (next?: Record<string, unknown>) => {
            updates.push(next?.checked);
            el.setAttribute("data-mounted", String(next?.checked));
          },
        };
      },
    };
    const Island = __ilhaServerIsland("opaque", "div", {
      children: { [ref]: child },
      actions: { toggle: (id) => actions.push(id) },
      frame: () =>
        `<div data-ilha-slot="p:0" data-ilha-client-ref="${ref}" data-ilha-props='{"checked":false}'></div>`,
    });
    const host = document.createElement("div");
    host.innerHTML = `<div data-ilha-slot="p:0" data-ilha-client-ref="${ref}" data-ilha-props='{"checked":true,"onCheckedChange":{"__ilha":"action","k":"toggle","a":["task-1"]}}'></div>`;
    document.body.appendChild(host);
    const unmount = Island.mount(host);
    const slot = host.querySelector("[data-ilha-slot]")!;
    expect(slot.getAttribute("data-mounted")).toBe("true");

    await onCheckedChange?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(actions).toEqual(["task-1"]);
    expect(slot.getAttribute("data-mounted")).toBe("false");
    expect(updates).toContain(false);
    unmount();
  });
});

describe("__ilhaServerIsland frames", () => {
  it("morphs pushed frames into the host and rewires fresh sentinels", async () => {
    const calls: string[] = [];
    let push: ((v: number) => void) | undefined;
    async function* gen(): AsyncGenerator<number> {
      yield 1;
      for (;;) yield await new Promise<number>((resolve) => (push = resolve));
    }
    let frameCount = 0;
    const Island = __ilhaServerIsland("opaque", "div", {
      streams: { count: () => gen() },
      actions: { ping: () => calls.push("ping") },
      frame: () =>
        `<div data-ilha-actions='{"click:0":"ping"}'><p>count=${++frameCount}</p><button data-ilha-on="click:0">go</button></div>`,
    });

    const host = document.createElement("div");
    host.innerHTML = `<div data-ilha="T" data-ilha-state='{"count":1}' data-ilha-actions='{"click:0":"ping"}'><p>count=1</p><button data-ilha-on="click:0">go</button></div>`;
    document.body.appendChild(host);
    const root = host.firstElementChild!;
    const unmount = Island.mount(root);
    await new Promise((resolve) => setTimeout(resolve, 0));

    push!(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector("p")!.textContent).toBe("count=2");

    // The surviving button must fire the action exactly once — morph patches
    // in place, so rewiring must not double-attach.
    root.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["ping"]);
    unmount();
  });
});

describe("__ilhaServerIsland stale-args regression", () => {
  it("re-wires patched-in-place buttons with fresh manifest args after frames", async () => {
    const calls: unknown[] = [];
    let version = 0;
    const Island = __ilhaServerIsland("t.server.tsx#T", "div", {
      actions: { remove: (id: unknown) => calls.push(id) },
      frame: () => {
        version++;
        return (
          `<template data-ilha-actions='{"click:0":{"k":"remove","a":["${version}"]}}'></template>` +
          `<button data-ilha-on="click:0">del</button>`
        );
      },
    });

    // Empty host, no state attr → bootstrap frame fetch on mount.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const unmount = Island.mount(host);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(version).toBe(1);

    // Click #1 → action fires with v1 args, which triggers a repaint to v2.
    host.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["1"]);
    expect(version).toBe(2);

    // The button element SURVIVED the morph (patched in place) — but its
    // listener must now carry v2 args, not the captured v1 closure.
    const sameButton = host.querySelector("button")!;
    sameButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["1", "2"]);
    unmount();
  });
});

describe("server page proxies under layouts", () => {
  it("supports .key() so wrapLayout composition works", async () => {
    const { ilha } = await import("ilha");
    const { __ilhaServerIsland } = await import("./server-island");
    const { wrapLayout } = await import("./index");
    const proxy = __ilhaServerIsland("layout-proxy-test", "div", {}) as any;
    const wrapped = wrapLayout(() => ilha(() => `<section data-shell></section>`), proxy);
    // Must not throw; rendering yields an empty client shell.
    expect(() => wrapped.toString()).not.toThrow();
    expect(proxy.key("page")({ a: 1 })).toMatchObject({
      island: proxy,
      key: "page",
      props: { a: 1 },
    });
  });
});
