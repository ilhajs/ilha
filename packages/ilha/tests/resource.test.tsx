// @jsxImportSource ../src
import { expect, test } from "bun:test";

import {
  atom,
  invalidate,
  mount,
  renderToString,
  resource,
  watch,
} from "../src/index.ts";

const paint = (el: HTMLElement): void => {
  document.body.append(el);
};

test("resource loads and paints", async () => {
  const gate = Promise.withResolvers<string>();
  const App = () => {
    const res = resource("p6-basic", () => gate.promise);
    return <p>{res.loading() ? "loading" : (res.data() ?? "empty")}</p>;
  };
  const el = document.createElement("div");
  paint(el);
  mount(el, App);
  expect(el.textContent).toBe("loading");
  gate.resolve("v1");
  await Bun.sleep(10);
  expect(el.textContent).toBe("v1");
  el.remove();
});

test("resource dedupes concurrent mounts on one fetch", async () => {
  const gate = Promise.withResolvers<string>();
  let calls = 0;
  const fetcher = (): Promise<string> => {
    calls += 1;
    return gate.promise;
  };
  const App = () => {
    const res = resource("p6-dedupe", fetcher);
    return <p>{res.data() ?? "wait"}</p>;
  };
  const a = document.createElement("div");
  const b = document.createElement("div");
  paint(a);
  paint(b);
  mount(a, App);
  mount(b, App);
  expect(calls).toBe(1);
  gate.resolve("shared");
  await Bun.sleep(10);
  expect(a.textContent).toBe("shared");
  expect(b.textContent).toBe("shared");
  a.remove();
  b.remove();
});

test("resource seeds remounts from cache", async () => {
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  const values = [first, second];
  let calls = 0;
  const App = () => {
    const res = resource("p6-swr", () => {
      const next = values[calls];
      calls += 1;
      return next ? next.promise : Promise.resolve("late");
    });
    return <p>{res.data() ?? "wait"}</p>;
  };
  const a = document.createElement("div");
  paint(a);
  const unmount = mount(a, App);
  first.resolve("v1");
  await Bun.sleep(10);
  expect(a.textContent).toBe("v1");
  unmount();
  a.remove();
  const b = document.createElement("div");
  paint(b);
  mount(b, App);
  // Cached v1 paints synchronously while the revalidation runs behind it.
  expect(b.textContent).toBe("v1");
  expect(calls).toBe(2);
  second.resolve("v2");
  await Bun.sleep(10);
  expect(b.textContent).toBe("v2");
  b.remove();
});

test("invalidate refetches live components", async () => {
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  const values = [first, second];
  let calls = 0;
  const App = () => {
    const res = resource("p6-inv", () => {
      const next = values[calls];
      calls += 1;
      return next ? next.promise : Promise.resolve("late");
    });
    return <p>{res.data() ?? "wait"}</p>;
  };
  const el = document.createElement("div");
  paint(el);
  mount(el, App);
  first.resolve("v1");
  await Bun.sleep(10);
  expect(el.textContent).toBe("v1");
  invalidate("p6-inv");
  second.resolve("v2");
  await Bun.sleep(10);
  expect(calls).toBe(2);
  expect(el.textContent).toBe("v2");
  el.remove();
});

test("resource surfaces errors", async () => {
  const gate = Promise.withResolvers<string>();
  const App = () => {
    const res = resource("p6-err", () => gate.promise);
    if (res.loading()) {
      return <p>loading</p>;
    }
    return <p>{res.error() ? "failed" : (res.data() ?? "empty")}</p>;
  };
  const el = document.createElement("div");
  paint(el);
  mount(el, App);
  expect(el.textContent).toBe("loading");
  gate.reject(new Error("nope"));
  await Bun.sleep(10);
  expect(el.textContent).toBe("failed");
  el.remove();
});

test("invalidate updates every live component sharing a key", async () => {
  let n = 0;
  const App = () => {
    const res = resource("p6-invalidate-many", () => {
      n += 1;
      return Promise.resolve(`v${n}`);
    });
    return <p>{res.data() ?? "wait"}</p>;
  };
  const a = document.createElement("div");
  const b = document.createElement("div");
  paint(a);
  paint(b);
  const offA = mount(a, App);
  const offB = mount(b, App);
  await Bun.sleep(10);
  expect(a.textContent).toBe("v1");
  expect(b.textContent).toBe("v1");
  invalidate("p6-invalidate-many");
  await Bun.sleep(10);
  expect(n).toBe(2);
  expect(a.textContent).toBe("v2");
  expect(b.textContent).toBe("v2");
  offA();
  offB();
  a.remove();
  b.remove();
});

test("renderToString waits for resource and fetches once", async () => {
  let calls = 0;
  const App = () => {
    const res = resource("p6-ssr", async () => {
      calls += 1;
      await Bun.sleep(5);
      return `n${calls}`;
    });
    return <p>{res.data}</p>;
  };
  const html = await renderToString(App, { markers: false, snapshot: false });
  expect(html).toContain(">n1</span>");
  expect(calls).toBe(1);
});

test("SSR resource refetch starts a fresh fetch", async () => {
  let calls = 0;
  let refetched: number | undefined;
  const App = () => {
    const res = resource("p6-ssr-refetch", () => {
      calls += 1;
      return Promise.resolve(calls);
    });
    void res.refetch().then((v) => {
      refetched = v;
    });
    return <p>{res.data}</p>;
  };
  await renderToString(App, { markers: false, snapshot: false });
  expect(refetched).toBe(2);
});

test("resource survives a re-render before its fetch lands (watch after it)", async () => {
  const gate = Promise.withResolvers<string>();
  const Child = () => {
    const res = resource("p6-slots", () => gate.promise);
    const pending = atom<string | null>(null);
    watch(pending, () => {});
    return <p>{res.loading() ? "loading" : (res.data() ?? "empty")}</p>;
  };
  let bump: (() => void) | undefined;
  const Parent = () => {
    const tick = atom(0);
    bump = () => {
      tick.set(1);
    };
    return (
      <div>
        <span>{tick()}</span>
        <Child />
      </div>
    );
  };
  const el = document.createElement("div");
  paint(el);
  mount(el, Parent);
  await Bun.sleep(0);
  expect(el.textContent).toBe("0loading");
  // Parent re-renders the child while its fetch is still in flight: the
  // child's watch slots must keep their positions.
  bump?.();
  await Bun.sleep(10);
  gate.resolve("v1");
  await Bun.sleep(10);
  expect(el.textContent).toBe("1v1");
  el.remove();
});

test("invalidate reaches a key first used on a later render", async () => {
  let calls = 0;
  let switchKey: (() => void) | undefined;
  const App = () => {
    const key = atom("p6-late-a");
    switchKey = () => {
      key.set("p6-late-b");
    };
    const res = resource(key(), (k) => {
      calls += 1;
      return Promise.resolve(`${k}:${calls}`);
    });
    return <p>{res.data() ?? "wait"}</p>;
  };
  const el = document.createElement("div");
  paint(el);
  mount(el, App);
  await Bun.sleep(10);
  switchKey?.();
  await Bun.sleep(10);
  expect(el.textContent).toBe("p6-late-b:2");
  invalidate("p6-late-b");
  await Bun.sleep(10);
  expect(el.textContent).toBe("p6-late-b:3");
  el.remove();
});
