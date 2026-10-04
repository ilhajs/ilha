// @jsxImportSource ../src
import { expect, spyOn, test } from "bun:test";

import { atom } from "../src/index.ts";
import { createRenderer, getFiber } from "../src/renderer.ts";
import type { IlhaRuntime, PaintOps } from "../src/renderer.ts";
import { isFunction, isObject } from "../src/shared.ts";

/** Domain event handed to host handlers — this host has no DOM events. */
interface HostEvent {
  readonly type: string;
}

type HostHandler = (event: HostEvent) => void;

/** A host element: attributes, children and the handlers bound by the painter. */
interface TestEl {
  kind: "element";
  tagName: string;
  dataset: Record<string, string>;
  attrs: Map<string, string>;
  /** Props claimed through `setProp`, with the value the component wrote. */
  props: Map<string, unknown>;
  children: TestNode[];
  handlers: Record<string, HostHandler>;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  appendChild: (node: TestNode) => void;
  append: (...nodes: TestNode[]) => void;
}

interface TestText {
  kind: "text";
  text: string;
}

type TestNode = TestEl | TestText;

interface TestRoot {
  kind: "root";
  children: TestNode[];
}

// SAFETY: the shared painter types its host as DOM (`Node`, `ParentNode`,
// `Element`) so one painter can drive the DOM and the SSR shim. This host is a
// plain tree, so these casts restore its real shape.
const hostAs = <T,>(value: T): T => value;

const createEl = (tag: string): TestEl => ({
  append(...nodes) {
    this.children.push(...nodes);
  },
  appendChild(node) {
    this.children.push(node);
  },
  attrs: new Map(),
  children: [],
  dataset: {},
  handlers: {},
  kind: "element",
  props: new Map(),
  removeAttribute(name) {
    this.attrs.delete(name);
  },
  setAttribute(name, value) {
    this.attrs.set(name, value);
  },
  tagName: tag.toUpperCase(),
});

const ops: PaintOps<TestNode, TestEl> = {
  appendRoot: () => {
    throw new Error("a host renderer is placed with placeChildren only");
  },
  // SAFETY: TestEl stands in for Element in the shared painter.
  asElement: (el) => hostAs<Element>(el as never),
  // SAFETY: reused hosts are TestNode values.
  asNode: (host) => hostAs<TestNode>(host as never),
  // SAFETY: this host's fiber roots are TestRoot/TestEl values.
  asRoot: (el) => hostAs<ParentNode>(el as never),
  bindEvents: (el, props) => {
    for (const [key, value] of Object.entries(props)) {
      if (!key.startsWith("on") || !isFunction(value)) {
        continue;
      }
      // SAFETY: isFunction established the value is callable; the host keeps it
      // as an opaque event handler.
      el.handlers[key.slice(2).toLowerCase()] = value as never;
    }
  },
  committed: (el) => el,
  createElement: (tag) => createEl(tag),
  createRaw: (html) => [{ kind: "text", text: html }],
  createSlotHost: (slotId) => {
    const host = createEl("span");
    if (slotId !== null) {
      host.dataset.ilhaSlot = slotId;
    }
    return host;
  },
  createText: (text) => ({ kind: "text", text }),
  disconnect: () => {
    /* the host tracks connectedness itself */
  },
  placeChildren: (root, nodes) => {
    // SAFETY: this host's fiber roots are TestRoot/TestEl values.
    hostAs<TestRoot>(root as never).children = [...nodes];
  },
  // SAFETY: this host has no morph, so a reused host is its own node.
  reuseNode: (host) => hostAs<TestNode>(host as never),
  setFormControl: (el, key, value) => {
    el.attrs.set(key, String(value ?? ""));
  },
  setProp: (el, key, value) => {
    // Object values stay objects; everything else takes the default path.
    if (!isObject(value)) {
      return false;
    }
    el.props.set(key, value);
    return true;
  },
  setStyle: (el, css) => {
    el.attrs.set("style", css);
  },
};

const textOf = (node: TestNode): string =>
  node.kind === "text" ? node.text : node.children.map(textOf).join("");

const findAll = (node: TestNode, tag: string): TestEl[] => {
  if (node.kind !== "element") {
    return [];
  }
  const found = node.tagName === tag.toUpperCase() ? [node] : [];
  for (const child of node.children) {
    found.push(...findAll(child, tag));
  }
  return found;
};

const firstChild = (root: TestRoot): TestNode => {
  const [child] = root.children;
  if (!child) {
    throw new Error("host root has no child");
  }
  return child;
};

const click = async (root: TestRoot, tag: string, index = 0): Promise<void> => {
  const target = findAll(firstChild(root), tag).at(index);
  target?.handlers.click?.({ type: "click" });
  await Bun.sleep(5);
};

const Counter = () => {
  const count = atom(0);
  return (
    <button class="count" onclick={() => count.update((n: number) => n + 1)}>
      count: {count}
    </button>
  );
};

const Child = () => {
  const n = atom(0);
  return (
    <button class="child" onclick={() => n.update((v: number) => v + 1)}>
      {n}
    </button>
  );
};

const Parent = () => {
  const n = atom(0);
  return (
    <div>
      <button class="parent" onclick={() => n.update((v: number) => v + 1)}>
        {n}
      </button>
      <Child />
      <Child />
    </div>
  );
};

const Page = async () => {
  await Bun.sleep(20);
  return <p>late</p>;
};

test("mounts, paints props, and repaints on an atom write", async () => {
  const root: TestRoot = { children: [], kind: "root" };
  const renderer = createRenderer(ops);
  // SAFETY: the renderer drives the host generically; its root is this TestRoot.
  const handle = renderer.mount(root as never, Counter);
  await handle.ready;

  const [button] = findAll(firstChild(root), "button");
  expect(button?.attrs.get("class")).toBe("count");
  expect(textOf(firstChild(root))).toBe("count: 0");

  await click(root, "button");
  expect(textOf(firstChild(root))).toBe("count: 1");

  handle.unmount();
  expect(root.children).toHaveLength(0);
});

test("keeps nested component state across a parent repaint", async () => {
  const root: TestRoot = { children: [], kind: "root" };
  const renderer = createRenderer(ops);
  // SAFETY: the renderer drives the host generically; its root is this TestRoot.
  const handle = renderer.mount(root as never, Parent);
  await handle.ready;

  await click(root, "button", 0);
  await click(root, "button", 1);
  await click(root, "button", 2);
  await click(root, "button", 0);

  const labels = findAll(firstChild(root), "button").map(textOf);
  expect(labels).toEqual(["2", "1", "1"]);
  handle.unmount();
});

test("unmount clears the host and drops in-flight work", async () => {
  const root: TestRoot = { children: [], kind: "root" };
  const renderer = createRenderer(ops);
  // SAFETY: the renderer drives the host generically; its root is this TestRoot.
  const handle = renderer.mount(root as never, Page);
  handle.unmount();

  await Bun.sleep(40);
  expect(root.children).toHaveLength(0);
});

test("setProp receives the value the component wrote", async () => {
  const root: TestRoot = { children: [], kind: "root" };
  const spec = { query: "needle" };
  const View = () => (
    <p {...{ highlight: spec }} class="plain" style={{ color: "red" }}>
      text
    </p>
  );
  // SAFETY: the renderer drives the host generically; its root is this TestRoot.
  const handle = createRenderer(ops).mount(root as never, View);
  await handle.ready;

  const [p] = findAll(firstChild(root), "p");
  expect(p?.props.get("highlight")).toBe(spec);
  expect(p?.props.get("style")).toEqual({ color: "red" });
  // Unclaimed props keep the default handling.
  expect(p?.attrs.get("class")).toBe("plain");
  expect(p?.attrs.has("highlight")).toBe(false);
  handle.unmount();
});

const Boom = async () => {
  await Promise.resolve();
  throw new Error("nested");
};

test("onError receives root and nested failures as Errors", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const seen: Error[] = [];
  const renderer = createRenderer(ops);
  const failing: TestRoot = { children: [], kind: "root" };
  // SAFETY: the renderer drives the host generically; its root is this TestRoot.
  const first = renderer.mount(
    failing as never,
    () => {
      throw new Error("root");
    },
    { onError: (error) => seen.push(error) }
  );
  await first.ready;

  const nested: TestRoot = { children: [], kind: "root" };
  // SAFETY: the renderer drives the host generically; its root is this TestRoot.
  const second = renderer.mount(
    nested as never,
    () => (
      <div>
        <Boom />
      </div>
    ),
    { onError: (error) => seen.push(error) }
  );
  await second.ready;
  await Bun.sleep(10);

  expect(seen.every((error) => error instanceof Error)).toBe(true);
  expect(seen.map((error) => error.message)).toEqual(["root", "nested"]);
  expect(textOf(firstChild(nested))).toContain("nested");
  expect(logged).toHaveBeenCalledTimes(2);
  logged.mockRestore();
  first.unmount();
  second.unmount();
});

test("onRuntime runs before the root component and names its fibers", async () => {
  const root: TestRoot = { children: [], kind: "root" };
  let mounted: IlhaRuntime | undefined;
  const seen: boolean[] = [];
  const Leaf = () => {
    seen.push(getFiber().runtime === mounted);
    return <p>leaf</p>;
  };
  const View = () => {
    seen.push(getFiber().runtime === mounted);
    return (
      <div>
        <Leaf />
      </div>
    );
  };
  // SAFETY: the renderer drives the host generically; its root is this TestRoot.
  const handle = createRenderer(ops).mount(root as never, View, {
    onRuntime: (runtime) => {
      mounted = runtime;
    },
  });
  await handle.ready;

  expect(mounted).toBe(handle.runtime);
  expect(seen).toEqual([true, true]);
  handle.unmount();
});

const Keyed = ({ id }: { id?: unknown }) => {
  const n = atom(0);
  return (
    <button onclick={() => n.update((v: number) => v + 1)}>
      {String(id)}:{n}
    </button>
  );
};

const KeyedToggle = () => {
  const show = atom(true);
  return (
    <div>
      <button onclick={() => show.update((v: boolean) => !v)}>toggle</button>
      {show() ? <Keyed key="a" id="a" /> : <p>empty</p>}
    </div>
  );
};

test("a keyed component that leaves and returns mounts fresh", async () => {
  const root: TestRoot = { children: [], kind: "root" };
  // SAFETY: the renderer drives the host generically; its root is this TestRoot.
  const handle = createRenderer(ops).mount(root as never, KeyedToggle);
  await handle.ready;

  await click(root, "button", 1);
  expect(textOf(firstChild(root))).toBe("togglea:1");

  await click(root, "button", 0);
  expect(textOf(firstChild(root))).toBe("toggleempty");

  await click(root, "button", 0);
  expect(textOf(firstChild(root))).toBe("togglea:0");
  handle.unmount();
});
