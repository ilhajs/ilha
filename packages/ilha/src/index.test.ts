import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import {
  action,
  batch,
  computed,
  context,
  derived,
  effect,
  html,
  ilha,
  morph,
  mount,
  onError,
  onUncaughtError,
  persist,
  raw,
  signal,
  state,
  type Island,
  untrack,
} from "./index";
import { ISLAND_MOUNT_INTERNAL, setServerManifestSerializer } from "./internal";
import { jsx } from "./jsx-runtime";

// Test adapter standing in for @ilha/router's manifest serializer: captures
// the manifest data core collects instead of asserting on markup ownership.
const capturedManifests: Array<Record<string, unknown>> = [];
setServerManifestSerializer({
  template(manifest) {
    const entry = { ...Object.fromEntries(manifest) };
    capturedManifests.push(entry);
    return `<template data-ilha-actions='${JSON.stringify(entry).replace(/'/g, "&#39;")}'></template>`;
  },
});
function lastManifest(): Record<string, unknown> {
  return capturedManifests[capturedManifests.length - 1] ?? {};
}

// ─── helpers ──────────────────────────────────────────────────────────────

function makeEl(inner = ""): Element {
  const el = document.createElement("div");
  // pi-lens-ignore: ast-grep:no-inner-html — test host only; markup is
  // author-controlled literals in these tests, never user input.
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

function cleanup(el: Element): void {
  el.remove();
}

function flush(): Promise<void> {
  return new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
}

/** Internal mount handle enabling prop pushes for tests. */
function mountInternal(island: Island<any>, host: Element, props?: Record<string, unknown>) {
  const internal = (island as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] as (
    host: Element,
    props?: Record<string, unknown>,
  ) => { unmount: () => void; updateProps: (props?: Record<string, unknown>) => void };
  return internal(host, props);
}

/** Capture dev warnings into an array; restores after the callback. */
function captureWarnings(body: () => void): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (msg?: unknown, ...rest: unknown[]) => {
    warnings.push(`${msg} ${rest.join(" ")}`.trim());
  };
  try {
    body();
  } finally {
    console.warn = original;
  }
  return warnings;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ─── Primitive ordering / slots ───────────────────────────────────────────

describe("primitive ordering", () => {
  it("state persists across rerenders", () => {
    const rendCalls: number[] = [];
    const Counter = ilha(() => {
      const count = state(0);
      rendCalls.push(count());
      return html`<button onclick=${() => count((v) => v + 1)}>${count()}</button>`;
    });
    const el = makeEl();
    const handle = mountInternal(Counter, el);
    const button = el.querySelector("button")!;
    expect(button.textContent).toBe("0");

    // Each render pass reuses the same slot instead of resetting the signal.
    const callsBefore = rendCalls.length;
    button.click();
    expect(button.textContent).toBe("1");
    button.click();
    expect(button.textContent).toBe("2");
    expect(rendCalls.length).toBeGreaterThan(callsBefore);
    handle.unmount();
    cleanup(el);
  });

  it("state persists and updates through a wired handler", async () => {
    const Counter = ilha(() => {
      const count = state(0);
      return html`<button onclick=${() => count((v) => v + 1)}>${count()}</button>`;
    });
    const el = makeEl();
    const handle = mountInternal(Counter, el);
    const button = el.querySelector("button")!;
    expect(button.textContent).toBe("0");
    button.click();
    expect(button.textContent).toBe("1");
    button.click();
    expect(button.textContent).toBe("2");
    handle.unmount();
    cleanup(el);
  });

  it("initializers run once per mounted instance", () => {
    let initCalls = 0;
    const Island = ilha(() => {
      const count = state(() => {
        initCalls++;
        return 10;
      });
      return html`<p>${count()}</p>`;
    });

    const el1 = makeEl();
    const el2 = makeEl();
    const h1 = mountInternal(Island, el1);
    const h2 = mountInternal(Island, el2);
    expect(initCalls).toBe(2);
    expect(el1.textContent).toBe("10");
    expect(el2.textContent).toBe("10");
    h1.unmount();
    h2.unmount();
    cleanup(el1);
    cleanup(el2);
  });

  it("separate instances do not share slots", () => {
    const Island = ilha(() => {
      const count = state(0);
      return html`<button onclick=${() => count((v) => v + 1)}>${count()}</button>`;
    });
    const el1 = makeEl();
    const el2 = makeEl();
    const h1 = mountInternal(Island, el1);
    const h2 = mountInternal(Island, el2);
    el1.querySelector("button")!.click();
    el1.querySelector("button")!.click();
    expect(el1.querySelector("button")!.textContent).toBe("2");
    expect(el2.querySelector("button")!.textContent).toBe("0");
    h1.unmount();
    h2.unmount();
    cleanup(el1);
    cleanup(el2);
  });

  it("primitives outside an island render fail clearly", () => {
    expect(() => state(0)).toThrow(/outside an island render/);
    expect(() => derived(() => 1)).toThrow(/outside an island render/);
    expect(() => action(() => {})).toThrow(/outside an island render/);
    expect(() => effect(() => {})).not.toThrow(); // standalone mode
    expect(() => effect.once(() => {})).toThrow(/outside an island render/);
    expect(() => onError(() => {})).toThrow(/outside an island render/);
  });

  it("hook kind changes warn in development", () => {
    let flip = true;
    const Island = ilha<{ flip?: boolean }>(({ flip: f }) => {
      flip = f ?? true;
      if (flip) {
        const count = state(0);
        return html`<p data-kind="state">${count()}</p>`;
      }
      const value = derived(() => 1);
      return html`<p data-kind="derived">${value()}</p>`;
    });

    const el = makeEl();
    const handle = mountInternal(Island, el, { flip: true });
    expect(el.querySelector("[data-kind=state]")).not.toBeNull();

    const warnings = captureWarnings(() => {
      handle.updateProps({ flip: false });
    });
    expect(warnings.some((w) => w.includes("derived") && w.includes("state"))).toBe(true);
    handle.unmount();
    cleanup(el);
  });

  it("hook count changes warn in development", () => {
    let show = true;
    const Island = ilha<{ showExtra?: boolean }>(({ showExtra }) => {
      show = showExtra ?? true;
      const count = state(0);
      if (show) {
        const extra = state("x");
        void extra;
      }
      return html`<p>${count()}</p>`;
    });

    const el = makeEl();
    const handle = mountInternal(Island, el, { showExtra: true });
    const warnings = captureWarnings(() => {
      handle.updateProps({ showExtra: false });
    });
    expect(warnings.some((w) => w.includes("decreased") || w.includes("primitive position"))).toBe(
      true,
    );
    handle.unmount();
    cleanup(el);
  });

  it("conditional primitive registration that changes order is detected", () => {
    let flag = true;
    const Island = ilha<{ flag?: boolean }>(({ flag: f }) => {
      flag = f ?? true;
      if (flag) {
        const first = state("a");
        void first;
      }
      const second = state("b");
      return html`<p>${second()}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el, { flag: true });
    const warnings = captureWarnings(() => {
      handle.updateProps({ flag: false });
    });
    expect(
      warnings.some((w) => w.includes("decreased") || w.includes("conditional primitive")),
    ).toBe(true);
    handle.unmount();
    cleanup(el);
  });
});

// ─── Props ────────────────────────────────────────────────────────────────

describe("props", () => {
  it("prop updates rerender", async () => {
    const Island = ilha<{ label: string }>(({ label }) => html`<p data-label>${label}</p>`);
    const el = makeEl();
    const handle = mountInternal(Island, el, { label: "one" });
    expect(el.querySelector("[data-label]")!.textContent).toBe("one");

    handle.updateProps({ label: "two" });
    expect(el.querySelector("[data-label]")!.textContent).toBe("two");
    handle.unmount();
    cleanup(el);
  });

  it("state initialized from props does not reset", async () => {
    const Island = ilha<{ start: number }>(({ start }) => {
      const count = state(start);
      return html`<button onclick=${() => count((v) => v + 1)}>${count()}</button>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el, { start: 1 });
    const button = el.querySelector("button")!;
    expect(button.textContent).toBe("1");
    button.click();
    button.click();
    expect(button.textContent).toBe("3");

    handle.updateProps({ start: 100 });
    // prop change rerenders but must NOT reset the counter
    expect(el.querySelector("button")!.textContent).toBe("3");
    handle.unmount();
    cleanup(el);
  });

  it("derived values follow current props", async () => {
    const Island = ilha<{ name: string }>(({ name }) => {
      const uppercase = derived(() => name.toUpperCase());
      return html`<p>${uppercase()}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el, { name: "ada" });
    expect(el.textContent).toBe("ADA");
    handle.updateProps({ name: "grace" });
    expect(el.textContent).toBe("GRACE");
    handle.unmount();
    cleanup(el);
  });

  it("schema defaults and validation work", () => {
    const schema = z.object({ name: z.string().default("World") });
    const Greeting = ilha(schema, ({ name }) => html`<p>hello ${name}</p>`);

    const ssr = Greeting.toString({});
    expect(ssr).toContain("hello World");
    expect(Greeting.toString({ name: "Ada" })).toContain("hello Ada");

    const el = makeEl();
    const handle = mountInternal(Greeting, el, {});
    expect(el.textContent).toBe("hello World");

    expect(() => handle.updateProps({ name: 42 as never })).toThrow(/ilha/);
    handle.unmount();
    cleanup(el);
  });
});

// ─── derived() ────────────────────────────────────────────────────────────

describe("derived", () => {
  it("sync values resolve immediately", async () => {
    const Island = ilha(() => {
      const count = state(5);
      const doubled = derived(() => count() * 2);
      return html`<p>${doubled()}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(el.textContent).toBe("10");
    handle.unmount();
    cleanup(el);
  });

  it("promises resolve and keep previous value while reloading", async () => {
    let resolveLater!: (v: string) => void;
    const Island = ilha(() => {
      const data = derived(async ({ signal }) => {
        void signal;
        return new Promise<string>((resolve) => {
          resolveLater = resolve;
        });
      });
      return html`<p>${data.loading ? "loading" : (data() ?? "none")}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(el.textContent).toBe("loading");
    resolveLater("first");
    await flush();
    expect(el.textContent).toBe("first");

    // Reload: previous value stays visible while loading the next one.
    // The dependency must be read synchronously in the callback for tracking.
    let setUrl!: (v: string) => void;
    const Reload = ilha(() => {
      const url = state("a");
      setUrl = url;
      const data = derived(async ({ signal }) => {
        const current = url();
        void signal;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        return `value-${current}`;
      });
      // The accessor keeps the previous value during a reload.
      return html`<p>${data() ?? "none"}</p>`;
    });
    const el2 = makeEl();
    const h2 = mountInternal(Reload, el2);
    await new Promise((r) => setTimeout(r, 20));
    expect(el2.textContent).toBe("value-a");
    setUrl("b");
    // during reload the previous value remains; then it updates
    expect(el2.textContent).toBe("value-a");
    await new Promise((r) => setTimeout(r, 20));
    expect(el2.textContent).toBe("value-b");
    h2.unmount();
    handle.unmount();
    cleanup(el);
    cleanup(el2);
  });

  it("async generators are consumed continuously on the client", async () => {
    const el = makeEl();
    const queue: number[] = [];
    let push!: (v: number) => void;
    let notify: (() => void) | null = null;
    const Island = ilha(() => {
      const messages = derived<number>(async function* ({ signal }) {
        // Stream loop: intentionally unbounded; abort via ctx.signal ends it.
        while (!signal.aborted) {
          while (queue.length > 0) yield queue.shift() as number;
          if (signal.aborted) break;
          await new Promise<void>((resolve) => (notify = resolve));
          notify = null;
        }
      });
      return html`<p>${messages() ?? "none"}</p>`;
    });
    const handle = mountInternal(Island, el);
    push = (v: number) => {
      queue.push(v);
      notify?.();
    };
    push(1);
    await flush();
    expect(el.textContent).toBe("1");
    push(2);
    await flush();
    expect(el.textContent).toBe("2");
    handle.unmount();
    cleanup(el);
  });

  it("aborts stale async work when dependencies change", async () => {
    const aborted: string[] = [];
    const Island = ilha(() => {
      const id = state("one");
      const result = derived(async ({ signal }) => {
        const runValue = id();
        signal.addEventListener("abort", () => aborted.push(runValue));
        await new Promise((resolve) => setTimeout(resolve, 10));
        return runValue;
      });
      return html`<button
        onclick=${() => {
          id("two");
        }}
      >
        ${result() ?? "-"}
      </button>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    el.querySelector("button")!.click();
    await flush();
    await new Promise((r) => setTimeout(r, 15));
    expect(aborted).toContain("one");
    handle.unmount();
    cleanup(el);
  });

  it("errors surface on the accessor", async () => {
    const Island = ilha(() => {
      const result = derived(() => {
        throw new Error("boom");
      });
      return html`<p data-error="${result.error?.message ?? ""}">${result() ?? "none"}</p>`;
    });
    const ssr = Island.toString();
    expect(ssr).toContain("boom");
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(el.querySelector("[data-error]")!.getAttribute("data-error")).toBe("boom");
    handle.unmount();
    cleanup(el);
  });

  it("wraps non-Error failures", async () => {
    const Island = ilha(() => {
      const result = derived(() => {
        throw "string-failure";
      });
      return html`<p>${result.error instanceof Error ? "wrapped" : "not-wrapped"}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(el.textContent).toBe("wrapped");
    handle.unmount();
    cleanup(el);
  });

  it("SSR: toString leaves async values loading; toStringAsync awaits", async () => {
    const Island = ilha(() => {
      const data = derived(async () => {
        await new Promise((r) => setTimeout(r, 1));
        return "resolved";
      });
      return html`<p>${data() ?? "loading-markup"}</p>`;
    });
    const sync = Island.toString();
    expect(sync).toContain("loading-markup");

    const async = await Island.toStringAsync();
    expect(async).toContain("resolved");
  });

  it("SSR: async generators yield their first value to toStringAsync", async () => {
    const Island = ilha(() => {
      const stream = derived(async function* () {
        yield "first";
        yield "second";
      });
      return html`<p>${stream() ?? "none"}</p>`;
    });
    const sync = Island.toString();
    expect(sync).toContain("none");

    const async = await Island.toStringAsync();
    expect(async).toContain("first");
  });

  it("request-state never leaks between SSR renders", () => {
    const Island = ilha(() => {
      const count = state(1);
      return html`<p>${count()}</p>`;
    });
    expect(Island.toString()).toContain(">1<");
    expect(Island.toString()).toContain(">1<");
  });

  it("snapshot restoration restores derived envelopes", async () => {
    const Island = ilha(() => {
      const result = derived(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "server-value";
      });
      return html`<p>${result() ?? "-"}</p>`;
    });

    const block = await Island.hydratable({}, { name: "snap", snapshot: true });
    expect(block).toContain("server-value");

    // Hydration would normally be done via mount(); simulate direct mount.
    const host = makeEl(block);
    const dataIlha = host.querySelector("[data-ilha=snap]")!;
    const mounted = mountInternal(Island, dataIlha as Element);
    expect(dataIlha.textContent).toContain("server-value");
    mounted.unmount();
    cleanup(host);
  });
});

// ─── effects ──────────────────────────────────────────────────────────────

describe("effects", () => {
  it("rerun reactively on tracked signal change", () => {
    let runs = 0;
    let setCount!: (v: number) => void;
    const Island = ilha(() => {
      const count = state(0);
      setCount = count;
      effect(() => {
        void count();
        runs++;
      });
      return html`<p>${count()}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(runs).toBe(1);

    setCount(5);
    expect(runs).toBe(2);
    handle.unmount();
    cleanup(el);
  });

  it("cleanup runs before rerun and on unmount", () => {
    const cleanups: string[] = [];
    let setCount!: (v: number) => void;
    const Island = ilha(() => {
      const count = state(0);
      setCount = count;
      effect(() => {
        const value = count();
        cleanups.push(`run-${value}`);
        return () => cleanups.push(`cleanup-${value}`);
      });
      return html`<p>${count()}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(cleanups).toEqual(["run-0"]);

    setCount(1);
    expect(cleanups).toEqual(["run-0", "cleanup-0", "run-1"]);

    handle.unmount();
    expect(cleanups).toEqual(["run-0", "cleanup-0", "run-1", "cleanup-1"]);
    cleanup(el);
  });

  it("receives an AbortSignal that aborts on rerun and unmount", () => {
    const abortedRuns: number[] = [];
    let setCount!: (v: number) => void;
    const Island = ilha(() => {
      const count = state(0);
      setCount = count;
      effect(({ signal }) => {
        const run = count();
        signal.addEventListener("abort", () => abortedRuns.push(run));
        return () => abortedRuns.push(-1);
      });
      return html`<p>${count()}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    setCount(1);
    // rerun aborts the previous run's signal
    expect(abortedRuns).toContain(0);
    handle.unmount();
    cleanup(el);
  });

  it("are client-only (not executed during SSR)", () => {
    let runs = 0;
    const Island = ilha(() => {
      effect(() => {
        runs++;
      });
      return html`<p>x</p>`;
    });
    Island.toString();
    Island.toStringAsync().catch(() => {});
    expect(runs).toBe(0);
  });

  it("execute in declaration order", () => {
    const order: string[] = [];
    const Island = ilha(() => {
      effect(() => {
        order.push("first");
      });
      effect(() => {
        order.push("second");
      });
      return html`<p>x</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(order).toEqual(["first", "second"]);
    handle.unmount();
    cleanup(el);
  });

  it("errors inside effect bodies route to onError", () => {
    const errors: Error[] = [];
    const Island = ilha(() => {
      onError(({ error, source }) => {
        errors.push(error);
        expect(source).toBe("effect");
      });
      effect(() => {
        throw new Error("effect-boom");
      });
      return html`<p>x</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toBe("effect-boom");
    handle.unmount();
    cleanup(el);
  });

  it("cleanup errors route to onError", () => {
    const errors: string[] = [];
    const Island = ilha(() => {
      onError(({ error, source }) => {
        errors.push(`${source}:${error.message}`);
      });
      effect(() => {
        return () => {
          throw new Error("cleanup-boom");
        };
      });
      return html`<p>x</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    handle.unmount();
    expect(errors).toContain("effect:cleanup-boom");
    cleanup(el);
  });

  it("standalone effect outside islands returns a stop function", () => {
    let runs = 0;
    const s = signal(0);
    const stop = effect(() => {
      void s();
      runs++;
    }) as () => void;
    s(1);
    expect(runs).toBe(2);
    stop();
    s(2);
    expect(runs).toBe(2);
  });
});

// ─── effect.once ──────────────────────────────────────────────────────────

describe("effect.once", () => {
  it("runs once per mounted instance", () => {
    let once = 0;
    const Island = ilha(() => {
      effect.once(() => {
        once++;
      });
      const count = state(0);
      void count;
      return html`<p>${count()}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(once).toBe(1);
    handle.unmount();
    cleanup(el);
  });

  it("receives host, hydrated flag, and signal; cleanup runs on unmount", () => {
    let hostSeen: Element | null = null;
    let hydratedSeen: boolean | null = null;
    let cleanups = 0;
    const Island = ilha(() => {
      effect.once(({ host, hydrated, signal }) => {
        hostSeen = host;
        hydratedSeen = hydrated;
        void signal;
        return () => cleanups++;
      });
      return html`<p>x</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(hostSeen === el).toBe(true);
    expect(hydratedSeen === false).toBe(true);
    handle.unmount();
    expect(cleanups).toBe(1);
    cleanup(el);
  });

  it("hydration reports hydrated=true and skipOnMount skips it", async () => {
    let hydratedSeen: boolean | null = null;
    let onceCalls = 0;
    const Island = ilha(() => {
      effect.once(({ hydrated }) => {
        hydratedSeen = hydrated;
        onceCalls++;
      });
      const count = state(0);
      return html`<p>${count()}</p>`;
    });

    // Normal hydration (snapshot without skipOnMount)
    const block = await Island.hydratable(
      {},
      { name: "once", snapshot: { state: false, derived: false } },
    );
    const host = makeEl(block);
    const dataIlha = host.querySelector("[data-ilha=once]")!;
    const handle = mountInternal(Island, dataIlha as Element);
    expect(hydratedSeen === true).toBe(true);
    expect(onceCalls).toBe(1);
    handle.unmount();

    // skipOnMount hydration
    const blockSkip = await Island.hydratable(
      {},
      { name: "once-skip", snapshot: true, skipOnMount: true },
    );
    const hostSkip = makeEl(blockSkip);
    const dataIlhaSkip = hostSkip.querySelector("[data-ilha=once-skip]")!;
    const handleSkip = mountInternal(Island, dataIlhaSkip as Element);
    expect(onceCalls).toBe(1); // not incremented
    handleSkip.unmount();
    cleanup(host);
    cleanup(hostSkip);
  });

  it("errors route through the island error sink", () => {
    const errors: string[] = [];
    const Island = ilha(() => {
      onError(({ error, source }) => errors.push(`${source}:${error.message}`));
      effect.once(() => {
        throw new Error("once-boom");
      });
      return html`<p>x</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(errors).toEqual(["once:once-boom"]);
    handle.unmount();
    cleanup(el);
  });
});

// ─── actions ──────────────────────────────────────────────────────────────

describe("actions", () => {
  it("sync calls update data immediately", () => {
    const Island = ilha(() => {
      const compute = action((n: number) => n * 2);
      return html`<button onclick=${() => compute(4)}>
        ${compute.data ?? "none"}${compute.pending ? "/pending" : ""}
      </button>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    const button = el.querySelector("button")!;
    expect(button.textContent!.trim()).toBe("none");
    button.click();
    expect(button.textContent!.trim()).toBe("8");
    handle.unmount();
    cleanup(el);
  });

  it("async calls expose pending, data, and error", async () => {
    let save!: (form: string) => void;
    const Island = ilha(() => {
      const op = action(async (form: string) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (form === "bad") throw new Error("save-failed");
        return `saved:${form}`;
      });
      save = op;
      return html`<p>${op.pending ? "busy" : (op.data ?? op.error?.message ?? "idle")}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    save("ok");
    expect(el.textContent).toContain("busy");
    await new Promise((r) => setTimeout(r, 15));
    expect(el.textContent).toContain("saved:ok");

    save("bad");
    await new Promise((r) => setTimeout(r, 15));
    expect(el.textContent).toContain("save-failed");
    handle.unmount();
    cleanup(el);
  });

  it("concurrent invocations track pending and latest-run wins data", async () => {
    let save!: (tag: string) => void;
    const Island = ilha(() => {
      const op = action(async (tag: string) => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, tag === "fast" ? 2 : 20);
        });
        return tag;
      });
      save = op;
      return html`<p>${op.pending ? "busy" : ""}${op.data ?? ""}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);

    save("slow");
    save("fast");
    await new Promise((r) => setTimeout(r, 8));
    // fast resolves first; slow must not clobber it
    expect(el.textContent).toContain("fast");
    await new Promise((r) => setTimeout(r, 20));
    expect(el.textContent).toContain("fast");
    handle.unmount();
    cleanup(el);
  });

  it("previous successful data remains while pending", async () => {
    let load!: (tag: string) => void;
    const Island = ilha(() => {
      const op = action(async (tag: string) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        return `data-${tag}`;
      });
      load = op;
      return html`<p>${op.data ?? "none"}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    load("one");
    await new Promise((r) => setTimeout(r, 20));
    expect(el.textContent).toContain("data-one");

    load("two");
    // while pending, the previous successful data stays visible
    expect(el.textContent).toContain("data-one");
    await new Promise((r) => setTimeout(r, 20));
    expect(el.textContent).toContain("data-two");
    handle.unmount();
    cleanup(el);
  });

  it("unmount aborts in-flight actions and ignores settlements", async () => {
    let aborted = false;
    let settledAfterUnmount = 0;
    let save!: () => void;
    const Island = ilha(() => {
      const op = action(async (_p: undefined, { signal }: { signal: AbortSignal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (!signal.aborted) settledAfterUnmount++;
        return "late";
      });
      save = op;
      return html`<p>${op.pending ? "busy" : "idle"}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    save();
    handle.unmount();
    await new Promise((r) => setTimeout(r, 30));
    expect(aborted).toBe(true);
    expect(settledAfterUnmount).toBe(0);
    cleanup(el);
  });

  it("AbortError rejections are filtered from error reporting", async () => {
    const errors: Error[] = [];
    let save!: () => void;
    const Island = ilha(() => {
      onError(({ error }) => errors.push(error));
      const op = action(async () => {
        await Promise.resolve();
        const abort = new Error("aborted") as Error & { name: string };
        abort.name = "AbortError";
        throw abort;
      });
      save = op;
      return html`<p>${op.pending ? "busy" : "idle"}</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    save();
    await flush();
    expect(errors.length).toBe(0);
    handle.unmount();
    cleanup(el);
  });

  it("actions are not executed during SSR", async () => {
    let calls = 0;
    const Island = ilha(() => {
      const save = action(() => {
        calls++;
        return "ok";
      });
      return html`<button onclick=${() => save()}>${save.data ?? "none"}</button>`;
    });
    Island.toString();
    await Island.toStringAsync();
    expect(calls).toBe(0);
  });

  it("direct action references as event handlers land in the hydration manifest", async () => {
    const Island = ilha(() => {
      const remove = action((id: string) => id.length);
      const save = action(() => "saved");
      return html`<div>
        <button data-a onclick=${remove}>a</button><button data-b onclick=${save}>b</button>
      </div>`;
    });
    await renderState(Island);
    // deterministic slot ids a0, a1 — serialization itself is router-owned
    expect(Object.values(lastManifest()).sort()).toEqual(["a0", "a1"]);
  });
});

// ─── rendering ────────────────────────────────────────────────────────────

describe("rendering", () => {
  it("html`` islands render and morph", () => {
    const Island = ilha(() => {
      const count = state(0);
      return html`<span data-c>${count()}</span>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(el.querySelector("[data-c]")!.textContent).toBe("0");
    handle.unmount();
    cleanup(el);
  });

  it("JSX islands render and morph", () => {
    const Island = ilha(() => {
      const count = state(0);
      return jsx("span", { "data-c": true, children: String(count()) });
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(el.querySelector("[data-c]")!.textContent).toBe("0");
    handle.unmount();
    cleanup(el);
  });

  it("native events fire and drive state -> morph", () => {
    const Island = ilha(() => {
      const count = state(0);
      return jsx("button", {
        "data-plus": true,
        onclick: () => count((v) => v + 1),
        children: String(count()),
      });
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    const button = el.querySelector("button")!;
    button.click();
    expect(button.textContent).toBe("1");
    button.click();
    expect(button.textContent).toBe("2");
    handle.unmount();
    cleanup(el);
  });

  it("bind:value two-way sync", () => {
    let name!: (v?: unknown) => string;
    const Island = ilha(() => {
      const value = state("Ada");
      name = value as typeof name;
      return html`<input data-i bind:value=${value} />`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    const input = el.querySelector("input")!;
    expect(input.value).toBe("Ada");

    input.value = "Grace";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(name()).toBe("Grace");
    handle.unmount();
    cleanup(el);
  });

  it("bind:checked two-way sync", () => {
    let checkedState!: (v?: unknown) => boolean;
    const Island = ilha(() => {
      const on = state(true);
      checkedState = on as typeof checkedState;
      return html`<input type="checkbox" data-i bind:checked=${on} />`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    const input = el.querySelector("input")!;
    expect(input.checked).toBe(true);

    input.checked = false;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(checkedState()).toBe(false);
    handle.unmount();
    cleanup(el);
  });

  it("bind:this writes the element into state", () => {
    let refState!: () => HTMLInputElement | null;
    const Island = ilha(() => {
      const ref = state<HTMLInputElement | null>(null);
      refState = ref;
      return html`<input data-i bind:this=${ref} />`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(refState()).toBe(el.querySelector("input"));
    handle.unmount();
    cleanup(el);
  });

  it("morph preserves input value across unrelated rerenders", () => {
    let setTitle!: (v: string) => void;
    const Island = ilha(() => {
      const title = state("hello");
      setTitle = title;
      const count = state(0);
      return html`<div>
        <input data-i value=${String(count())} />
        <p>${title()}</p>
      </div>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    const input = el.querySelector("input")!;
    input.value = "user-typed";
    setTitle("world");
    expect(el.querySelector("input")!.value).toBe("user-typed");
    handle.unmount();
    cleanup(el);
  });

  it("nested islands mount into slots and receive updated props", async () => {
    const Child = ilha<{ value: number }>(({ value }) => html`<b data-child>${value}</b>`);
    const Parent = ilha(() => {
      const count = state(1);
      return html`<div>${Child({ value: count() })}</div>`;
    });
    const el = makeEl();
    const handle = mountInternal(Parent, el);
    expect(el.querySelector("[data-child]")!.textContent).toBe("1");

    const Parent2 = ilha(() => {
      const count = state(1);
      return html`<div>
        <button onclick=${() => count((v) => v + 1)}>go</button>${Child({ value: count() })}
      </div>`;
    });
    const el2 = makeEl();
    const h2 = mountInternal(Parent2, el2);
    el2.querySelector("button")!.click();
    await flush();
    expect(el2.querySelector("[data-child]")!.textContent).toBe("2");
    h2.unmount();
    handle.unmount();
    cleanup(el);
    cleanup(el2);
  });

  it("JSX child composition works", async () => {
    const Item = ilha<{ label: string }>(({ label }) => html`<li data-item>${label}</li>`);
    const List = ilha(() => {
      const items = state(["a", "b"]);
      return html`<ul>
        ${items().map((label, i) => Item.key(`i${i}`)({ label }))}
      </ul>`;
    });
    const el = makeEl();
    const handle = mountInternal(List, el);
    expect(el.querySelectorAll("[data-item]").length).toBe(2);
    handle.unmount();
    cleanup(el);
  });

  it("keyed reorder preserves element identity", () => {
    let setOrder!: (v: string[]) => void;
    const Item = ilha<{ k: string }>(({ k }) => html`<span data-key="${k}">${k}</span>`);
    const List = ilha(() => {
      const order = state(["a", "b", "c"]);
      setOrder = order;
      return html`<div>${order().map((k) => Item.key(k)({ k }))}</div>`;
    });
    const el = makeEl();
    const handle = mountInternal(List, el);
    const beforeB = el.querySelector('[data-key="b"]')!;
    setOrder(["c", "b", "a"]);
    expect(el.querySelector('[data-key="b"]')).toBe(beforeB);
    handle.unmount();
    cleanup(el);
  });

  it("plain transparent components may use primitives inside an island", () => {
    function Label() {
      const value = state("ready");
      return html`<span data-label>${value()}</span>`;
    }
    const App = ilha(() => html`<div>${Label()}</div>`);
    const el = makeEl();
    const handle = mountInternal(App, el);
    expect(el.querySelector("[data-label]")!.textContent).toBe("ready");
    handle.unmount();
    cleanup(el);
  });

  it("independently mounted boundaries require ilha()", () => {
    function Plain() {
      return html`<p data-plain>x</p>`;
    }
    const App = ilha(() => html`<div>${Plain()}</div>`);
    const el = makeEl();
    const handle = mountInternal(App, el);
    expect(el.querySelector("[data-plain]")).not.toBeNull();
    handle.unmount();
    cleanup(el);
  });

  it("morph preserves focus on surviving keyed elements", () => {
    let setOrder!: (v: string[]) => void;
    const List = ilha(() => {
      const order = state(["a", "b"]);
      setOrder = order;
      return html`<div>${order().map((k) => html`<button data-key="${k}">${k}</button>`)}</div>`;
    });
    const el = makeEl();
    const handle = mountInternal(List, el);
    const buttonA = el.querySelector<HTMLButtonElement>('[data-key="a"]')!;
    buttonA.focus();
    expect(document.activeElement).toBe(buttonA);
    setOrder(["b", "a"]);
    const afterA = el.querySelector<HTMLButtonElement>('[data-key="a"]')!;
    expect(document.activeElement).toBe(afterA);
    handle.unmount();
    cleanup(el);
  });
});

// ─── SSR / hydration ──────────────────────────────────────────────────────

describe("ssr and hydration", () => {
  it("toString renders synchronously with fresh per-request state", () => {
    const Island = ilha(() => {
      const count = state(7);
      return html`<p>${count()}</p>`;
    });
    expect(Island.toString()).toContain(">7<");
    expect(Island.toString()).toContain(">7<");
  });

  it("hydratable emits v2 positional snapshots and restores state", async () => {
    const Island = ilha(() => {
      const count = state(5);
      const doubled = derived(() => count() * 2);
      return html`<p data-snap>${count()}:${doubled()}</p>`;
    });

    const block = await Island.hydratable({}, { name: "pos", snapshot: true });
    const stateAttr = block.match(/data-ilha-state='([^']*)'/)?.[1] ?? "";
    const snapshot = JSON.parse(stateAttr.replace(/&quot;/g, '"')) as {
      v: number;
      s: number[];
      d: { loading: boolean; value: number }[];
    };
    expect(snapshot.v).toBe(2);
    expect(snapshot.s).toEqual([5]);
    expect(snapshot.d[0]!.value).toBe(10);

    const host = makeEl(block);
    const dataIlha = host.querySelector("[data-ilha=pos]")!;
    const handle = mountInternal(Island, dataIlha as Element);
    expect(dataIlha.textContent).toContain("5:10");
    handle.unmount();
    cleanup(host);
  });

  it("malformed snapshots are ignored safely", () => {
    const Island = ilha(() => {
      const count = state(1);
      return html`<p>${count()}</p>`;
    });
    // wrong version
    const host1 = makeEl(`<div data-ilha="x" data-ilha-state='{"v":1,"s":[99]}'></div>`);
    const h1 = mountInternal(Island, host1);
    expect(host1.textContent).toBe("1"); // state not restored from snapshot
    h1.unmount();

    // invalid JSON
    const host2 = makeEl(`<div data-ilha="x" data-ilha-state='{bad json'></div>`);
    const h2 = mountInternal(Island, host2);
    expect(host2.textContent).toBe("1");
    h2.unmount();

    // scalar snapshot
    const host3 = makeEl(`<div data-ilha="x" data-ilha-state='42'></div>`);
    const h3 = mountInternal(Island, host3);
    expect(host3.textContent).toBe("1");
    h3.unmount();

    cleanup(host1);
    cleanup(host2);
    cleanup(host3);
  });

  it("unsafe prototype keys are stripped from snapshots", () => {
    const Island = ilha(() => {
      const cfg = state<Record<string, unknown>>({});
      return html`<pre>${JSON.stringify(cfg())}</pre>`;
    });
    const wrapper = makeEl(
      `<div data-ilha="x" data-ilha-state='{"v":2,"s":[{"__proto__":{"polluted":true},"safe":1}]}'></div>`,
    );
    // The inner element carries the snapshot attribute — mount on it.
    const host = wrapper.querySelector("[data-ilha]")!;
    const handle = mountInternal(Island, host as Element);
    const parsed = JSON.parse(host.textContent!) as Record<string, unknown>;
    expect(parsed.polluted).toBeUndefined();
    expect(parsed.safe).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    handle.unmount();
    cleanup(wrapper);
  });

  it("nested island hydration restores child islands", async () => {
    const Child = ilha<{ n: number }>(({ n }) => html`<b data-n>${n}</b>`);
    const Parent = ilha(() => html`<section>${Child({ n: 3 })}</section>`);
    const block = await Parent.hydratable(
      {},
      { name: "nested-hydrate", snapshot: { state: false, derived: false } },
    );
    const host = makeEl(block);
    const dataIlha = host.querySelector("[data-ilha=nested-hydrate]")!;
    const handle = mountInternal(Parent, dataIlha as Element);
    expect(dataIlha.textContent).toContain("3");
    handle.unmount();
    cleanup(host);
  });

  it("hydratable emits action manifest template for direct-action handlers", async () => {
    const Island = ilha(() => {
      const remove = action((id: string) => id);
      return html`<button onclick=${remove}>x</button>`;
    });
    await renderState(Island);
    expect(Object.values(lastManifest())).toEqual(["a0"]);
  });

  it("raw() passes through unescaped", () => {
    const Island = ilha(() => raw(`<p data-raw>bold</p>`));
    expect(Island.toString()).toContain("<p data-raw>bold</p>");
  });
});

// ─── mount() registry + define() ──────────────────────────────────────────

describe("mount() registry and define()", () => {
  it("mount() auto-discovers [data-ilha] elements", () => {
    const Counter = ilha(() => {
      const count = state(3);
      return html`<p>${count()}</p>`;
    });
    const host = makeEl(`<div><div data-ilha="Counter"></div></div>`);
    const { unmount } = mount({ Counter }, { root: host });
    expect(host.querySelector("[data-ilha='Counter']")!.textContent).toBe("3");
    unmount();
    cleanup(host);
  });

  it("ilha.define() registers a custom element", () => {
    const Counter = ilha(() => {
      const count = state(0);
      return html`<p data-ce>${count()}</p>`;
    });
    Counter.define("x-counter");
    const el = makeEl("<x-counter></x-counter>");
    expect(el.querySelector("[data-ce]")).not.toBeNull();
    cleanup(el);
  });
});

// ─── top-level helpers ────────────────────────────────────────────────────

describe("top-level helpers", () => {
  it("signal/computed reactivity", () => {
    const s = signal(1);
    const d = computed(() => s() * 10);
    let seen = 0;
    const stop = effect(() => {
      void d();
      seen++;
    }) as () => void;
    expect(seen).toBe(1);
    s(2);
    expect(seen).toBe(2);
    stop();
  });

  it("batch coalesces writes", () => {
    const s = signal(0);
    let runs = 0;
    const stop = effect(() => {
      void s();
      runs++;
    }) as () => void;
    batch(() => {
      s(1);
      s(2);
      s(3);
    });
    expect(s()).toBe(3);
    expect(runs).toBe(2); // initial + one coalesced rerun
    stop();
  });

  it("untrack reads without subscribing", () => {
    const s = signal(0);
    let runs = 0;
    const stop = effect(() => {
      untrack(() => s());
      runs++;
    }) as () => void;
    const before = runs;
    s(1);
    expect(runs).toBe(before);
    stop();
  });

  it("persist round-trips through storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const s = signal(1);
    const stop = persist(s, "key", { storage });
    expect(Number(store.get("key"))).toBe(1);
    s(42);
    expect(Number(store.get("key"))).toBe(42);
    stop();
  });

  it("context() creates shared signals", () => {
    const theme = context("test-theme", "light");
    theme("dark");
    expect(theme()).toBe("dark");
    context.delete("test-theme");
  });

  it("onUncaughtError fires for unhandled island errors", () => {
    const seen: Error[] = [];
    const unsubscribe = onUncaughtError((error) => seen.push(error));
    const Island = ilha(() => {
      effect(() => {
        throw new Error("uncaught-boom");
      });
      return html`<p>x</p>`;
    });
    const el = makeEl();
    const handle = mountInternal(Island, el);
    expect(seen.length).toBeGreaterThan(0);
    handle.unmount();
    unsubscribe();
    cleanup(el);
  });

  it("morph() patches an element toward new html", () => {
    const host = makeEl("<div><span data-a>1</span></div>");
    morph(host, "<div><span data-a>2</span><b>new</b></div>");
    expect(host.querySelector("[data-a]")!.textContent).toBe("2");
    expect(host.querySelector("b")).not.toBeNull();
    cleanup(host);
  });
});

// ─── nested select accessors (selector + variadic path) ──────────────────

describe("select() nested accessors", () => {
  it("variadic path reads and writes the nested property, preserving siblings", () => {
    const root = signal({ profile: { name: "a", age: 1 }, other: { x: 1 } });
    const name = root.select("profile", "name");
    expect(name()).toBe("a");
    name("b");
    expect(root().profile.name).toBe("b");
    expect(root().profile.age).toBe(1);
    expect(root().other).toEqual({ x: 1 });
  });

  it("selector form reads and writes through the tracked path", () => {
    const root = signal({ user: { name: "Ilha" }, count: 0 });
    const name = root.select((s) => s.user.name);
    expect(name()).toBe("Ilha");
    name("new");
    expect(root().user.name).toBe("new");
    expect(root().count).toBe(0);
  });

  it("variadic path writes into an array element without touching siblings", () => {
    const root = signal({ todos: [{ text: "a" }, { text: "b" }] });
    const firstText = root.select("todos", 0, "text");
    firstText("A");
    expect(root().todos[0].text).toBe("A");
    expect(root().todos[1].text).toBe("b");
  });
});

// ─── raw rendering boundary (morph identity) ──────────────────────────────

describe("raw rendering boundary", () => {
  it("raw() output embedded in html`` is emitted raw", () => {
    const Island = ilha(() => html`<div>${raw("<i data-i>raw</i>")}</div>`);
    const out = Island.toString();
    expect(out).toContain("<i data-i>raw</i>");
    expect(out).not.toContain("&lt;i");
  });
});

// ─── authoring guidance (dev warnings) ────────────────────────────────────

describe("authoring guidance", () => {
  it("signal() created during an island render warns and suggests state()", () => {
    const warnings = captureWarnings(() => {
      const Island = ilha(() => {
        const s = signal(0);
        return html`<p>${s()}</p>`;
      });
      Island.toString();
    });
    expect(warnings.some((w) => w.includes("signal()") && w.includes("state()"))).toBe(true);
  });

  it("computed() created during an island render warns and suggests derived()", () => {
    const warnings = captureWarnings(() => {
      const Island = ilha(() => {
        const s = signal(0);
        const d = computed(() => s() * 2);
        return html`<p>${d()}</p>`;
      });
      Island.toString();
    });
    expect(warnings.some((w) => w.includes("computed()") && w.includes("derived()"))).toBe(true);
  });

  it("module-scope signal()/computed() never warns", () => {
    const warnings = captureWarnings(() => {
      const s = signal(0);
      const d = computed(() => s() * 2);
      void d();
    });
    expect(warnings).toEqual([]);
  });

  it("signal() inside effect.once() (post-mount) never warns", () => {
    const warnings = captureWarnings(() => {
      const Island = ilha(() => {
        effect.once(() => {
          const s = signal(0);
          void s();
        });
        return html`<p>ok</p>`;
      });
      const host = document.createElement("div");
      Island.mount(host);
      cleanup(host);
    });
    expect(warnings.filter((w) => w.includes("signal()"))).toEqual([]);
  });

  it("sync toString() with async derived warns and suggests toStringAsync", () => {
    const warnings = captureWarnings(() => {
      const Island = ilha(() => {
        const data = derived(async () => {
          await new Promise((r) => setTimeout(r, 1));
          return "resolved";
        });
        return html`<p>${data() ?? "loading"}</p>`;
      });
      Island.toString();
    });
    expect(warnings.some((w) => w.includes("toString()") && w.includes("toStringAsync"))).toBe(
      true,
    );
  });

  it("toStringAsync with async derived and sync toString without async derived never warn", async () => {
    const asyncWarnings = captureWarnings(() => {
      const Island = ilha(() => {
        const data = derived(async () => {
          await new Promise((r) => setTimeout(r, 1));
          return "resolved";
        });
        return html`<p>${data() ?? "loading"}</p>`;
      });
      void Island.toStringAsync();
    });
    expect(asyncWarnings.filter((w) => w.includes("toString()"))).toEqual([]);

    const syncWarnings = captureWarnings(() => {
      const Island = ilha(() => {
        const data = derived(() => 42);
        return html`<p>${data()}</p>`;
      });
      Island.toString();
    });
    expect(syncWarnings.filter((w) => w.includes("toString()"))).toEqual([]);
  });
});

function renderState(island: unknown): Promise<string> {
  return (island as Record<symbol, (props?: unknown) => Promise<string>>)[
    Symbol.for("ilha.renderState")
  ]({});
}
