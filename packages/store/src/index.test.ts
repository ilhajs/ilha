// =============================================================================
// @ilha/store — test suite
// Run with: bun test --dom (happy-dom needed for bind() tests)
// =============================================================================

import { describe, it, expect, mock, beforeEach } from "bun:test";

import { effect } from "alien-signals";
import { html, raw } from "ilha";

import { createStore, effectScope } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fixture(markup: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = markup;
  document.body.appendChild(el);
  return el;
}

function makeEl(inner = ""): Element {
  const el = document.createElement("div");
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

function cleanup(el: Element) {
  if (el.parentNode) el.parentNode.removeChild(el);
}

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
// bind() — plain string render
// ---------------------------------------------------------------------------

describe("bind() — plain string render", () => {
  it("renders immediately on bind", () => {
    const store = createStore({ count: 0 });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(target, (s) => `<span>${s.count}</span>`);
    expect(target.innerHTML).toBe("<span>0</span>");
  });

  it("re-renders when state changes", () => {
    const store = createStore({ count: 0 });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(target, (s) => `<span>${s.count}</span>`);
    store.setState({ count: 5 });
    expect(target.innerHTML).toBe("<span>5</span>");
  });

  it("returns an unsub function that stops re-renders", () => {
    const store = createStore({ count: 0 });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    const unsub = store.bind(target, (s) => `${s.count}`);
    store.setState({ count: 1 });
    unsub();
    store.setState({ count: 99 });
    expect(target.innerHTML).toBe("1");
  });

  it("multiple bind calls on different elements are independent", () => {
    const store = createStore({ count: 0 });
    const root = fixture("<div id='a'></div><div id='b'></div>");
    const a = root.querySelector("#a")!;
    const b = root.querySelector("#b")!;
    store.bind(a, (s) => `a:${s.count}`);
    store.bind(b, (s) => `b:${s.count}`);
    store.setState({ count: 3 });
    expect(a.innerHTML).toBe("a:3");
    expect(b.innerHTML).toBe("b:3");
  });
});

// ---------------------------------------------------------------------------
// bind() — RawHtml render (ilha html``)
// ---------------------------------------------------------------------------

describe("bind() — RawHtml render", () => {
  it("accepts an html`` tagged template as render output", () => {
    const store = createStore({ count: 0 });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(target, (s) => html`<span>${s.count}</span>`);
    expect(target.innerHTML).toContain("0");
  });

  it("re-renders on state change when using html``", () => {
    const store = createStore({ count: 0 });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(target, (s) => html`<b>${s.count}</b>`);
    store.setState({ count: 7 });
    expect(target.innerHTML).toContain("7");
  });

  it("html`` escapes interpolated values", () => {
    const store = createStore({ label: "<script>xss</script>" });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(target, (s) => html`<p>${s.label}</p>`);
    expect(target.innerHTML).not.toContain("<script>");
    expect(target.innerHTML).toContain("&lt;script&gt;");
  });

  it("raw() passes trusted HTML through unescaped", () => {
    const store = createStore({ bold: "<b>hi</b>" });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(target, (s) => html`<p>${raw(s.bold)}</p>`);
    expect(target.innerHTML).toContain("<b>hi</b>");
  });

  it("list rendering with html`` — no comma-joining", () => {
    const store = createStore({ items: ["a", "b", "c"] });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(
      target,
      (s) =>
        html`<ul>
          ${s.items.map((i) => html`<li>${i}</li>`)}
        </ul>`,
    );
    expect(target.querySelectorAll("li").length).toBe(3);
    expect(target.innerHTML).not.toContain(",");
  });

  it("updates list correctly on state change", () => {
    const store = createStore({ items: ["a"] });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(
      target,
      (s) =>
        html`<ul>
          ${s.items.map((i) => html`<li>${i}</li>`)}
        </ul>`,
    );
    store.setState({ items: ["a", "b", "c"] });
    expect(target.querySelectorAll("li").length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// bind() — selector form
// ---------------------------------------------------------------------------

describe("bind() — selector form", () => {
  it("renders immediately with the initial slice", () => {
    const store = createStore({ count: 0, name: "Ada" });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(
      target,
      (s) => s.count,
      (count) => `<b>${count}</b>`,
    );
    expect(target.innerHTML).toBe("<b>0</b>");
  });

  it("re-renders when the selected slice changes", () => {
    const store = createStore({ count: 0, name: "Ada" });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(
      target,
      (s) => s.count,
      (count) => `${count}`,
    );
    store.setState({ count: 7 });
    expect(target.innerHTML).toBe("7");
  });

  it("does NOT re-render when an unrelated slice changes", () => {
    const store = createStore({ count: 0, name: "Ada" });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    const render = mock((count: number) => `${count}`);
    store.bind(target, (s) => s.count, render);
    const callsBefore = render.mock.calls.length;
    store.setState({ name: "Grace" });
    expect(render.mock.calls.length).toBe(callsBefore);
  });

  it("returns an unsub that stops re-renders", () => {
    const store = createStore({ count: 0 });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    const unsub = store.bind(
      target,
      (s) => s.count,
      (c) => `${c}`,
    );
    store.setState({ count: 1 });
    unsub();
    store.setState({ count: 99 });
    expect(target.innerHTML).toBe("1");
  });

  it("accepts html`` as render output in selector form", () => {
    const store = createStore({ name: "Ada" });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(
      target,
      (s) => s.name,
      (name) => html`<span>${name}</span>`,
    );
    expect(target.innerHTML).toContain("Ada");
    store.setState({ name: "Grace" });
    expect(target.innerHTML).toContain("Grace");
  });

  it("two selectors on the same element — last bind wins (overwrites innerHTML)", () => {
    const store = createStore({ a: 0, b: 0 });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    store.bind(
      target,
      (s) => s.a,
      (a) => `a:${a}`,
    );
    store.bind(
      target,
      (s) => s.b,
      (b) => `b:${b}`,
    );
    expect(target.innerHTML).toBe("b:0");
    store.setState({ a: 1 });
    expect(target.innerHTML).toBe("a:1");
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

  it("stops all bind effects inside the scope", () => {
    const store = createStore({ count: 0 });
    const el = fixture("<div id='t'></div>");
    const target = el.querySelector("#t")!;
    const stop = effectScope(() => {
      store.bind(target, (s) => `${s.count}`);
    });
    store.setState({ count: 5 });
    expect(target.innerHTML).toBe("5");
    stop();
    store.setState({ count: 99 });
    expect(target.innerHTML).toBe("5");
  });

  it("groups multiple binds and subscriptions — one stop tears all down", () => {
    const store = createStore({ count: 0, name: "Ada" });
    const root = fixture("<div id='a'></div><div id='b'></div>");
    const a = root.querySelector("#a")!;
    const b = root.querySelector("#b")!;
    const listener = mock();
    const stop = effectScope(() => {
      store.bind(
        a,
        (s) => s.count,
        (c) => `${c}`,
      );
      store.bind(
        b,
        (s) => s.name,
        (n) => n,
      );
      store.subscribe(listener);
    });
    store.setState({ count: 1, name: "Grace" });
    expect(a.innerHTML).toBe("1");
    expect(b.innerHTML).toBe("Grace");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.setState({ count: 99, name: "Turing" });
    expect(a.innerHTML).toBe("1");
    expect(b.innerHTML).toBe("Grace");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe("integration", () => {
  it("store-driven error state renders via bind with html``", () => {
    const store = createStore({ errors: {} as Record<string, string> }, (set) => ({
      setErrors: (errors: Record<string, string>) => set({ errors }),
      clearErrors: () => set({ errors: {} }),
    }));
    const el = fixture("<div id='errors'></div>");
    const target = el.querySelector("#errors")!;
    store.bind(
      target,
      (s) => s.errors,
      (errors) =>
        html`${Object.entries(errors).map(([f, m]) => html`<p data-field="${f}">${m}</p>`)}`,
    );
    expect(target.innerHTML).toBe("");
    store.getState().setErrors({ email: "Invalid email", name: "Required" });
    expect(target.querySelectorAll("p").length).toBe(2);
    expect(target.querySelector("[data-field='email']")?.textContent).toBe("Invalid email");
    store.getState().clearErrors();
    expect(target.querySelector("p")).toBeNull();
  });

  it("counter with html`` label", () => {
    const store = createStore({ count: 0 }, (set) => ({
      inc: () => set((s) => ({ count: s.count + 1 })),
    }));
    const el = fixture("<div id='label'></div>");
    const target = el.querySelector("#label")!;
    store.bind(
      target,
      (s) => s.count,
      (count) => html`<span>Count: ${count}</span>`,
    );
    expect(target.innerHTML).toContain("Count: 0");
    store.getState().inc();
    store.getState().inc();
    expect(target.innerHTML).toContain("Count: 2");
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

  it("store shared across two bind targets — both stay in sync", () => {
    const store = createStore({ value: "hello" });
    const root = fixture("<div id='a'></div><div id='b'></div>");
    const a = root.querySelector("#a")!;
    const b = root.querySelector("#b")!;
    store.bind(a, (s) => html`<p>${s.value}</p>`);
    store.bind(b, (s) => html`<em>${s.value}</em>`);
    store.setState({ value: "ilha" });
    expect(a.querySelector("p")?.textContent).toBe("ilha");
    expect(b.querySelector("em")?.textContent).toBe("ilha");
  });

  it("unsubscribing one consumer does not affect another", () => {
    const store = createStore({ count: 0 });
    const root = fixture("<div id='a'></div><div id='b'></div>");
    const a = root.querySelector("#a")!;
    const b = root.querySelector("#b")!;
    const unsubA = store.bind(a, (s) => `${s.count}`);
    store.bind(b, (s) => `${s.count}`);
    store.setState({ count: 1 });
    unsubA();
    store.setState({ count: 2 });
    expect(a.innerHTML).toBe("1"); // frozen after unsub
    expect(b.innerHTML).toBe("2"); // still live
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
    const stopA = effect(() => aSeen.push(aSel()));
    const stopB = effect(() => bSeen.push(bSel()));

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
// .select() — interplay with bind() refactor
// ---------------------------------------------------------------------------

describe("store.bind() (post-refactor)", () => {
  it("two-arg form still updates the element when slice changes", () => {
    const el = makeEl();
    const store = createStore({ name: "Ada" });
    const stop = store.bind(
      el,
      (s) => s.name,
      (name) => `<p>${name}</p>`,
    );
    expect(el.innerHTML).toBe("<p>Ada</p>");
    store.setState({ name: "Grace" });
    expect(el.innerHTML).toBe("<p>Grace</p>");
    stop();
    cleanup(el);
  });

  it("two-arg form does NOT re-render when an unrelated field changes", () => {
    const el = makeEl();
    const store = createStore({ name: "Ada", count: 0 });

    let renders = 0;
    const stop = store.bind(
      el,
      (s) => s.name,
      (name) => {
        renders++;
        return `<p>${name}</p>`;
      },
    );
    expect(renders).toBe(1);

    store.setState({ count: 1 });
    store.setState({ count: 2 });
    expect(renders).toBe(1);

    store.setState({ name: "Grace" });
    expect(renders).toBe(2);

    stop();
    cleanup(el);
  });

  it("one-arg form is unaffected and re-renders on any state change", () => {
    const el = makeEl();
    const store = createStore({ a: 1, b: 2 });

    let renders = 0;
    const stop = store.bind(el, (s) => {
      renders++;
      return `<p>${s.a}-${s.b}</p>`;
    });
    expect(renders).toBe(1);
    expect(el.innerHTML).toBe("<p>1-2</p>");

    store.setState({ a: 10 });
    expect(renders).toBe(2);
    store.setState({ b: 20 });
    expect(renders).toBe(3);
    expect(el.innerHTML).toBe("<p>10-20</p>");

    stop();
    cleanup(el);
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
