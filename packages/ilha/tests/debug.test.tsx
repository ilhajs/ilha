// @jsxImportSource ../src
import { afterEach, describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";

import { element, inspect, onChange, roots, setAtom } from "../src/debug.ts";
import type { IlhaInspectNode } from "../src/debug.ts";
import { atom, mount, renderToString } from "../src/index.ts";
import type { PropBag } from "../src/types.ts";

const unmounts: (() => void)[] = [];

const host = (): HTMLElement => {
  const el = document.createElement("div");
  el.id = "app";
  document.body.append(el);
  return el;
};

const start = async (
  el: HTMLElement,
  component: Parameters<typeof mount>[1]
): Promise<void> => {
  unmounts.push(mount(el, component));
  await Bun.sleep(5);
};

afterEach(() => {
  for (const unmount of unmounts.splice(0)) {
    unmount();
  }
  document.body.innerHTML = "";
});

const Badge = (props: PropBag) => {
  const n = atom(Number(props.start ?? 0));
  return (
    <button type="button" onclick={() => n.update((x: number) => x + 1)}>
      {n}
    </button>
  );
};

const Solo = () => <p>solo</p>;

const Counter = () => {
  const count = atom(1);
  const label = atom("hello");
  const double = atom(Atom.readable((get) => get(count.atom) * 2));
  return (
    <div>
      <p>
        {label()} {count()} {double()}
      </p>
      <Badge start={5} />
    </div>
  );
};

const handler = () => {};

interface Cyclic {
  self?: Cyclic;
}

const Odd = () => {
  atom({ handler });
  atom(new Date(0));
  atom([1, undefined, 3n]);
  atom({ deep: { n: null }, map: new Map([[1, 2]]), ok: true });
  atom(Effect.never);
  const cyclic: Cyclic = {};
  cyclic.self = cyclic;
  atom(cyclic);
  atom(Symbol("tag"));
  return <p>odd</p>;
};

const Loader = () => {
  const ok = atom(Effect.succeed({ n: 1 }));
  const failed = atom(Effect.fail("boom"));
  ok();
  failed();
  return <p>loader</p>;
};

const only = (nodes: IlhaInspectNode[]): IlhaInspectNode | undefined =>
  nodes[0];

describe("inspect", () => {
  it("describes a root, its atoms, and child components", async () => {
    const el = host();
    await start(el, Counter);

    const [tree] = inspect(el);
    expect(tree?.component).toBe("Counter");
    expect(tree?.host).toBe("div#app");
    expect(tree?.atoms.map((a) => a.value)).toEqual([1, "hello", 2]);
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0]?.component).toBe("Badge");
    expect(tree?.children[0]?.atoms).toEqual([{ index: 0, value: 5 }]);
    expect(tree?.children[0]?.host).toContain("data-ilha-slot");
  });

  it("is JSON-serializable and keeps ids stable across calls", async () => {
    const el = host();
    await start(el, Counter);

    const first = inspect(el);
    const second = inspect(el);
    expect(structuredClone(first)).toEqual(first);
    expect(second).toEqual(first);
  });

  it("returns every live root when no host is given", async () => {
    const a = host();
    const b = document.createElement("section");
    document.body.append(b);
    await start(a, Counter);
    await start(b, Solo);

    expect(roots()).toEqual(expect.arrayContaining([a, b]));
    const components = inspect().map((n) => n.component);
    expect(components).toEqual(expect.arrayContaining(["Counter", "Solo"]));
  });

  it("finds a nested component by its host element", async () => {
    const el = host();
    await start(el, Counter);

    const badgeHost = el.querySelector("[data-ilha-slot]");
    if (!badgeHost) {
      throw new Error("child host missing");
    }
    const [node] = inspect(badgeHost);
    expect(node?.component).toBe("Badge");
  });

  it("drops a root after it unmounts", async () => {
    const el = host();
    const unmount = mount(el, Counter);
    await Bun.sleep(5);
    expect(inspect(el)).toHaveLength(1);
    unmount();
    expect(inspect(el)).toEqual([]);
    expect(roots()).not.toContain(el);
  });

  it("tracks atom updates", async () => {
    const el = host();
    await start(el, Counter);
    el.querySelector("button")?.click();
    await Bun.sleep(5);
    expect(only(inspect(el))?.children[0]?.atoms[0]?.value).toBe(6);
  });

  it("summarizes values JSON cannot carry", async () => {
    const el = host();
    await start(el, Odd);
    const values = only(inspect(el))?.atoms.map((a) => a.value);
    expect(values).toEqual([
      { handler: "<function handler>" },
      "1970-01-01T00:00:00.000Z",
      [1, "<undefined>", "<bigint 3>"],
      { deep: { n: null }, map: "<Map(1)>", ok: true },
      "<unread>",
      { self: "<circular>" },
      "<symbol tag>",
    ]);
    expect(structuredClone(values)).toEqual(values);
  });

  it("unwraps AsyncResult success and summarizes the rest", async () => {
    const el = host();
    await start(el, Loader);
    const values = only(inspect(el))?.atoms.map((a) => a.value);
    expect(values?.[0]).toEqual({ n: 1 });
    expect(values?.[1]).toBe("<AsyncResult failure: boom>");
  });

  it("falls back to Root and Anonymous for unnamed components", async () => {
    const el = host();
    const Anon = (() => () => <i>x</i>)();
    await start(
      el,
      (() => () => (
        <div>
          <Anon />
        </div>
      ))()
    );
    const [tree] = inspect(el);
    expect(tree?.component).toBe("Root");
    expect(tree?.children[0]?.component).toBe("Anonymous");
  });

  it("sees SSR roots only while rendering", async () => {
    const before = inspect().length;
    await renderToString(Counter);
    expect(inspect()).toHaveLength(before);
  });
});

describe("setAtom and element", () => {
  it("writes a state atom and rerenders", async () => {
    const el = host();
    await start(el, Counter);
    const [tree] = inspect(el);
    expect(tree && setAtom(tree.id, 1, "changed")).toEqual({ ok: true });
    await Bun.sleep(5);
    expect(el.querySelector("p")?.textContent).toContain("changed");
    expect(only(inspect(el))?.atoms[1]?.value).toBe("changed");
  });

  it("explains why a write failed", async () => {
    const el = host();
    await start(el, Counter);
    const [tree] = inspect(el);
    const id = tree?.id ?? "";
    expect(setAtom(id, 2, 9)).toMatchObject({ ok: false });
    expect(setAtom(id, 99, 9)).toMatchObject({ ok: false });
    expect(setAtom("nope", 0, 9)).toMatchObject({ ok: false });
  });

  it("resolves an id to its host element", async () => {
    const el = host();
    await start(el, Counter);
    const [tree] = inspect(el);
    expect(element(tree?.id ?? "")).toBe(el);
    expect(element(tree?.children[0]?.id ?? "")).toBe(
      el.querySelector("[data-ilha-slot]") ?? undefined
    );
    expect(element("missing")).toBeUndefined();
  });
});

describe("onChange", () => {
  it("fires when a root mounts, updates, and unmounts", async () => {
    let calls = 0;
    const off = onChange(() => {
      calls += 1;
    });
    const el = host();
    const unmount = mount(el, Counter);
    await Bun.sleep(5);
    const afterMount = calls;
    expect(afterMount).toBeGreaterThan(0);

    el.querySelector("button")?.click();
    await Bun.sleep(5);
    const afterClick = calls;
    expect(afterClick).toBeGreaterThan(afterMount);

    unmount();
    expect(calls).toBeGreaterThan(afterClick);

    off();
    const settled = calls;
    mount(host(), Solo)();
    await Bun.sleep(5);
    expect(calls).toBe(settled);
  });

  it("isolates a throwing listener", async () => {
    const off = onChange(() => {
      throw new Error("listener failed");
    });
    const original = console.error;
    console.error = () => {};
    try {
      const el = host();
      await start(el, Counter);
      expect(el.textContent).toContain("hello");
    } finally {
      console.error = original;
      off();
    }
  });
});
