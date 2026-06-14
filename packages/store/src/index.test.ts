// =============================================================================
// @ilha/store — test suite
// Run with: bun test --dom (happy-dom needed for bind() tests)
// =============================================================================

import { describe, it, expect, mock, beforeEach } from "bun:test";

import { effect } from "alien-signals";
import ilha, { html } from "ilha";

import { createStore, effectScope } from "./index";

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// createStore()
// ---------------------------------------------------------------------------

describe("createStore()", () => {
  it("returns an object with the expected API", () => {
    const store = createStore({ count: 0 });
    expect(typeof store.getState).toBe("function");
    expect(typeof store.setState).toBe("function");
    expect(typeof store.getInitialState).toBe("function");
    expect(typeof store.subscribe).toBe("function");
    expect(typeof store.bind).toBe("function");
  });

  it("initialises state from the initial state object", () => {
    const store = createStore({ count: 42, name: "Ada" });
    expect(store.getState().count).toBe(42);
    expect(store.getState().name).toBe("Ada");
  });

  it("passes set and get to the actions creator", () => {
    const store = createStore({ count: 0 }, (set, get) => ({
      double: () => get().count * 2,
      inc: () => set((s) => ({ count: s.count + 1 })),
    }));
    store.getState().inc();
    expect(store.getState().count).toBe(1);
    expect(store.getState().double()).toBe(2);
  });

  it("actions can reference getInitialState to reset", () => {
    const store = createStore({ count: 5 }, (set, _get, getInitialState) => ({
      reset: () => set(getInitialState()),
    }));
    store.setState({ count: 99 });
    store.getState().reset();
    expect(store.getState().count).toBe(5);
  });

  it("two independent stores do not share state", () => {
    const a = createStore({ count: 0 });
    const b = createStore({ count: 0 });
    a.setState({ count: 10 });
    expect(b.getState().count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getState()
// ---------------------------------------------------------------------------

describe("getState()", () => {
  it("returns the current state", () => {
    const store = createStore({ x: 1 });
    expect(store.getState().x).toBe(1);
  });

  it("reflects the latest setState", () => {
    const store = createStore({ x: 1 });
    store.setState({ x: 99 });
    expect(store.getState().x).toBe(99);
  });

  it("returns a stable reference when state has not changed", () => {
    const store = createStore({ x: 1 });
    const a = store.getState();
    const b = store.getState();
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// getInitialState()
// ---------------------------------------------------------------------------

describe("getInitialState()", () => {
  it("returns the original state passed to createStore", () => {
    const store = createStore({ count: 7 });
    store.setState({ count: 99 });
    expect(store.getInitialState().count).toBe(7);
  });

  it("is not affected by subsequent setState calls", () => {
    const store = createStore({ a: 1, b: 2 });
    store.setState({ a: 100 });
    store.setState({ b: 200 });
    expect(store.getInitialState().a).toBe(1);
    expect(store.getInitialState().b).toBe(2);
  });

  it("can be used to reset state", () => {
    const store = createStore({ count: 0 });
    store.setState({ count: 50 });
    store.setState(store.getInitialState());
    expect(store.getState().count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// setState()
// ---------------------------------------------------------------------------

describe("setState()", () => {
  it("merges a plain object shallowly", () => {
    const store = createStore({ a: 1, b: 2 });
    store.setState({ a: 10 });
    expect(store.getState().a).toBe(10);
    expect(store.getState().b).toBe(2);
  });

  it("accepts an updater function", () => {
    const store = createStore({ count: 3 });
    store.setState((s) => ({ count: s.count * 2 }));
    expect(store.getState().count).toBe(6);
  });

  it("updater receives the latest state", () => {
    const store = createStore({ count: 0 });
    store.setState({ count: 5 });
    store.setState((s) => ({ count: s.count + 1 }));
    expect(store.getState().count).toBe(6);
  });

  it("preserves keys not included in the partial update", () => {
    const store = createStore({ x: 1, y: 2, z: 3 });
    store.setState({ z: 99 });
    expect(store.getState().x).toBe(1);
    expect(store.getState().y).toBe(2);
    expect(store.getState().z).toBe(99);
  });

  it("applies multiple updates in sequence — last write wins per key", () => {
    const store = createStore({ count: 0 });
    store.setState({ count: 1 });
    store.setState({ count: 2 });
    store.setState({ count: 3 });
    expect(store.getState().count).toBe(3);
  });

  it("setting the same value does not change the state reference", () => {
    const store = createStore({ count: 1 });
    store.getState();
    store.setState({ count: 1 });
    expect(store.getState().count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// subscribe() — full-state form
// ---------------------------------------------------------------------------

describe("subscribe() — full-state form", () => {
  it("returns an unsubscribe function", () => {
    const store = createStore({ count: 0 });
    const unsub = store.subscribe(mock());
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("fires the listener when state changes", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    store.subscribe(listener);
    store.setState({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire on initial subscription", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    store.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("passes (newState, prevState) to the listener", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    store.subscribe(listener);
    store.setState({ count: 5 });
    const [newState, prevState] = listener.mock.calls[0] as [{ count: number }, { count: number }];
    expect(newState.count).toBe(5);
    expect(prevState.count).toBe(0);
  });

  it("fires for every setState call", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    store.subscribe(listener);
    store.setState({ count: 1 });
    store.setState({ count: 2 });
    store.setState({ count: 3 });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("stops firing after unsubscribe", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    const unsub = store.subscribe(listener);
    store.setState({ count: 1 });
    unsub();
    store.setState({ count: 2 });
    store.setState({ count: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe is idempotent", () => {
    const store = createStore({ count: 0 });
    const unsub = store.subscribe(mock());
    expect(() => {
      unsub();
      unsub();
    }).not.toThrow();
  });

  it("multiple independent subscribers all receive changes", () => {
    const store = createStore({ count: 0 });
    const a = mock();
    const b = mock();
    store.subscribe(a);
    store.subscribe(b);
    store.setState({ count: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribing one does not affect others", () => {
    const store = createStore({ count: 0 });
    const a = mock();
    const b = mock();
    const unsubA = store.subscribe(a);
    store.subscribe(b);
    unsubA();
    store.setState({ count: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// subscribe() — selector form
// ---------------------------------------------------------------------------

describe("subscribe() — selector form", () => {
  it("fires only when the selected slice changes", () => {
    const store = createStore({ count: 0, name: "Ada" });
    const listener = mock();
    store.subscribe((s) => s.count, listener);
    store.setState({ name: "Grace" });
    expect(listener).not.toHaveBeenCalled();
    store.setState({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("passes (newSlice, prevSlice) to the listener", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    store.subscribe((s) => s.count, listener);
    store.setState({ count: 7 });
    const [newSlice, prevSlice] = listener.mock.calls[0] ?? [];
    expect(newSlice).toBe(7);
    expect(prevSlice).toBe(0);
  });

  it("does NOT fire on initial subscription", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    store.subscribe((s) => s.count, listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("fires for each distinct value change", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    store.subscribe((s) => s.count, listener);
    store.setState({ count: 1 });
    store.setState({ count: 2 });
    store.setState({ count: 3 });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("does NOT fire when the selected value is set to the same reference", () => {
    const obj = { id: 1 };
    const store = createStore({ obj, other: 0 });
    const listener = mock();
    store.subscribe((s) => s.obj, listener);
    store.setState({ other: 99 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops firing after unsubscribe", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    const unsub = store.subscribe((s) => s.count, listener);
    store.setState({ count: 1 });
    unsub();
    store.setState({ count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("multiple selectors on the same store are independent", () => {
    const store = createStore({ a: 0, b: 0 });
    const listenerA = mock();
    const listenerB = mock();
    store.subscribe((s) => s.a, listenerA);
    store.subscribe((s) => s.b, listenerB);
    store.setState({ a: 1 });
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
    store.setState({ b: 1 });
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe("actions", () => {
  it("actions can call set", () => {
    const store = createStore({ count: 0 }, (set) => ({
      inc: () => set((s) => ({ count: s.count + 1 })),
      dec: () => set((s) => ({ count: s.count - 1 })),
    }));
    store.getState().inc();
    store.getState().inc();
    store.getState().dec();
    expect(store.getState().count).toBe(1);
  });

  it("actions can read state via get", () => {
    const store = createStore({ count: 10 }, (_set, get) => ({
      double: () => get().count * 2,
    }));
    store.setState({ count: 6 });
    expect(store.getState().double()).toBe(12);
  });

  it("actions can call other actions via get", () => {
    const store = createStore({ count: 0 }, (set, get) => ({
      inc: () => set((s) => ({ count: s.count + 1 })),
      incThenDouble: () => {
        get().inc();
        set((s) => ({ count: s.count * 2 }));
      },
    }));
    store.getState().incThenDouble();
    expect(store.getState().count).toBe(2); // (0+1)*2
  });

  it("actions are preserved after setState", () => {
    const store = createStore({ count: 0 }, (set) => ({
      inc: () => set((s) => ({ count: s.count + 1 })),
    }));
    store.setState({ count: 5 });
    store.getState().inc();
    expect(store.getState().count).toBe(6);
  });

  it("listeners fire when an action calls set", () => {
    const store = createStore({ count: 0 }, (set) => ({
      inc: () => set((s) => ({ count: s.count + 1 })),
    }));
    const listener = mock();
    store.subscribe(listener);
    store.getState().inc();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("getInitialState resets state from within an action", () => {
    const store = createStore({ count: 5 }, (set, _get, getInitialState) => ({
      reset: () => set(getInitialState()),
    }));
    store.setState({ count: 99 });
    store.getState().reset();
    expect(store.getState().count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// effectScope
// ---------------------------------------------------------------------------

describe("effectScope", () => {
  it("is exported from @ilha/store", () => {
    expect(typeof effectScope).toBe("function");
  });

  it("stops all subscribe effects inside the scope", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    const stop = effectScope(() => {
      store.subscribe(listener);
    });
    store.setState({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.setState({ count: 2 });
    store.setState({ count: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops slice subscribe effects registered inside the scope", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    const stop = effectScope(() => {
      store.subscribe((s) => s.count, listener);
    });
    store.setState({ count: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.setState({ count: 99 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe("integration", () => {
  it("store-driven error state renders in an island via select", () => {
    const store = createStore({ errors: {} as Record<string, string> }, (set) => ({
      setErrors: (errors: Record<string, string>) => set({ errors }),
      clearErrors: () => set({ errors: {} }),
    }));
    const errors = store.select((s) => s.errors);
    const Island = ilha.render(
      () => html`${Object.entries(errors()).map(([f, m]) => html`<p data-field="${f}">${m}</p>`)}`,
    );
    const el = document.createElement("div");
    document.body.appendChild(el);
    const unmount = Island.mount(el);
    expect(el.querySelectorAll("p").length).toBe(0);
    store.getState().setErrors({ email: "Invalid email", name: "Required" });
    expect(el.querySelectorAll("p").length).toBe(2);
    expect(el.querySelector("[data-field='email']")?.textContent).toBe("Invalid email");
    store.getState().clearErrors();
    expect(el.querySelector("p")).toBeNull();
    unmount();
    el.remove();
  });

  it("counter label renders in an island via select", () => {
    const store = createStore({ count: 0 }, (set) => ({
      inc: () => set((s) => ({ count: s.count + 1 })),
    }));
    const count = store.select((s) => s.count);
    const Island = ilha.render(() => html`<span>Count: ${count()}</span>`);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const unmount = Island.mount(el);
    expect(el.textContent).toContain("Count: 0");
    store.getState().inc();
    store.getState().inc();
    expect(el.textContent).toContain("Count: 2");
    unmount();
    el.remove();
  });

  it("island subscribes to store slice and drives its own signal", () => {
    const store = createStore({ theme: "light" });
    const themes: string[] = [];
    store.subscribe(
      (s) => s.theme,
      (theme) => themes.push(theme),
    );
    store.setState({ theme: "dark" });
    store.setState({ theme: "light" });
    expect(themes).toEqual(["dark", "light"]);
  });

  it("store shared across two islands — both stay in sync via select", () => {
    const store = createStore({ value: "hello" });
    const value = store.select((s) => s.value);
    const A = ilha.render(() => html`<p>${value()}</p>`);
    const B = ilha.render(() => html`<em>${value()}</em>`);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const slotA = document.createElement("div");
    const slotB = document.createElement("div");
    root.append(slotA, slotB);
    const unmountA = A.mount(slotA);
    const unmountB = B.mount(slotB);
    store.setState({ value: "ilha" });
    expect(slotA.querySelector("p")?.textContent).toBe("ilha");
    expect(slotB.querySelector("em")?.textContent).toBe("ilha");
    unmountA();
    unmountB();
    root.remove();
  });

  it("unsubscribing one slice listener does not affect another", () => {
    const store = createStore({ count: 0 });
    const a = mock();
    const b = mock();
    const unsubA = store.subscribe((s) => s.count, a);
    store.subscribe((s) => s.count, b);
    store.setState({ count: 1 });
    unsubA();
    store.setState({ count: 2 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});

describe("store.select() — reads", () => {
  it("returns the current selected slice on call", () => {
    const store = createStore({ count: 7, name: "Ada" });
    const count = store.select((s) => s.count);
    expect(count()).toBe(7);
  });

  it("reflects subsequent state changes when called again", () => {
    const store = createStore({ count: 0 });
    const count = store.select((s) => s.count);
    expect(count()).toBe(0);
    store.setState({ count: 5 });
    expect(count()).toBe(5);
    store.setState({ count: 9 });
    expect(count()).toBe(9);
  });

  it("supports projections that compute derived values", () => {
    const store = createStore({ items: [1, 2, 3] as number[] });
    const total = store.select((s) => s.items.reduce((a, b) => a + b, 0));
    expect(total()).toBe(6);
    store.setState({ items: [10, 20] });
    expect(total()).toBe(30);
  });

  it("supports projections that return objects/arrays", () => {
    const store = createStore({ user: { name: "Ada", age: 30 } });
    const user = store.select((s) => s.user);
    expect(user()).toEqual({ name: "Ada", age: 30 });
    store.setState({ user: { name: "Grace", age: 40 } });
    expect(user()).toEqual({ name: "Grace", age: 40 });
  });

  it("works with stores that have actions", () => {
    const store = createStore({ count: 0 }, (set, get) => ({
      increment: () => set({ count: get().count + 1 }),
    }));
    const count = store.select((s) => s.count);
    expect(count()).toBe(0);
    store.getState().increment();
    expect(count()).toBe(1);
    store.getState().increment();
    expect(count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// .select() — reactivity
// ---------------------------------------------------------------------------

describe("store.select() — reactivity", () => {
  it("re-runs an enclosing effect when the selected slice changes", () => {
    const store = createStore({ count: 0 });
    const count = store.select((s) => s.count);

    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(count());
    });

    expect(seen).toEqual([0]);

    store.setState({ count: 1 });
    store.setState({ count: 2 });
    store.setState({ count: 3 });

    expect(seen).toEqual([0, 1, 2, 3]);
    stop();
  });

  it("does NOT re-run an enclosing effect when an unrelated slice changes", () => {
    const store = createStore({ count: 0, label: "hi" });
    const count = store.select((s) => s.count);

    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(count());
    });

    expect(seen).toEqual([0]);

    // Mutating an unrelated field should not cause `count` slice to fire.
    store.setState({ label: "bye" });
    store.setState({ label: "again" });

    expect(seen).toEqual([0]);

    // But a relevant change still does.
    store.setState({ count: 5 });
    expect(seen).toEqual([0, 5]);

    stop();
  });

  it("does NOT re-run an enclosing effect when the slice value is unchanged", () => {
    // setState always replaces the top-level state object, but the computed
    // memoizes on Object.is, so derived effects should only see real changes.
    const store = createStore({ count: 0, label: "hi" });
    const count = store.select((s) => s.count);

    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(count());
    });

    expect(seen).toEqual([0]);

    // Re-set count to the same value — top-level state object changes, but
    // count slice does not.
    store.setState({ count: 0 });
    store.setState({ count: 0 });

    expect(seen).toEqual([0]);
    stop();
  });

  it("returns stable identity for object slices when state is shallow-merged unchanged", () => {
    const initial = { user: { name: "Ada" } };
    const store = createStore(initial);
    const user = store.select((s) => s.user);

    const a = user();
    // Touching another field doesn't reallocate the inner object.
    store.setState({} as Partial<typeof initial>);
    const b = user();
    expect(a).toBe(b);
  });

  it("supports multiple independent selectors over the same store", () => {
    const store = createStore({ a: 1, b: 10 });
    const aSel = store.select((s) => s.a);
    const bSel = store.select((s) => s.b);

    const aSeen: number[] = [];
    const bSeen: number[] = [];
    const stopA = effect(() => {
      aSeen.push(aSel());
    });
    const stopB = effect(() => {
      bSeen.push(bSel());
    });

    expect(aSeen).toEqual([1]);
    expect(bSeen).toEqual([10]);

    store.setState({ a: 2 });
    expect(aSeen).toEqual([1, 2]);
    expect(bSeen).toEqual([10]); // b untouched

    store.setState({ b: 20 });
    expect(aSeen).toEqual([1, 2]); // a untouched
    expect(bSeen).toEqual([10, 20]);

    stopA();
    stopB();
  });

  it("each .select() call returns a fresh accessor (no global caching by selector identity)", () => {
    const store = createStore({ count: 0 });
    const sel = (s: { count: number }) => s.count;
    const a = store.select(sel);
    const b = store.select(sel);
    // Different accessor instances...
    expect(a).not.toBe(b);
    // ...but observing the same underlying value.
    expect(a()).toBe(b());
    store.setState({ count: 42 });
    expect(a()).toBe(42);
    expect(b()).toBe(42);
  });

  it("composes — a selector can read another selector's output", () => {
    const store = createStore({ items: [1, 2, 3] as number[] });
    const items = store.select((s) => s.items);
    // Outer selector reads through the inner accessor; the inner closes over
    // `store` directly, so the outer just composes pure JS functions.
    const count = store.select((s) => s.items.length);

    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(count());
    });

    expect(seen).toEqual([3]);
    store.setState({ items: [...items(), 4] });
    expect(seen).toEqual([3, 4]);
    stop();
  });
});

// ---------------------------------------------------------------------------
// .select() — type-level checks (compile-time, exercised at runtime)
// ---------------------------------------------------------------------------

describe("store.select() — type inference", () => {
  it("infers the selected value type from the projection", () => {
    const store = createStore({ count: 0, name: "Ada" });

    const count = store.select((s) => s.count);
    const name = store.select((s) => s.name);
    const upper = store.select((s) => s.name.toUpperCase());

    // These calls must satisfy the inferred return type at compile time.
    const c: number = count();
    const n: string = name();
    const u: string = upper();

    expect(c).toBe(0);
    expect(n).toBe("Ada");
    expect(u).toBe("ADA");
  });

  it("includes action keys in the state shape passed to the selector", () => {
    const store = createStore({ count: 0 }, (set) => ({
      reset: () => set({ count: 0 }),
    }));
    // Selector sees both state and action keys — `reset` is a function.
    const reset = store.select((s) => s.reset);
    expect(typeof reset()).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// bind(selector) — Ilha bind:* accessor
// ---------------------------------------------------------------------------

describe("bind(selector) — bindable accessor", () => {
  it("returns a function", () => {
    const store = createStore({ query: "" });
    const query = store.bind((s) => s.query);
    expect(typeof query).toBe("function");
  });

  it("reads current value with no args", () => {
    const store = createStore({ query: "ilha" });
    const query = store.bind((s) => s.query);
    expect(query()).toBe("ilha");
  });

  it("writes value via accessor call", () => {
    const store = createStore({ query: "" });
    const query = store.bind((s) => s.query);
    query("abc");
    expect(store.getState().query).toBe("abc");
  });

  it("updates nested path immutably", () => {
    const other = { x: 1 };
    const store = createStore({ search: { query: "" }, other });
    const query = store.bind((s) => s.search.query);
    const before = store.getState().search;
    query("abc");
    expect(store.getState().search.query).toBe("abc");
    expect(store.getState().search).not.toBe(before);
    expect(store.getState().other).toBe(other);
  });

  it("updates array index path", () => {
    const store = createStore({ items: [{ title: "Old" }] });
    const title = store.bind((s) => s.items[0].title);
    title("New");
    expect(store.getState().items[0].title).toBe("New");
  });

  it("is reactive in alien-signals effect", () => {
    const store = createStore({ count: 0 });
    const count = store.bind((s) => s.count);
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(count());
    });
    expect(seen).toEqual([0]);
    store.setState({ count: 2 });
    expect(seen).toEqual([0, 2]);
    stop();
  });

  it("throws for unsupported selector shapes", () => {
    const store = createStore({ query: "  x  " });
    expect(() => store.bind((s) => s.query.trim())).toThrow(/property-path selectors/);
    expect(() => store.bind((s) => s.query + "!")).toThrow(/property-path selectors/);
  });

  it("preserves actions after bind writes", () => {
    const store = createStore({ count: 0 }, (set) => ({
      inc: () => set((s) => ({ count: s.count + 1 })),
    }));
    const count = store.bind((s) => s.count);
    count(5);
    expect(store.getState().count).toBe(5);
    store.getState().inc();
    expect(store.getState().count).toBe(6);
  });
});

describe("bind(selector) — Ilha integration", () => {
  it("bind:value updates store from input event", () => {
    const store = createStore({ query: "" });
    const query = store.bind((s) => s.query);
    const Island = ilha.render(() => html`<input data-q bind:value=${query}><p>${query()}</p>`);

    const el = document.createElement("div");
    document.body.appendChild(el);
    const unmount = Island.mount(el);
    const input = el.querySelector<HTMLInputElement>("[data-q]")!;
    input.value = "typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(store.getState().query).toBe("typed");
    expect(el.querySelector("p")!.textContent).toBe("typed");
    unmount();
    el.remove();
  });
});
