import { describe, it, expect } from "bun:test";

import { wrapLayout } from "./index";
import type { ServerActionPayload } from "./server-island";
import { __ilhaServerIsland, ISLAND_MOUNT_INTERNAL } from "./server-island";
import {
  clientRefPublicId,
  generateServerIslandModule,
  rewriteServerActions,
  scanServerIslands,
  serverIslandPublicId,
  splitServerImports,
} from "./server-islands";

const ctxFor = (islands: string[], hasDefault = false) => ({
  islandNamesFor: () => ({ hasDefault, islands: new Set(islands) }),
  virtualSpecFor: (spec: string) => `\0ilha:server-island:${spec}`,
});

// ─────────────────────────────────────────────
// scanServerIslands
// ─────────────────────────────────────────────

describe("scanServerIslands", () => {
  const SOURCE = `
import { action } from "oxidejs";

export async function* getTasks() {
  yield [];
}

export const toggleTask = action(async (id: string) => id);

export const Tasks = async function Tasks() {
  return Stream.fromAsyncIterable(getTasks(), (e) => e);
};

export function helper(): string {
  return "x";
}
`;

  it("detects island exports and their wiring", () => {
    const scan = scanServerIslands(SOURCE);
    expect(scan.exports.toSorted()).toEqual([
      "Tasks",
      "getTasks",
      "helper",
      "toggleTask",
    ]);

    const tasks = scan.islands.find((i) => i.name === "Tasks");
    if (!tasks) {
      throw new Error("Tasks island not scanned");
    }
    // Server islands are async/generator function components; the slot tag is
    // always div.
    expect(tasks.as).toBe("div");
    // d0 = stream transport, order-based id.
    expect(tasks.streams).toEqual({ d0: "getTasks" });
    // Direct calls to exported actions need no slot wiring — they serialize
    // through the __ilhaServerAction capture shim (rpcActions).
    expect(tasks.actions).toEqual({});
    expect(scan.rpcActions).toEqual({ toggleTask: "x:toggleTask" });

    // Sync function exports are RPC transports, not islands.
    expect(scan.islands.find((i) => i.name === "helper")).toBeUndefined();
  });

  it("wires Stream.fromAsyncIterable(getTasks()) as a stream", () => {
    const source = `
      export const getTasks = action(async function* () { yield []; });
      export const TaskList = async function TaskList() {
        return Stream.map(Stream.fromAsyncIterable(getTasks(), (e) => e), (list) => list);
      };
    `;
    const scan = scanServerIslands(source);
    expect(scan.islands.find((i) => i.name === "TaskList")?.streams).toEqual({
      d0: "getTasks",
    });
  });

  it("detects non-async function expression islands", () => {
    const source = `
      export const getTasks = action(async function* () { yield []; });
      export const TaskCount = function TaskCount() {
        return Stream.map(Stream.fromAsyncIterable(getTasks(), (e) => e), (list) => list);
      };
    `;
    const scan = scanServerIslands(source);
    expect(scan.islands.find((i) => i.name === "TaskCount")?.streams).toEqual({
      d0: "getTasks",
    });
  });

  it("detects generator and async generator function expression islands", () => {
    const syncGen = scanServerIslands(
      `export const Tick = function* Tick() { yield "x"; };`
    );
    const asyncGen = scanServerIslands(
      `export const Tick = async function* Tick() { yield "x"; };`
    );
    expect(syncGen.islands.map((i) => i.name)).toEqual(["Tick"]);
    expect(asyncGen.islands.map((i) => i.name)).toEqual(["Tick"]);
  });

  it("wires oxidejs actions without ilha action slots", () => {
    const source = `
      import { action } from "oxidejs";
      export const remove = action(async (id: string) => id);
      export const Tasks = async function Tasks() {
        return <button onclick={() => remove("t1")} />;
      };
    `;
    const scan = scanServerIslands(source);
    expect(scan.rpcActions).toEqual({ remove: "x:remove" });
    expect(scan.islands[0]?.actions).toEqual({});
    expect(generateServerIslandModule("/abs/tasks.server.tsx", scan)).toContain(
      `"x:remove": (...args) => $$call("remove", args)`
    );
    expect(rewriteServerActions(source, scan.rpcActions)).toContain(
      `export const remove = __ilhaServerAction("x:remove", async (id: string) => id);`
    );
  });

  it("detects default island exports", () => {
    const scan = scanServerIslands(
      `export default async function Default() { return "x"; }`
    );
    expect(scan.islands.map((i) => i.name)).toEqual(["default"]);
  });

  it("ignores non-island exports", () => {
    const scan = scanServerIslands(
      `export const notAnIsland = somethingElse();`
    );
    expect(scan.islands).toEqual([]);
  });

  it("collects imported JSX islands for client hydration", () => {
    const scan = scanServerIslands(`
      import { Checkbox as Box } from "ui-lib";
      export const Tasks = async function Tasks() {
        return <Box checked />;
      };
    `);
    expect(scan.clientRefs).toEqual([
      {
        id: clientRefPublicId("ui-lib", "Checkbox"),
        imported: "Checkbox",
        local: "Box",
        spec: "ui-lib",
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
      export const T = async function T() {
        return Stream.fromAsyncIterable(ticks(), (e) => e);
      };
    `);
    const code = generateServerIslandModule("/abs/tasks.server.ts", scan);
    // Plain JS only — \0 virtual modules bypass Vite's TS transform.
    expect(code).not.toContain("import type");
    expect(code).not.toContain("typeof $$types");
    expect(code).toContain(
      `import { client as $$rpc } from "virtual:oxide/client"`
    );
    expect(code).toContain(`__ilhaApplyHead(j.head)`);
    expect(code).toContain(`"d0": (signal) => $$call("ticks", [{ signal }])`);
    expect(code).toContain(
      `export const ticks = (...args) => $$call("ticks", args)`
    );
    const id = serverIslandPublicId("/abs/tasks.server.ts", "T");
    expect(code).toContain(
      `export const T = __ilhaServerIsland("${id}", "div"`
    );
    expect(code).toContain(`"${id}", "div", {`);
    expect(code).toContain(`, "/abs/tasks")`);
    expect(code).toContain(`$$rpc["tasks"][method](...args)`);
    expect(code).toContain(
      `JSON.stringify({ id: "${id}", path: location.pathname + location.search, props })`
    );
    expect(code).not.toContain("#T");
    expect(code).not.toContain("state })");
  });

  it("same-basename modules get distinct repaint keys and shared rpc basenames", () => {
    const scan = scanServerIslands(
      `export const T = async function T() { return "x"; };`
    );
    const a = generateServerIslandModule("/proj/a/tasks.server.ts", scan);
    const b = generateServerIslandModule("/proj/b/tasks.server.ts", scan);
    expect(a).toContain(`$$rpc["tasks"][method](...args)`);
    expect(b).toContain(`$$rpc["tasks"][method](...args)`);
    expect(a).toContain(`, "/proj/a/tasks")`);
    expect(b).toContain(`, "/proj/b/tasks")`);
    expect(a).not.toContain(`, "/proj/b/tasks")`);
  });

  it("wires imported JSX islands into the client proxy", () => {
    const scan = scanServerIslands(`
      import { Checkbox } from "ui-lib";
      export const T = async function T() {
        return <Checkbox checked />;
      };
    `);
    const code = generateServerIslandModule("/abs/tasks.server.tsx", scan);
    const ref = clientRefPublicId("ui-lib", "Checkbox");
    expect(code).toContain(`import { Checkbox as $$child0 } from "ui-lib"`);
    expect(code).toContain(`children: { "${ref}": $$child0 }`);
  });

  it("handles default exports", () => {
    const scan = scanServerIslands(
      `export default async function Default() { return "x"; }`
    );
    const code = generateServerIslandModule("/abs/x.server.ts", scan);
    expect(code).toContain("export default __ilhaServerIsland");
  });
});

// ─────────────────────────────────────────────
// splitServerImports
// ─────────────────────────────────────────────
//
describe("splitServerImports", () => {
  it("routes island and action bindings through one virtual module", () => {
    const code = `import { Tasks, createTask } from "./tasks.server";\nconsole.log(Tasks, createTask);`;
    const out = splitServerImports(code, ctxFor(["Tasks"]));
    expect(out).not.toBeNull();
    expect(out).toContain(
      `import { Tasks, createTask } from "\\u0000ilha:server-island:./tasks.server";`
    );
  });

  it("routes action-only imports from mixed server modules", () => {
    const code = `import { createTask } from "./tasks.server";`;
    expect(splitServerImports(code, ctxFor(["Tasks"]))).toContain(
      `import { createTask } from "\\u0000ilha:server-island:./tasks.server";`
    );
  });

  it("splits aliased bindings and mixed clauses", () => {
    const code = `import T, { toggleTask } from "./tasks.server";`;
    const out = splitServerImports(code, ctxFor(["Tasks"], true));
    expect(out).toContain(
      `import T, { toggleTask } from "\\u0000ilha:server-island:./tasks.server";`
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

const makeHost = (inner: string): Element => {
  const host = document.createElement("div");
  const parsed = new DOMParser().parseFromString(
    `<div>${inner}</div>`,
    "text/html"
  );
  host.replaceChildren(...(parsed.body.firstElementChild?.childNodes ?? []));
  document.body.append(host);
  return host;
};

describe("__ilhaServerIsland", () => {
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
        `<li data-ilha-slot="p:0"><span>nested island stays alone</span></li></ul>`
    );
    const root = host.firstElementChild;
    if (!root) {
      throw new Error("host root missing");
    }
    const unmount = Island.mount(root);

    const deleteBtn = root.querySelector<HTMLButtonElement>("li button");
    if (!deleteBtn) {
      throw new Error("delete button missing");
    }
    expect(deleteBtn.textContent).toContain("Delete");

    deleteBtn.click();
    await Bun.sleep(0);
    expect(calls).toEqual(["remove"]);
    unmount();
  });

  it("resumes streams through the wired transport and aborts on unmount", async () => {
    let push: ((v: number) => void) | undefined;
    let observedAbort = false;
    const genSignal = async function* genSignal(
      signal: AbortSignal
    ): AsyncGenerator<number> {
      signal.addEventListener("abort", () => {
        observedAbort = true;
        push?.(0);
      });
      yield 1;
      // The test pushes exactly one value; the transport aborts the stream
      // on unmount, so no pull loop is needed here.
      const { promise, resolve } = Promise.withResolvers<number>();
      push = resolve;
      yield await promise;
    };
    const Island = __ilhaServerIsland("t.server.tsx#T", "div", {
      streams: { count: (signal) => genSignal(signal) },
    });

    const host = makeHost(`<div data-ilha="T"></div>`);
    const islandRoot = host.firstElementChild;
    if (!islandRoot) {
      throw new Error("island root missing");
    }
    const unmount = Island.mount(islandRoot);
    await Bun.sleep(0);

    if (!push) {
      throw new Error("stream push missing");
    }
    push(7);
    await Bun.sleep(0);
    unmount();
    expect(observedAbort).toBe(true);
  });

  it("retries when the first stream next() fails with a cold-start 503", async () => {
    let attempts = 0;
    let frames = 0;
    const errors: unknown[] = [];
    const prevError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    const genRetry = async function* genRetry(): AsyncGenerator<number> {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("RPC transport error: 503");
      }
      yield 42;
    };
    let unmount: (() => void) | undefined;
    try {
      const Island = __ilhaServerIsland("t.server.tsx#T", "div", {
        frame: () => {
          frames += 1;
          return `<p>ok</p>`;
        },
        streams: { count: () => genRetry() },
      });
      const host = makeHost(`<div data-ilha="T"></div>`);
      const root = host.firstElementChild;
      if (!root) {
        throw new Error("island root missing");
      }
      unmount = Island.mount(root);
      // Bounded wait: 400 ticks x 5ms == the previous 2s deadline.
      const settled = () =>
        attempts === 3 &&
        frames > 0 &&
        root.querySelector("p")?.textContent === "ok";
      const waitTick = async (remaining: number): Promise<void> => {
        if (settled() || remaining === 0) {
          return;
        }
        await Bun.sleep(5);
        await waitTick(remaining - 1);
      };
      await waitTick(400);
      if (!settled()) {
        throw new Error("Timed out waiting for stream retry and frame repaint");
      }
      expect(attempts).toBe(3);
      expect(frames).toBeGreaterThan(0);
      expect(root.querySelector("p")?.textContent).toBe("ok");
      expect(errors).toEqual([]);
    } finally {
      unmount?.();
      console.error = prevError;
    }
  });

  it("retries when the first stream next() fails with an empty HTTP response", async () => {
    let attempts = 0;
    let frames = 0;
    const genRetry = async function* genRetry(): AsyncGenerator<number> {
      attempts += 1;
      if (attempts < 3) {
        throw new Error(
          "~effect/rpc/RpcClientError: RpcClientDefect: Received empty HTTP response from RPC server"
        );
      }
      yield 7;
    };
    let unmount: (() => void) | undefined;
    try {
      const Island = __ilhaServerIsland("t.server.tsx#EmptyHttp", "div", {
        frame: () => {
          frames += 1;
          return `<p>ready</p>`;
        },
        streams: { count: () => genRetry() },
      });
      const host = makeHost(`<div data-ilha="EmptyHttp"></div>`);
      const root = host.firstElementChild;
      if (!root) {
        throw new Error("island root missing");
      }
      unmount = Island.mount(root);
      const settled = () =>
        attempts === 3 &&
        frames > 0 &&
        root.querySelector("p")?.textContent === "ready";
      const waitTick = async (remaining: number): Promise<void> => {
        if (settled() || remaining === 0) {
          return;
        }
        await Bun.sleep(5);
        await waitTick(remaining - 1);
      };
      await waitTick(400);
      expect(settled()).toBe(true);
    } finally {
      unmount?.();
    }
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
        `</div>`
    );
    const root = host.firstElementChild;
    if (!root) {
      throw new Error("host root missing");
    }
    const unmount = Island.mount(root);

    const buttons = root.querySelectorAll("button");
    // SAFETY: the fixture above renders exactly two buttons; narrow the
    // Element to HTMLElement because only HTMLElement has .click().
    const childButton = buttons[1] as HTMLElement;
    // SAFETY: same fixture, first button — see the comment above.
    const ownButton = buttons[0] as HTMLElement;
    childButton.click();
    expect(calls).toEqual([]);
    ownButton.click();
    expect(calls).toEqual(["hit"]);
    unmount();
  });
});

describe("__ilhaServerIsland nested client islands", () => {
  it("mounts SSR child slots and updates their props after a frame", async () => {
    const ref = "checkbox-ref";
    const actions: unknown[] = [];
    let onCheckedChange: (() => Promise<void>) | undefined;
    interface ChildProps {
      checked?: boolean;
      onCheckedChange?: () => Promise<void>;
    }
    const child = {
      [Symbol.for("ilha.islandMountInternal")]: (
        el: HTMLElement,
        props?: ChildProps
      ) => {
        el.dataset.mounted = String(props?.checked);
        onCheckedChange = props?.onCheckedChange;
        return {
          unmount: () => {},
          updateProps: (next?: ChildProps) => {
            el.dataset.mounted = String(next?.checked);
          },
        };
      },
    };
    const Island = __ilhaServerIsland("opaque", "div", {
      actions: { toggle: (id?: ServerActionPayload) => actions.push(id) },
      children: { [ref]: child },
      frame: () =>
        `<div data-ilha-slot="p:0" data-ilha-client-ref="${ref}" data-ilha-props='{"checked":false}'></div>`,
    });
    const host = document.createElement("div");
    // SAFETY: markup is a test-authored fixture, not untrusted input.
    const fixture = new DOMParser().parseFromString(
      `<div data-ilha-slot="p:0" data-ilha-client-ref="${ref}" data-ilha-props='{"checked":true,"onCheckedChange":{"__ilha":"action","k":"toggle","a":["task-1"]}}'></div>`,
      "text/html"
    );
    host.replaceChildren(...fixture.body.childNodes);
    document.body.append(host);
    const unmount = Island.mount(host);
    const slot = host.querySelector<HTMLElement>("[data-ilha-slot]");
    if (!slot) {
      throw new Error("slot missing");
    }
    expect(slot.dataset.mounted).toBe("true");

    await onCheckedChange?.();
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(actions).toEqual(["task-1"]);
    // The frame replaced the slot element; the fresh mount reads checked:false
    // from the new frame's data-ilha-props.
    const fresh = host.querySelector("[data-ilha-slot]");
    if (!fresh) {
      throw new Error("fresh slot missing");
    }
    expect(fresh).not.toBe(slot);
    // SAFETY: the fixture slot is a real <div> mounted by the island hook,
    // so the HTMLElement narrow below is exact, not an assumption.
    expect((fresh as HTMLElement).dataset.mounted).toBe("false");
    unmount();
  });
});

describe("__ilhaServerIsland parent props", () => {
  it("re-fetches a frame when the parent updates props", async () => {
    const seen: unknown[] = [];
    const Island = __ilhaServerIsland("opaque", "div", {
      frame: (props) => {
        seen.push(props);
        return `<p>Hello, ${String(props?.name ?? "")}!</p>`;
      },
    });
    const host = document.createElement("div");
    const fixture = new DOMParser().parseFromString(
      `<p>Hello, !</p>`,
      "text/html"
    );
    host.replaceChildren(...fixture.body.childNodes);
    document.body.append(host);
    const handle = Island[ISLAND_MOUNT_INTERNAL](host, { name: "" });
    handle.updateProps({ name: "Ada" });
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(seen).toEqual([{ name: "Ada" }]);
    expect(host.textContent).toBe("Hello, Ada!");
    handle.unmount();
  });

  it("mount(host, props) bootstraps the first frame with those props", async () => {
    const seen: unknown[] = [];
    const Island = __ilhaServerIsland("opaque", "div", {
      frame: (props) => {
        seen.push(props);
        return `<p>Hello, ${String(props?.name ?? "")}!</p>`;
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const unmount = Island.mount(host, { name: "Ada" });
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(seen).toEqual([{ name: "Ada" }]);
    expect(host.textContent).toBe("Hello, Ada!");
    unmount();
  });
});

describe("__ilhaServerIsland frames", () => {
  it("morphs pushed frames into the host and rewires fresh sentinels", async () => {
    const calls: string[] = [];
    let push: ((v: number) => void) | undefined;
    const genFrames = async function* genFrames(
      _signal: AbortSignal
    ): AsyncGenerator<number> {
      yield 1;
      // The test pushes exactly one frame-driving value; unmount aborts.
      const { promise, resolve } = Promise.withResolvers<number>();
      push = resolve;
      yield await promise;
    };
    let frameCount = 0;
    const Island = __ilhaServerIsland("opaque", "div", {
      actions: { ping: () => calls.push("ping") },
      frame: () => {
        frameCount += 1;
        return `<div data-ilha-actions='{"click:0":"ping"}'><p>count=${frameCount}</p><button data-ilha-on="click:0">go</button></div>`;
      },
      streams: { count: (signal) => genFrames(signal) },
    });

    const host = document.createElement("div");
    const fixture = new DOMParser().parseFromString(
      `<div data-ilha="T" data-ilha-state='{"count":1}' data-ilha-actions='{"click:0":"ping"}'><p>count=1</p><button data-ilha-on="click:0">go</button></div>`,
      "text/html"
    );
    host.replaceChildren(...fixture.body.childNodes);
    document.body.append(host);
    const root = host.firstElementChild;
    if (!root) {
      throw new Error("host root missing");
    }
    const unmount = Island.mount(root);
    await Bun.sleep(0);

    if (!push) {
      throw new Error("stream push missing");
    }
    push(2);
    await Bun.sleep(0);
    await Bun.sleep(0);
    const frameText = root.querySelector("p");
    if (!frameText) {
      throw new Error("frame <p> missing");
    }
    expect(frameText.textContent).toBe("count=2");

    // The surviving button must fire the action exactly once — morph patches
    // in place, so rewiring must not double-attach.
    const goButton = root.querySelector("button");
    if (!goButton) {
      throw new Error("go button missing");
    }
    goButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Bun.sleep(0);
    expect(calls).toEqual(["ping"]);
    unmount();
  });
});

describe("__ilhaServerIsland shared module repaints", () => {
  it("repaints every mounted island from the same server module", async () => {
    let countFrames = 0;
    let listFrames = 0;
    const Count = __ilhaServerIsland(
      "tasks.server.tsx#TaskCount",
      "span",
      {
        frame: () => {
          countFrames += 1;
          return `<span class="badge">${countFrames}</span>`;
        },
      },
      "/abs/tasks"
    );
    const List = __ilhaServerIsland(
      "tasks.server.tsx#TaskList",
      "div",
      {
        actions: {
          "x:toggle": () => Promise.resolve(),
        },
        frame: () => {
          listFrames += 1;
          return `<template data-ilha-actions='{"click:0":"x:toggle"}'></template><button data-ilha-on="click:0">go</button><p>list-${listFrames}</p>`;
        },
      },
      "/abs/tasks"
    );

    const countHost = document.createElement("div");
    const listHost = document.createElement("div");
    document.body.append(countHost, listHost);

    const unmountCount = Count.mount(countHost);
    const unmountList = List.mount(listHost);
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(countFrames).toBe(1);
    expect(listFrames).toBe(1);

    listHost.querySelector<HTMLButtonElement>("button")?.click();
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(countFrames).toBe(2);
    expect(listFrames).toBe(2);

    unmountCount();
    unmountList();
  });

  it("same-basename modules in different directories keep distinct repaint groups", async () => {
    let aFrames = 0;
    let bFrames = 0;
    const A = __ilhaServerIsland(
      "a/tasks.server.tsx#A",
      "div",
      {
        actions: { "x:go": () => Promise.resolve() },
        frame: () => {
          aFrames += 1;
          return `<template data-ilha-actions='{"click:0":"x:go"}'></template><button data-ilha-on="click:0">a</button><p>a-${aFrames}</p>`;
        },
      },
      "/proj/a/tasks"
    );
    const B = __ilhaServerIsland(
      "b/tasks.server.tsx#B",
      "div",
      {
        frame: () => {
          bFrames += 1;
          return `<p>b-${bFrames}</p>`;
        },
      },
      "/proj/b/tasks"
    );

    const aHost = document.createElement("div");
    const bHost = document.createElement("div");
    document.body.append(aHost, bHost);
    const unmountA = A.mount(aHost);
    const unmountB = B.mount(bHost);
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(aFrames).toBe(1);
    expect(bFrames).toBe(1);

    aHost.querySelector<HTMLButtonElement>("button")?.click();
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(aFrames).toBe(2);
    expect(bFrames).toBe(1);

    unmountA();
    unmountB();
  });
});

describe("__ilhaServerIsland stale-args regression", () => {
  it("re-wires patched-in-place buttons with fresh manifest args after frames", async () => {
    const calls: unknown[] = [];
    let version = 0;
    const Island = __ilhaServerIsland("t.server.tsx#T", "div", {
      actions: { remove: (id?: ServerActionPayload) => calls.push(id) },
      frame: () => {
        version += 1;
        return (
          `<template data-ilha-actions='{"click:0":{"k":"remove","a":["${version}"]}}'></template>` +
          `<button data-ilha-on="click:0">del</button>`
        );
      },
    });

    // Empty host, no state attr → bootstrap frame fetch on mount.
    const host = document.createElement("div");
    document.body.append(host);
    const unmount = Island.mount(host);

    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(version).toBe(1);

    // Click #1 → action fires with v1 args, which triggers a repaint to v2.
    const firstButton = host.querySelector("button");
    if (!firstButton) {
      throw new Error("del button missing");
    }
    firstButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(calls).toEqual(["1"]);
    expect(version).toBe(2);

    // The button element SURVIVED the morph (patched in place) — but its
    // listener must now carry v2 args, not the captured v1 closure.
    const sameButton = host.querySelector("button");
    if (!sameButton) {
      throw new Error("same button missing");
    }
    sameButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Bun.sleep(0);
    expect(calls).toEqual(["1", "2"]);
    unmount();
  });
});

describe("server page proxies under layouts", () => {
  it("supports .key() so wrapLayout composition works", () => {
    const proxy = __ilhaServerIsland("layout-proxy-test", "div", {});
    // SAFETY: wrapLayout only stores its arguments here; the island proxy is
    // exercised as a Component stand-in and is never invoked by it.
    expect(() => wrapLayout(() => "shell", proxy as never)).not.toThrow();
    expect(proxy.key("page")({ a: 1 })).toMatchObject({
      island: proxy,
      key: "page",
      props: { a: 1 },
    });
  });
});
