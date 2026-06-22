// =============================================================================
// @ilha/store — test suite (fluent builder API)
// Run with: bun test --dom (happy-dom needed for bind()/island tests)
// =============================================================================

import { describe, it, expect, mock, beforeEach } from "bun:test";

import { effect } from "alien-signals";
import ilha, { html } from "ilha";
import { z } from "zod";

import { store, effectScope, StoreValidationError } from "./index";

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// store() factory + builder
// ---------------------------------------------------------------------------

describe("store() builder", () => {
  it("store(initial) returns a builder, not a built store", () => {
    const builder = store({ count: 0 });
    expect(typeof (builder as { build?: unknown }).build).toBe("function");
    // A builder is not callable as a state accessor.
    expect((builder as unknown as { count?: unknown }).count).toBeUndefined();
  });

  it(".build() returns a flat store with state/derived/action/builtins", () => {
    const s = store({ count: 0 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .action("inc", (_, ctx) => ({ count: ctx.get().count + 1 }))
      .build();

    expect(typeof s.count).toBe("function");
    expect(typeof s.doubled).toBe("function");
    expect(typeof s.inc).toBe("function");
    expect(typeof s.setState).toBe("function");
    expect(typeof s.subscribe).toBe("function");
    expect(typeof s.select).toBe("function");
    expect(typeof s.bind).toBe("function");
    expect(typeof s.getState).toBe("function");
    expect(typeof s.getInitialState).toBe("function");
  });

  it("builder methods are immutable — each returns a new builder", () => {
    const b0 = store({ count: 0 });
    const b1 = b0.action("inc", (_, ctx) => ({ count: ctx.get().count + 1 }));
    expect(b1).not.toBe(b0);
    // b0 has no actions; building it yields a store without inc.
    const s0 = b0.build();
    expect((s0 as unknown as { inc?: unknown }).inc).toBeUndefined();
  });

  it("accepts an explicit type argument for POJO stores", () => {
    type Model = { foo: string; n: number };
    const s = store<Model>({ foo: "bar", n: 0 }).build();
    s.foo("baz");
    expect(s.foo()).toBe("baz");
    // @ts-expect-error — foo must be string
    s.foo(1);
  });

  it("two independent stores do not share state", () => {
    const a = store({ count: 0 })
      .action("inc", (_, ctx) => ({ count: ctx.get().count + 1 }))
      .build();
    const b = store({ count: 0 })
      .action("inc", (_, ctx) => ({ count: ctx.get().count + 1 }))
      .build();
    a.inc();
    expect(a.count()).toBe(1);
    expect(b.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// State accessors
// ---------------------------------------------------------------------------

describe("state accessors", () => {
  it("read with no args, write with a value", () => {
    const s = store({ count: 0, label: "x" }).build();
    expect(s.count()).toBe(0);
    s.count(5);
    expect(s.count()).toBe(5);
    s.label("y");
    expect(s.label()).toBe("y");
  });

  it("returns the same accessor reference on each access (cached)", () => {
    const s = store({ count: 0 }).build();
    expect(s.count).toBe(s.count);
  });

  it("state key accessor has .select for nested bind paths", () => {
    const s = store({ user: { name: "a" } }).build();
    expect(typeof s.user.select).toBe("function");
    const name = s.user.select((u) => u.name);
    expect(name()).toBe("a");
    name("b");
    expect(s.user().name).toBe("b");
  });

  it("carries the SIGNAL_ACCESSOR symbol", () => {
    const s = store({ count: 0 }).build();
    const sym = Symbol.for("ilha.signalAccessor");
    expect((s.count as unknown as Record<symbol, unknown>)[sym]).toBe(true);
  });

  it("writes go through the commit pipeline (reactive)", () => {
    const s = store({ count: 0 }).build();
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(s.count());
    });
    s.count(1);
    s.count(2);
    stop();
    expect(seen).toEqual([0, 1, 2]);
  });

  it("setting the same value does not re-commit", () => {
    const s = store({ count: 0 }).build();
    const listener = mock();
    s.subscribe(listener);
    s.count(0);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setState (atomic multi-key)
// ---------------------------------------------------------------------------

describe("setState() built-in", () => {
  it("merges multiple keys in a single commit", () => {
    const s = store({ a: 1, b: 2, c: 3 }).build();
    const listener = mock();
    s.subscribe(listener);
    s.setState({ a: 10, b: 20 });
    expect(s.getState()).toEqual({ a: 10, b: 20, c: 3 });
    expect(listener).toHaveBeenCalledTimes(1); // one commit, not two
  });

  it("preserves keys not in the patch", () => {
    const s = store({ a: 1, b: 2 }).build();
    s.setState({ a: 9 });
    expect(s.getState()).toEqual({ a: 9, b: 2 });
  });

  it("a no-op patch does not fire change", () => {
    const s = store({ a: 1, b: 2 }).build();
    const listener = mock();
    s.subscribe(listener);
    s.setState({ a: 1, b: 2 });
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// derived
// ---------------------------------------------------------------------------

describe(".derived()", () => {
  it("computes from raw state and is read-only reactive", () => {
    const s = store({ count: 2 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .build();
    expect(s.doubled()).toBe(4);
    s.count(5);
    expect(s.doubled()).toBe(10);
  });

  it("re-runs an enclosing effect when its inputs change", () => {
    const s = store({ count: 0 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .build();
    const seen: Array<number | undefined> = [];
    const stop = effect(() => {
      seen.push(s.doubled());
    });
    s.count(3);
    stop();
    expect(seen).toEqual([0, 6]);
  });

  it("derived accessor is cached (same reference)", () => {
    const s = store({ count: 0 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .build();
    expect(s.doubled).toBe(s.doubled);
  });

  it("sync derived exposes a non-loading, error-free envelope", () => {
    const s = store({ count: 2 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .build();
    expect(s.doubled()).toBe(4);
    expect(s.doubled.loading).toBe(false);
    expect(s.doubled.error).toBeUndefined();
    expect(s.doubled.value).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// async derived (envelope)
// ---------------------------------------------------------------------------

describe(".derived() — async (envelope)", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("starts loading, then resolves into value", async () => {
    const s = store({ id: 1 })
      .derived("user", async (ctx) => {
        const id = ctx.get().id;
        await tick();
        return `user-${id}`;
      })
      .build();

    expect(s.user.loading).toBe(true);
    expect(s.user()).toBeUndefined();
    expect(s.user.error).toBeUndefined();

    await tick();
    await tick();

    expect(s.user.loading).toBe(false);
    expect(s.user()).toBe("user-1");
    expect(s.user.value).toBe("user-1");
  });

  it("re-runs when a state dependency changes", async () => {
    const s = store({ id: 1 })
      .derived("user", async (ctx) => {
        const id = ctx.get().id;
        await tick();
        return `user-${id}`;
      })
      .build();
    await tick();
    await tick();
    expect(s.user()).toBe("user-1");

    s.id(2);
    expect(s.user.loading).toBe(true);
    // keeps the previous value visible while reloading
    expect(s.user.value).toBe("user-1");
    await tick();
    await tick();
    expect(s.user()).toBe("user-2");
    expect(s.user.loading).toBe(false);
  });

  it("surfaces rejections via .error", async () => {
    const s = store({ n: 0 })
      .derived("thing", async () => {
        await tick();
        throw new Error("boom");
      })
      .build();
    await tick();
    await tick();
    expect(s.thing.loading).toBe(false);
    expect(s.thing.error).toBeInstanceOf(Error);
    expect(s.thing.error?.message).toBe("boom");
    expect(s.thing()).toBeUndefined();
  });

  it("aborts the previous run on re-run (stale resolution dropped)", async () => {
    const seen: number[] = [];
    const s = store({ id: 1 })
      .derived("user", async (ctx) => {
        const id = ctx.get().id;
        // first call (id=1) resolves slower than the second (id=2)
        await new Promise((r) => setTimeout(r, id === 1 ? 30 : 5));
        if (!ctx.signal.aborted) seen.push(id);
        return `user-${id}`;
      })
      .build();

    s.id(2); // supersedes the in-flight id=1 run
    await new Promise((r) => setTimeout(r, 60));

    expect(s.user()).toBe("user-2");
    // the aborted id=1 run did not push (its signal was aborted)
    expect(seen).toEqual([2]);
  });

  it("is reactive inside an effect", async () => {
    const s = store({ id: 1 })
      .derived("user", async (ctx) => {
        const id = ctx.get().id;
        await tick();
        return `user-${id}`;
      })
      .build();
    const seen: Array<string | undefined> = [];
    const stop = effect(() => {
      seen.push(s.user());
    });
    await tick();
    await tick();
    stop();
    expect(seen).toContain("user-1");
  });

  it("a sync derived that returns a Promise is treated as async", async () => {
    const s = store({ id: 1 })
      .derived("user", (ctx) => Promise.resolve(`user-${ctx.get().id}`))
      .build();
    expect(s.user.loading).toBe(true);
    await tick();
    await tick();
    expect(s.user()).toBe("user-1");
  });
});

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

describe(".action()", () => {
  it("zero-arg action computes from get()", () => {
    const s = store({ count: 0 })
      .action("inc", (_, ctx) => ({ count: ctx.get().count + 1 }))
      .build();
    s.inc();
    s.inc();
    expect(s.count()).toBe(2);
  });

  it("parameterised action receives typed props", () => {
    const s = store({ label: "" })
      .action("setLabel", (label: string) => ({ label }))
      .build();
    s.setLabel("hello");
    expect(s.label()).toBe("hello");
  });

  it("typed via parameter annotation", () => {
    const s = store({ n: 0 })
      .action("add", (delta: number, ctx) => ({ n: ctx.get().n + delta }))
      .build();
    s.add(5);
    expect(s.n()).toBe(5);
  });

  it("action change fires listeners", () => {
    const s = store({ count: 0 })
      .action("inc", (_, ctx) => ({ count: ctx.get().count + 1 }))
      .build();
    const listener = mock();
    s.subscribe(listener);
    s.inc();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a no-op action does not fire change", () => {
    const s = store({ count: 0 })
      .action("noop", (_, ctx) => ({ count: ctx.get().count }))
      .build();
    const listener = mock();
    s.subscribe(listener);
    s.noop();
    expect(listener).not.toHaveBeenCalled();
  });

  it("void return skips setState (side effects via ctx.set only)", () => {
    const s = store({ count: 0 })
      .action("bump", (_, ctx) => {
        ctx.set({ count: ctx.get().count + 1 });
      })
      .build();
    s.bump();
    expect(s.count()).toBe(1);
  });

  it("async action can return a patch after await", async () => {
    const s = store({ step: "a" as "a" | "b" })
      .action("advance", async (_, ctx) => {
        await Promise.resolve();
        if (ctx.get().step === "a") return { step: "b" as const };
      })
      .build();
    s.advance();
    await new Promise<void>((r) => queueMicrotask(r));
    await new Promise<void>((r) => queueMicrotask(r));
    expect(s.step()).toBe("b");
  });

  it("submit() advances step after await (login-style discriminated union)", async () => {
    const STEP = { REQUEST_OTP: "requestOtp", VERIFY_OTP: "verifyOtp" } as const;
    const LoginSchema = z.discriminatedUnion("step", [
      z.object({
        step: z.literal(STEP.REQUEST_OTP),
        email: z.email().default(""),
        otp: z.string().optional(),
      }),
      z.object({
        step: z.literal(STEP.VERIFY_OTP),
        email: z.email(),
        otp: z.string().min(6).default(""),
      }),
    ]);

    let validateErrors = 0;
    const form = store(LoginSchema)
      .onError(({ source }) => {
        if (source === "validate") validateErrors++;
      })
      .action("submit", async (_, { get }) => {
        const { step } = get();
        if (step === STEP.REQUEST_OTP) {
          await Promise.resolve();
          return { step: STEP.VERIFY_OTP };
        }
      })
      .build();

    form.email("ada@example.com");
    expect(form.step()).toBe(STEP.REQUEST_OTP);
    form.submit();
    await new Promise<void>((r) => queueMicrotask(r));
    await new Promise<void>((r) => queueMicrotask(r));
    expect(validateErrors).toBe(0);
    expect(form.step()).toBe(STEP.VERIFY_OTP);
    expect(form.getState().email).toBe("ada@example.com");
  });

  it("submit() advances step when verify branch allows empty otp until user fills (login UI pattern)", async () => {
    const STEP = { REQUEST_OTP: "REQUEST_OTP", VERIFY_OTP: "VERIFY_OTP" } as const;
    const LoginSchema = z
      .discriminatedUnion("step", [
        z.object({
          step: z.literal(STEP.REQUEST_OTP),
          email: z.email(),
          otp: z.string().default(""),
        }),
        z.object({
          step: z.literal(STEP.VERIFY_OTP),
          email: z.email(),
          otp: z.union([z.literal(""), z.string().min(6).max(6)]),
        }),
      ])
      .default({ step: STEP.REQUEST_OTP, email: "", otp: "" });

    let validateErrors = 0;
    const form = store(LoginSchema)
      .onError(({ source }) => {
        if (source === "validate") validateErrors++;
      })
      .action("submit", async (_, { get }) => {
        if (get().step === STEP.REQUEST_OTP) {
          await Promise.resolve();
          return { step: STEP.VERIFY_OTP };
        }
      })
      .build();

    form.email("ada@example.com");
    form.submit();
    await new Promise<void>((r) => queueMicrotask(r));
    await new Promise<void>((r) => queueMicrotask(r));
    expect(validateErrors).toBe(0);
    expect(form.step()).toBe(STEP.VERIFY_OTP);
    expect(form.otp()).toBe("");
  });

  it("submit() does not advance step when async action returns void after error path", async () => {
    const STEP = { REQUEST_OTP: "requestOtp", VERIFY_OTP: "verifyOtp" } as const;
    const LoginSchema = z.discriminatedUnion("step", [
      z.object({
        step: z.literal(STEP.REQUEST_OTP),
        email: z.email().default(""),
        otp: z.string().optional(),
      }),
      z.object({
        step: z.literal(STEP.VERIFY_OTP),
        email: z.email(),
        otp: z.string().min(6).default(""),
      }),
    ]);

    const form = store(LoginSchema)
      .action("submit", async (_, { get }) => {
        const { step } = get();
        if (step === STEP.REQUEST_OTP) {
          await Promise.resolve();
          return void 0;
        }
      })
      .build();

    form.email("ada@example.com");
    form.submit();
    await new Promise<void>((r) => queueMicrotask(r));
    await new Promise<void>((r) => queueMicrotask(r));
    expect(form.step()).toBe(STEP.REQUEST_OTP);
  });

  it("rejected async action is handled (no unhandled rejection)", async () => {
    const errors: Error[] = [];
    const s = store({ count: 0 })
      .onError(({ error, source }) => {
        errors.push(error);
        expect(source).toBe("action");
      })
      .action("boom", async () => {
        await Promise.resolve();
        throw new Error("action failed");
      })
      .build();
    s.boom();
    await new Promise<void>((r) => queueMicrotask(r));
    await new Promise<void>((r) => queueMicrotask(r));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe("action failed");
    expect(s.count()).toBe(0);
  });

  it("async action can return void (e.g. return void sideEffect())", async () => {
    let toast = 0;
    const s = store({ count: 0 })
      .action("fail", async () => {
        await Promise.resolve();
        return void toast++;
      })
      .build();
    const listener = mock();
    s.subscribe(listener);
    s.fail();
    await Promise.resolve();
    expect(toast).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("implicit void return does not fire change", () => {
    const s = store({ count: 0 })
      .action("sideEffect", () => {})
      .build();
    const listener = mock();
    s.subscribe(listener);
    s.sideEffect();
    expect(listener).not.toHaveBeenCalled();
  });

  it("action returning null does not throw or mutate", () => {
    const s = store({ count: 0 })
      .action("bad", () => null as unknown as Partial<{ count: number }>)
      .build();
    expect(() => s.bad()).not.toThrow();
    expect(s.count()).toBe(0);
  });

  it("ctx.getInitial() reads the initial snapshot", () => {
    const s = store({ count: 5 })
      .action("resetCount", (_, ctx) => ({ count: ctx.getInitial().count }))
      .build();
    s.count(99);
    s.resetCount();
    expect(s.count()).toBe(5);
  });

  it("ctx.set() is an imperative write escape hatch (async/multi-step)", async () => {
    const s = store({ count: 0, loading: false })
      .action("load", (_, ctx) => {
        ctx.set({ loading: true });
        // simulate async resolve
        queueMicrotask(() => ctx.set({ count: 42, loading: false }));
      })
      .build();
    s.load();
    expect(s.loading()).toBe(true);
    await Promise.resolve();
    expect(s.count()).toBe(42);
    expect(s.loading()).toBe(false);
  });

  it("ctx.set() routes through middleware", () => {
    const seen: Array<Partial<{ count: number }>> = [];
    const s = store({ count: 0 })
      .middleware((patch, _ctx, next) => {
        seen.push(patch);
        next(patch);
      })
      .action("viaSet", (_, ctx) => {
        ctx.set({ count: 7 });
      })
      .build();
    s.viaSet();
    expect(seen).toEqual([{ count: 7 }]);
    expect(s.count()).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// middleware
// ---------------------------------------------------------------------------

describe(".middleware()", () => {
  it("intercepts every mutation and can block it", () => {
    const s = store({ count: 0 })
      .middleware((patch, _ctx, next) => {
        if (patch.count !== undefined && patch.count < 0) return; // block negatives
        next(patch);
      })
      .build();
    s.count(5);
    expect(s.count()).toBe(5);
    s.count(-1); // blocked
    expect(s.count()).toBe(5);
  });

  it("runs for accessor writes, setState, and actions alike", () => {
    const seen: Array<Partial<{ count: number }>> = [];
    const s = store({ count: 0 })
      .middleware((patch, _ctx, next) => {
        seen.push(patch);
        next(patch);
      })
      .action("inc", (_, ctx) => ({ count: ctx.get().count + 1 }))
      .build();
    s.count(1); // accessor
    s.setState({ count: 2 }); // setState
    s.inc(); // action
    expect(seen).toEqual([{ count: 1 }, { count: 2 }, { count: 3 }]);
  });

  it("ctx exposes pre-commit get() and getInitial()", () => {
    const seen: Array<{ before: number; initial: number }> = [];
    const s = store({ count: 10 })
      .middleware((patch, ctx, next) => {
        seen.push({ before: ctx.get().count, initial: ctx.getInitial().count });
        next(patch);
      })
      .build();
    s.count(20);
    s.count(30);
    // ctx.get() is the pre-commit state each time; getInitial() is constant.
    expect(seen).toEqual([
      { before: 10, initial: 10 },
      { before: 20, initial: 10 },
    ]);
  });

  it("composes in registration order", () => {
    const order: string[] = [];
    const s = store({ count: 0 })
      .middleware((patch, _s, next) => {
        order.push("m0-before");
        next(patch);
        order.push("m0-after");
      })
      .middleware((patch, _s, next) => {
        order.push("m1-before");
        next(patch);
        order.push("m1-after");
      })
      .build();
    s.count(1);
    expect(order).toEqual(["m0-before", "m1-before", "m1-after", "m0-after"]);
  });

  it("a middleware can transform the patch", () => {
    const s = store({ count: 0 })
      .middleware((patch, _s, next) => next({ ...patch, count: (patch.count ?? 0) * 10 }))
      .build();
    s.count(5);
    expect(s.count()).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// lifecycle .on()
// ---------------------------------------------------------------------------

describe(".on()", () => {
  it("init fires synchronously during build()", () => {
    const seen: Array<{ count: number }> = [];
    store({ count: 7 })
      .on("init", (state) => seen.push(state))
      .build();
    expect(seen).toEqual([{ count: 7 }]);
  });

  it("change fires after every committed mutation with (next, prev)", () => {
    const calls: Array<[number, number]> = [];
    const s = store({ count: 0 })
      .on("change", (next, prev) => calls.push([next.count, prev.count]))
      .build();
    s.count(1);
    s.count(2);
    expect(calls).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it("multiple handlers for the same event fire in registration order", () => {
    const order: string[] = [];
    const s = store({ count: 0 })
      .on("change", () => order.push("first"))
      .on("change", () => order.push("second"))
      .build();
    s.count(1);
    expect(order).toEqual(["first", "second"]);
  });

  it("change does not fire for a blocked or no-op mutation", () => {
    const listener = mock();
    const s = store({ count: 0 })
      .middleware((patch, _s, next) => {
        if (patch.count === 99) return;
        next(patch);
      })
      .on("change", listener)
      .build();
    s.count(99); // blocked by middleware
    s.count(0); // no-op
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// key collisions
// ---------------------------------------------------------------------------

describe("key collisions", () => {
  it("derived vs state", () => {
    expect(() =>
      store({ count: 0 })
        .derived("count", (ctx) => ctx.get().count)
        .build(),
    ).toThrow(/key collision — "count" is already defined as a state key/);
  });

  it("action vs state", () => {
    expect(() =>
      store({ count: 0 })
        .action("count", () => ({}))
        .build(),
    ).toThrow(/"count" is already defined as a state key/);
  });

  it("action vs derived", () => {
    expect(() =>
      store({ count: 0 })
        .derived("doubled", (ctx) => ctx.get().count * 2)
        .action("doubled", () => ({}))
        .build(),
    ).toThrow(/"doubled" is already defined as a derived key/);
  });

  it("key vs built-in", () => {
    expect(() => store({ subscribe: 1 }).build()).toThrow(
      /"subscribe" is already defined as a built-in key/,
    );
    expect(() =>
      store({ count: 0 })
        .action("getState", () => ({}))
        .build(),
    ).toThrow(/"getState" is already defined as a built-in key/);
  });

  it("duplicate action keys", () => {
    expect(() =>
      store({ count: 0 })
        .action("inc", () => ({}))
        .action("inc", () => ({}))
        .build(),
    ).toThrow(/"inc" is already defined as an? action key/);
  });
});

// ---------------------------------------------------------------------------
// Proxy semantics
// ---------------------------------------------------------------------------

describe("Proxy semantics", () => {
  it("direct assignment is disabled (throws in strict module mode)", () => {
    const s = store({ count: 0 }).build();
    expect(() => {
      (s as unknown as { count: number }).count = 5;
    }).toThrow();
    expect(s.count()).toBe(0);
  });

  it("symbol access returns undefined without throwing", () => {
    const s = store({ count: 0 }).build();
    expect((s as unknown as Record<symbol, unknown>)[Symbol("x")]).toBeUndefined();
  });

  it("`in` reflects the real key set (has trap)", () => {
    const s = store({ count: 0 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .action("inc", () => ({}))
      .build();
    expect("count" in s).toBe(true);
    expect("doubled" in s).toBe(true);
    expect("inc" in s).toBe(true);
    expect("subscribe" in s).toBe(true);
    expect("nope" in s).toBe(false);
  });

  it("Object.keys enumerates state + derived + action + builtin keys (ownKeys trap)", () => {
    const s = store({ count: 0 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .action("inc", () => ({}))
      .build();
    const keys = Object.keys(s);
    expect(keys).toContain("count");
    expect(keys).toContain("doubled");
    expect(keys).toContain("inc");
    expect(keys).toContain("getState");
  });

  it("priority: built-in > action > derived > state would-be collisions are rejected at build", () => {
    // Collisions throw, so the only way a key resolves is unambiguously.
    const s = store({ count: 0 }).build();
    expect(typeof s.getState).toBe("function");
    expect(s.getState()).toEqual({ count: 0 });
  });
});

// ---------------------------------------------------------------------------
// getState / getInitialState
// ---------------------------------------------------------------------------

describe("getState() / getInitialState()", () => {
  it("getState returns raw state (no derived, no actions)", () => {
    const s = store({ count: 1 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .action("inc", (_, ctx) => ({ count: ctx.get().count + 1 }))
      .build();
    expect(s.getState()).toEqual({ count: 1 });
  });

  it("getState returns a stable reference when state is unchanged", () => {
    const s = store({ count: 0 }).build();
    expect(s.getState()).toBe(s.getState());
  });

  it("getInitialState is captured once and unaffected by mutations", () => {
    const s = store({ count: 0 }).build();
    s.count(99);
    expect(s.getInitialState()).toEqual({ count: 0 });
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe("reset()", () => {
  it("restores initial state", () => {
    const s = store({ count: 5, label: "x" }).build();
    s.count(99);
    s.label("y");
    s.reset();
    expect(s.getState()).toEqual({ count: 5, label: "x" });
  });

  it("routes through middleware", () => {
    const seen: Array<Partial<{ count: number }>> = [];
    const s = store({ count: 0 })
      .middleware((patch, _ctx, next) => {
        seen.push(patch);
        next(patch);
      })
      .build();
    s.count(3);
    seen.length = 0;
    s.reset();
    expect(seen).toEqual([{ count: 0 }]);
  });

  it("fires change listener", () => {
    const listener = mock();
    const s = store({ count: 1 }).build();
    s.count(2);
    s.subscribe(listener);
    s.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when state already equals initial", () => {
    const listener = mock();
    const s = store({ count: 0 }).build();
    s.subscribe(listener);
    s.reset();
    expect(listener).not.toHaveBeenCalled();
  });

  it("schema-backed store reset() restores parsed initial state", () => {
    const Schema = z.object({ email: z.email().default("ada@example.com") });
    const s = store(Schema).build();
    s.email("other@example.com");
    s.reset();
    expect(s.email()).toBe("ada@example.com");
  });
});

// ---------------------------------------------------------------------------
// subscribe
// ---------------------------------------------------------------------------

describe("subscribe() — full-state form", () => {
  it("does NOT fire on initial subscription", () => {
    const s = store({ count: 0 }).build();
    const listener = mock();
    s.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("fires with (next, prev) on change", () => {
    const s = store({ count: 0 }).build();
    const received: Array<[{ count: number }, { count: number }]> = [];
    s.subscribe((next, prev) => {
      received.push([next, prev]);
    });
    s.count(1);
    expect(received).toEqual([[{ count: 1 }, { count: 0 }]]);
  });

  it("stops firing after unsubscribe (idempotent)", () => {
    const s = store({ count: 0 }).build();
    const listener = mock();
    const unsub = s.subscribe(listener);
    s.count(1);
    unsub();
    unsub();
    s.count(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("subscribe() — selector form", () => {
  it("fires only when the selected slice changes, with (slice, prev)", () => {
    const s = store({ a: 0, b: 0 }).build();
    const calls: Array<[number, number]> = [];
    s.subscribe(
      (st) => st.a,
      (slice, prev) => calls.push([slice, prev]),
    );
    s.b(1); // unrelated — no fire
    s.a(5);
    s.a(5); // same value — no fire
    expect(calls).toEqual([[5, 0]]);
  });

  it("does NOT fire on initial subscription", () => {
    const s = store({ a: 1 }).build();
    const listener = mock();
    s.subscribe((st) => st.a, listener);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// select
// ---------------------------------------------------------------------------

describe("select()", () => {
  it("returns a reactive read accessor", () => {
    const s = store({ count: 0 }).build();
    const count = s.select((st) => st.count);
    expect(count()).toBe(0);
    s.count(3);
    expect(count()).toBe(3);
  });

  it("re-runs an enclosing effect only on slice change", () => {
    const s = store({ a: 0, b: 0 }).build();
    const a = s.select((st) => st.a);
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(a());
    });
    s.b(1); // unrelated
    s.a(2);
    stop();
    expect(seen).toEqual([0, 2]);
  });

  it("each call returns a fresh accessor", () => {
    const s = store({ count: 0 }).build();
    expect(s.select((st) => st.count)).not.toBe(s.select((st) => st.count));
  });
});

// ---------------------------------------------------------------------------
// bind
// ---------------------------------------------------------------------------

describe("bind()", () => {
  it("reads with no args, writes via accessor call (through middleware)", () => {
    const s = store({ label: "x" }).build();
    const labelBind = s.bind((st) => st.label);
    expect(labelBind()).toBe("x");
    labelBind("y");
    expect(s.label()).toBe("y");
  });

  it("write path is intercepted by middleware", () => {
    const seen: unknown[] = [];
    const s = store({ name: "a" })
      .middleware((patch, _ctx, next) => {
        seen.push(patch);
        next(patch);
      })
      .build();
    const nameBind = s.bind((st) => st.name);
    nameBind("b");
    expect(seen).toEqual([{ name: "b" }]);
    expect(s.name()).toBe("b");
  });

  it("updates nested path immutably", () => {
    const s = store({ user: { name: "a", age: 1 } }).build();
    const nameBind = s.bind((st) => st.user.name);
    const before = s.getState().user;
    nameBind("b");
    expect(s.getState().user.name).toBe("b");
    expect(s.getState().user.age).toBe(1);
    expect(s.getState().user).not.toBe(before); // immutable update
  });

  it("carries SIGNAL_ACCESSOR and is reactive", () => {
    const s = store({ label: "x" }).build();
    const labelBind = s.bind((st) => st.label);
    const sym = Symbol.for("ilha.signalAccessor");
    expect((labelBind as unknown as Record<symbol, unknown>)[sym]).toBe(true);
    const seen: string[] = [];
    const stop = effect(() => {
      seen.push(labelBind());
    });
    s.label("y");
    stop();
    expect(seen).toEqual(["x", "y"]);
  });

  it("throws for unsupported (non-path) selectors", () => {
    const s = store({ count: 3 }).build();
    expect(() => s.bind((st) => st.count * 2)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// effectScope
// ---------------------------------------------------------------------------

describe("effectScope", () => {
  it("is re-exported from @ilha/store", () => {
    expect(typeof effectScope).toBe("function");
  });

  it("stops subscribe effects registered inside the scope", () => {
    const s = store({ count: 0 }).build();
    const listener = mock();
    const stop = effectScope(() => {
      s.subscribe(listener);
    });
    s.count(1);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    s.count(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ilha integration
// ---------------------------------------------------------------------------

describe("ilha integration", () => {
  it("state accessor used directly in a render (no select needed)", () => {
    const s = store({ count: 0 }).build();
    const Island = ilha.render(() => html`<span>Count: ${s.count()}</span>`);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const unmount = Island.mount(el);
    expect(el.textContent).toContain("Count: 0");
    s.count(2);
    expect(el.textContent).toContain("Count: 2");
    unmount();
    el.remove();
  });

  it("derived accessor used directly in a render", () => {
    const s = store({ count: 1 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .build();
    const Island = ilha.render(() => html`<p>${s.count()} × 2 = ${s.doubled()}</p>`);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const unmount = Island.mount(el);
    expect(el.textContent).toContain("1 × 2 = 2");
    s.count(5);
    expect(el.textContent).toContain("5 × 2 = 10");
    unmount();
    el.remove();
  });

  it("store shared across two islands stays in sync", () => {
    const s = store({ value: "hello" }).build();
    const A = ilha.render(() => html`<p>${s.value()}</p>`);
    const B = ilha.render(() => html`<em>${s.value()}</em>`);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const slotA = document.createElement("div");
    const slotB = document.createElement("div");
    root.append(slotA, slotB);
    const unmountA = A.mount(slotA);
    const unmountB = B.mount(slotB);
    s.value("ilha");
    expect(slotA.querySelector("p")?.textContent).toBe("ilha");
    expect(slotB.querySelector("em")?.textContent).toBe("ilha");
    unmountA();
    unmountB();
    root.remove();
  });

  it("bind:value updates store from input event", () => {
    const s = store({ query: "" }).build();
    const Island = ilha.render(() => html`<input bind:value=${s.bind((st) => st.query)} />`);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const unmount = Island.mount(el);
    const input = el.querySelector("input")!;
    input.value = "typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(s.query()).toBe("typed");
    unmount();
    el.remove();
  });

  it("bind:value on input updates form.name() in sibling <p> (html)", () => {
    const form = store({ name: "", email: "" }).build();
    const name = form.bind((f) => f.name);
    const Island = ilha.render(
      () => html`
        <div class="flex flex-col gap-2">
          <input bind:value=${name} />
          <p>${form.name()}</p>
        </div>
      `,
    );
    const el = document.createElement("div");
    document.body.appendChild(el);
    const unmount = Island.mount(el);
    const input = el.querySelector("input")!;
    const p = el.querySelector("p")!;
    expect(p.textContent).toBe("");
    input.value = "Ada";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(form.name()).toBe("Ada");
    expect(p.textContent).toBe("Ada");
    unmount();
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// Type-level tests (compile-time assertions — must typecheck)
// ---------------------------------------------------------------------------

describe("type inference", () => {
  it("action forms resolve to correct call signatures", () => {
    const s = store({ count: 0, label: "" })
      .action("inc", (_, ctx) => ({ count: ctx.get().count + 1 })) // zero-arg
      .action("setLabel", (label: string) => ({ label })) // annotated param
      .action("add", (delta: number, ctx) => ({ count: ctx.get().count + delta })) // annotated param
      .build();

    // @ts-expect-error — zero-arg action takes no props
    s.inc(123);
    s.inc();

    // @ts-expect-error — setLabel requires a string
    s.setLabel(123);
    s.setLabel("ok");

    // @ts-expect-error — add requires a number
    s.add("nope");
    s.add(5);

    // The calls above are compile-time assertions; assert the runtime shape
    // rather than mutated state (the @ts-expect-error lines still execute).
    expect(typeof s.inc).toBe("function");
    expect(typeof s.setLabel).toBe("function");
    expect(typeof s.add).toBe("function");
  });

  it("state and derived accessors are typed", () => {
    const s = store({ count: 0 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .build();
    const n: number = s.count();
    const d: number | undefined = s.doubled();
    const loading: boolean = s.doubled.loading;
    const err: Error | undefined = s.doubled.error;

    // @ts-expect-error — state write must match the value type
    s.count("nope");
    // @ts-expect-error — derived is read-only (no write overload)
    s.doubled(5);

    expect(typeof n).toBe("number");
    void d;
    void loading;
    void err;
  });

  it("getState excludes actions and derived from the type", () => {
    const s = store({ count: 0 })
      .derived("doubled", (ctx) => ctx.get().count * 2)
      .action("inc", (_, ctx) => ({ count: ctx.get().count + 1 }))
      .build();
    const st = s.getState();
    const n: number = st.count;
    // @ts-expect-error — derived is not part of the state snapshot
    void st.doubled;
    // @ts-expect-error — actions are not part of the state snapshot
    void st.inc;
    expect(n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Standard Schema store + .onError()
// ---------------------------------------------------------------------------

describe("store(Standard Schema)", () => {
  it("derives initial state from schema defaults", () => {
    const Schema = z.object({
      label: z.string().default("hello"),
      n: z.number().default(2),
    });
    const s = store(Schema).build();
    expect(s.getState()).toEqual({ label: "hello", n: 2 });
  });

  it("rejects invalid setState and does not mutate", () => {
    const Schema = z.object({ email: z.email().default("ada@example.com") });
    const s = store(Schema)
      .onError(() => {})
      .build();
    s.setState({ email: "not-an-email" });
    expect(s.getState().email).toBe("ada@example.com");
  });

  it(".onError receives StoreValidationError with issues", () => {
    const Schema = z.object({ age: z.number().min(0).default(0) });
    const seen: Array<{ message: string; issuesLen: number }> = [];
    const s = store(Schema)
      .onError(({ error, source, issues, patch }) => {
        expect(source).toBe("validate");
        expect(error).toBeInstanceOf(StoreValidationError);
        expect(patch).toEqual({ age: -1 });
        seen.push({
          message: error.message,
          issuesLen: issues?.length ?? 0,
        });
      })
      .build();
    s.setState({ age: -1 });
    expect(seen.length).toBe(1);
    expect(seen[0]!.issuesLen).toBeGreaterThan(0);
  });

  it("applies coercion on successful commit", () => {
    const Schema = z.object({ n: z.coerce.number().default(0) });
    const s = store(Schema).build();
    s.setState({ n: "42" as unknown as number });
    expect(s.n()).toBe(42);
  });

  it("bind write rejects invalid value and leaves state unchanged", () => {
    const Schema = z.object({ email: z.email().default("ada@example.com") });
    let errors = 0;
    const s = store(Schema)
      .onError(() => {
        errors++;
      })
      .build();
    const email = s.bind((st) => st.email);
    email("bad");
    expect(errors).toBe(1);
    expect(email()).toBe("ada@example.com");
  });

  it("bind write accepts valid email", () => {
    const Schema = z.object({ email: z.email().default("ada@example.com") });
    const s = store(Schema).build();
    const email = s.bind((st) => st.email);
    email("ada@example.com");
    expect(email()).toBe("ada@example.com");
  });

  it("ilha bind:value rejects invalid email without updating state", () => {
    const Schema = z.object({ email: z.email().default("ok@example.com") });
    let n = 0;
    const formStore = store(Schema)
      .onError(() => {
        n++;
      })
      .build();
    const Island = ilha.render(() => html`<input bind:value=${formStore.bind((s) => s.email)} />`);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const unmount = Island.mount(el);
    const input = el.querySelector("input")!;
    input.value = "not-email";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(n).toBe(1);
    expect(formStore.email()).toBe("ok@example.com");
    unmount();
    el.remove();
  });

  it("falls back to console.error when no .onError()", () => {
    const errSpy = mock(() => {});
    const orig = console.error;
    console.error = errSpy as typeof console.error;
    try {
      const Schema = z.object({ x: z.number().default(0) });
      const s = store(Schema).build();
      s.setState({ x: "nope" as unknown as number });
      expect(errSpy).toHaveBeenCalled();
    } finally {
      console.error = orig;
    }
  });
});
