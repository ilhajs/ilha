import { describe, it, expect, beforeEach } from "bun:test";

import { z } from "zod";

import type { SlotAccessor } from "./index";
import ilha, { html, raw, mount, from, context } from "./index";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function dedent(str: string): string {
  const lines = str.split("\n").filter((l) => l.trim() !== "");
  const indent = Math.min(...lines.map((l) => l.match(/^(\s*)/)![1]!.length));
  return lines.map((l) => l.slice(indent)).join("\n");
}

function makeEl(inner = ""): Element {
  const el = document.createElement("div");
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

function cleanup(el: Element) {
  document.body.removeChild(el);
}

// ─────────────────────────────────────────────
// html`` tagged template
// ─────────────────────────────────────────────

describe("html``", () => {
  it("renders static strings", () => {
    expect(
      html`
        <p>hello</p>
      `,
    ).toBe("<p>hello</p>");
  });

  it("escapes interpolated strings", () => {
    const val = '<script>alert("xss")</script>';
    expect(html`<p>${val}</p>`).toBe("<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>");
  });

  it("escapes interpolated numbers", () => {
    expect(html`<p>${42}</p>`).toBe("<p>42</p>");
  });

  it("skips null and undefined interpolations", () => {
    expect(html`<p>${null}${undefined}</p>`).toBe("<p></p>");
  });

  it("passes raw() through unescaped", () => {
    expect(html`<div>${raw("<b>bold</b>")}</div>`).toBe("<div><b>bold</b></div>");
  });

  it("calls function interpolations and escapes result", () => {
    const fn = () => "<em>hi</em>";
    expect(html`<p>${fn}</p>`).toBe("<p>&lt;em&gt;hi&lt;/em&gt;</p>");
  });

  it("preserves whitespace as-is in multiline templates", () => {
    const result = dedent(html`
      <p>hello</p>
      <button>click</button>
    `);
    expect(result).toBe("<p>hello</p>\n<button>click</button>");
  });

  it("renders signal accessor value via ${state.x} without call", () => {
    const island = ilha
      .input(z.object({ count: z.number().default(7) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => html`<p>${state.count}</p>`);

    expect(island()).toBe("<p>7</p>");
  });

  it("escapes signal accessor value", () => {
    const island = ilha
      .input(z.object({ label: z.string().default("<b>hi</b>") }))
      .state("label", ({ label }) => label)
      .render(({ state }) => html`<p>${state.label}</p>`);

    expect(island()).toBe("<p>&lt;b&gt;hi&lt;/b&gt;</p>");
  });
});

// ─────────────────────────────────────────────
// raw()
// ─────────────────────────────────────────────

describe("raw()", () => {
  it("returns object with raw symbol", () => {
    const r = raw("<b>x</b>");
    expect(typeof r).toBe("object");
    expect(r.value).toBe("<b>x</b>");
  });
});

// ─────────────────────────────────────────────
// Island — SSR
// ─────────────────────────────────────────────

describe("island SSR", () => {
  it("renders with schema defaults when called with no args", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    expect(counter()).toBe("<p>0</p>");
  });

  it("renders with provided props", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    expect(counter({ count: 7 })).toBe("<p>7</p>");
  });

  it("toString() with no args uses schema defaults", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(5) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<span>${state.count()}</span>`);

    expect(counter.toString()).toBe("<span>5</span>");
  });

  it("toString() with props", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<span>${state.count()}</span>`);

    expect(counter.toString({ count: 99 })).toBe("<span>99</span>");
  });

  it("interpolates correctly in template string via implicit toString", () => {
    const badge = ilha
      .input(z.object({ label: z.string().default("hi") }))
      .render(({ input }) => `<b>${input.label}</b>`);

    expect(`<div>${badge}</div>`).toBe("<div><b>hi</b></div>");
  });

  it("renders plain state value without function init", () => {
    const island = ilha
      .input(z.object({}))
      .state("step", 3)
      .render(({ state }) => `<p>${state.step()}</p>`);

    expect(island()).toBe("<p>3</p>");
  });

  it("renders multiple state keys", () => {
    const island = ilha
      .input(z.object({ a: z.number().default(1), b: z.number().default(2) }))
      .state("a", ({ a }) => a)
      .state("b", ({ b }) => b)
      .render(({ state }) => `${state.a()}-${state.b()}`);

    expect(island()).toBe("1-2");
    expect(island({ a: 10, b: 20 })).toBe("10-20");
  });

  it("exposes input to render", () => {
    const island = ilha
      .input(z.object({ name: z.string().default("world") }))
      .render(({ input }) => `<p>hello ${input.name}</p>`);

    expect(island({ name: "Ada" })).toBe("<p>hello Ada</p>");
  });

  it("throws on invalid props", () => {
    const island = ilha
      .input(z.object({ count: z.number() }))
      .render(({ input }) => `${input.count}`);

    expect(() => island({ count: "not-a-number" as never })).toThrow("[ilha] Validation failed");
  });

  it(".on() and .effect() are no-ops during SSR render", () => {
    const island = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .on("[data-inc]", "click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .effect(({ state }) => {
        state.count(99);
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    expect(island({ count: 3 })).toBe("<p>3</p>");
  });
});

// ─────────────────────────────────────────────
// Island — client mount
// ─────────────────────────────────────────────

describe("island mount", () => {
  it("renders into the element on mount", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = counter.mount(el, { count: 3 });
    expect(el.innerHTML).toBe("<p>3</p>");
    unmount();
    cleanup(el);
  });

  it("re-renders when state changes", () => {
    let accessor!: (v?: number) => number | void;

    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => {
        accessor = state.count as typeof accessor;
        return `<p>${state.count()}</p>`;
      });

    const el = makeEl();
    const unmount = counter.mount(el, { count: 0 });
    expect(el.innerHTML).toBe("<p>0</p>");

    accessor(5);
    expect(el.innerHTML).toBe("<p>5</p>");

    unmount();
    cleanup(el);
  });

  it("attaches event listeners and updates state on click", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .on("[data-inc]", "click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    const el = makeEl();
    const unmount = counter.mount(el, { count: 0 });

    (el.querySelector("[data-inc]") as HTMLButtonElement).click();
    expect(el.querySelector("p")!.textContent).toBe("1");

    (el.querySelector("[data-inc]") as HTMLButtonElement).click();
    expect(el.querySelector("p")!.textContent).toBe("2");

    unmount();
    cleanup(el);
  });

  it("unmount removes event listeners", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .on("[data-inc]", "click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    const el = makeEl();
    const unmount = counter.mount(el, { count: 0 });
    unmount();

    (el.querySelector("[data-inc]") as HTMLButtonElement).click();
    expect(el.querySelector("p")!.textContent).toBe("0");
    cleanup(el);
  });

  it("runs effect on mount", () => {
    const calls: number[] = [];

    const island = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .effect(({ state }) => {
        calls.push(state.count());
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = island.mount(el, { count: 42 });
    expect(calls).toContain(42);
    unmount();
    cleanup(el);
  });

  it("effect re-runs when tracked state changes", () => {
    const calls: number[] = [];
    let accessor!: (v?: number) => number | void;

    const island = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .effect(({ state }) => {
        accessor = state.count as typeof accessor;
        calls.push(state.count());
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = island.mount(el);

    accessor(1);
    accessor(2);

    expect(calls).toEqual([0, 1, 2]);
    unmount();
    cleanup(el);
  });

  it("effect cleanup is called on unmount", () => {
    const log: string[] = [];

    const island = ilha
      .input(z.object({}))
      .state("tick", 0)
      .effect(({ state }) => {
        log.push(`run:${state.tick()}`);
        return () => log.push(`cleanup:${state.tick()}`);
      })
      .render(({ state }) => `${state.tick()}`);

    const el = makeEl();
    const unmount = island.mount(el);
    expect(log).toContain("run:0");
    unmount();
    expect(log.some((l) => l.startsWith("cleanup:"))).toBe(true);
    cleanup(el);
  });

  it("two mounted instances have independent state", () => {
    let capA!: (v?: number) => number | void;
    let capB!: (v?: number) => number | void;

    const islandA = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => {
        capA = state.count as typeof capA;
        return `<p>${state.count()}</p>`;
      });

    const islandB = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => {
        capB = state.count as typeof capB;
        return `<p>${state.count()}</p>`;
      });

    const elA = makeEl();
    const elB = makeEl();
    const unmountA = islandA.mount(elA, { count: 0 });
    const unmountB = islandB.mount(elB, { count: 0 });

    capA(10);
    expect(elA.querySelector("p")!.textContent).toBe("10");
    expect(elB.querySelector("p")!.textContent).toBe("0");

    capB(99);
    expect(elB.querySelector("p")!.textContent).toBe("99");
    expect(elA.querySelector("p")!.textContent).toBe("10");

    unmountA();
    unmountB();
    cleanup(elA);
    cleanup(elB);
  });

  it("plain value state init works on client", () => {
    const island = ilha
      .input(z.object({}))
      .state("step", 5)
      .on("[data-btn]", "click", ({ state }) => {
        state.step(state.step() + 1);
      })
      .render(({ state }) => `<p>${state.step()}</p><button data-btn>+</button>`);

    const el = makeEl();
    const unmount = island.mount(el);
    expect(el.querySelector("p")!.textContent).toBe("5");

    (el.querySelector("[data-btn]") as HTMLButtonElement).click();
    expect(el.querySelector("p")!.textContent).toBe("6");

    unmount();
    cleanup(el);
  });

  // ─────────────────────────────────────────────
  // .on() modifiers
  // ─────────────────────────────────────────────

  describe(".on() modifiers", () => {
    it(":once fires handler only once", () => {
      const calls: number[] = [];

      const island = ilha
        .state("count", 0)
        .on("[data-btn]@click:once", ({ state }) => {
          calls.push(state.count());
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn>+</button>`);

      const el = makeEl();
      const unmount = island.mount(el);

      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();

      expect(calls.length).toBe(1);
      unmount();
      cleanup(el);
    });

    it("root element @event binding (empty selector)", () => {
      const calls: number[] = [];

      const island = ilha
        .state("count", 0)
        .on("@click", ({ state }) => {
          calls.push(state.count());
        })
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);

      (el as HTMLElement).click();
      expect(calls.length).toBe(1);

      unmount();
      cleanup(el);
    });
  });

  // ─────────────────────────────────────────────
  // ilha.from()
  // ─────────────────────────────────────────────

  describe("ilha.from()", () => {
    it("mounts island onto element matching selector", () => {
      const counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      el.id = "from-test";

      const unmount = from("#from-test", counter, { count: 42 });
      expect(el.querySelector("p")!.textContent).toBe("42");

      unmount?.();
      cleanup(el);
    });

    it("returns null and warns when selector not found", () => {
      const island = ilha.render(() => `<p>hi</p>`);
      const result = from("#does-not-exist", island);
      expect(result).toBeNull();
    });

    it("accepts an Element directly", () => {
      const island = ilha.state("x", 99).render(({ state }) => `<span>${state.x()}</span>`);

      const el = makeEl();
      const unmount = from(el, island as never);
      expect(el.querySelector("span")!.textContent).toBe("99");

      unmount?.();
      cleanup(el);
    });
  });

  // ─────────────────────────────────────────────
  // ilha.context()
  // ─────────────────────────────────────────────

  describe("ilha.context()", () => {
    it("shared signal is readable across islands", () => {
      const theme = context("test-theme", "light");

      const a = ilha.render(() => `<p>${theme()}</p>`);
      const b = ilha.render(() => `<span>${theme()}</span>`);

      const elA = makeEl();
      const elB = makeEl();
      const ua = a.mount(elA);
      const ub = b.mount(elB);

      expect(elA.querySelector("p")!.textContent).toBe("light");
      expect(elB.querySelector("span")!.textContent).toBe("light");

      ua();
      ub();
      cleanup(elA);
      cleanup(elB);
    });

    it("writing shared signal updates all subscribed islands", () => {
      const score = context("test-score", 0);

      const display = ilha.render(() => `<p>${score()}</p>`);

      const control = ilha
        .state("_", 0)
        .on("[data-set]@click", () => {
          score(score() + 10);
        })
        .render(() => {
          return `<button data-set>set</button>`;
        });

      const elD = makeEl();
      const elC = makeEl();
      const ud = display.mount(elD);
      const uc = control.mount(elC);

      (elC.querySelector("[data-set]") as HTMLButtonElement).click();
      expect(elD.querySelector("p")!.textContent).toBe("10");

      (elC.querySelector("[data-set]") as HTMLButtonElement).click();
      expect(elD.querySelector("p")!.textContent).toBe("20");

      ud();
      uc();
      cleanup(elD);
      cleanup(elC);
    });

    it("same key always returns the same signal", () => {
      const a = context("test-singleton", 0);
      const b = context("test-singleton", 999);
      expect(a).toBe(b);
      expect(a()).toBe(0); // initial value from first registration wins
    });
  });

  // ─────────────────────────────────────────────
  // .transition()
  // ─────────────────────────────────────────────

  describe(".transition()", () => {
    it("calls enter on mount", () => {
      const log: string[] = [];

      const island = ilha
        .transition({
          enter: () => {
            log.push("enter");
          },
        })
        .render(() => `<p>hi</p>`);

      const el = makeEl();
      const unmount = island.mount(el);
      expect(log).toContain("enter");
      unmount();
      cleanup(el);
    });

    it("calls leave on unmount", () => {
      const log: string[] = [];

      const island = ilha
        .transition({
          leave: () => {
            log.push("leave");
          },
        })
        .render(() => `<p>hi</p>`);

      const el = makeEl();
      const unmount = island.mount(el);
      unmount();
      expect(log).toContain("leave");
      cleanup(el);
    });

    it("awaits async leave before teardown", async () => {
      const log: string[] = [];

      const island = ilha
        .state("count", 0)
        .on("[data-inc]@click", ({ state }) => state.count(state.count() + 1))
        .transition({
          leave: () =>
            new Promise<void>((resolve) =>
              setTimeout(() => {
                log.push("leave-done");
                resolve();
              }, 10),
            ),
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

      const el = makeEl();
      const unmount = island.mount(el);

      unmount();
      expect(log).not.toContain("leave-done");

      await new Promise((r) => setTimeout(r, 20));
      expect(log).toContain("leave-done");

      cleanup(el);
    });
  });

  // ─────────────────────────────────────────────
  // SSR hydration (data-ilha-state)
  // ─────────────────────────────────────────────

  describe("SSR hydration", () => {
    it("mounts with state from data-ilha-state attribute", () => {
      const counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl("<p>42</p>");
      el.setAttribute("data-ilha-state", JSON.stringify({ count: 42 }));

      const unmount = counter.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("42");

      unmount();
      cleanup(el);
    });

    it("data-ilha-state takes priority over input props", () => {
      const counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      el.setAttribute("data-ilha-state", JSON.stringify({ count: 99 }));

      // passing count: 1 via props — snapshot should win
      const unmount = counter.mount(el, { count: 1 });
      expect(el.querySelector("p")!.textContent).toBe("99");

      unmount();
      cleanup(el);
    });

    it("hydrate: true in mountAll preserves SSR HTML until render", () => {
      document.body.innerHTML = "";

      const counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = document.createElement("div");
      el.setAttribute("data-ilha", "counter");
      el.setAttribute("data-props", JSON.stringify({ count: 3 }));
      el.innerHTML = "<p>ssr</p>";
      document.body.appendChild(el);

      const { unmount } = mount({ counter } as never, { hydrate: true });
      // after mount island renders with props
      expect(el.querySelector("p")!.textContent).toBe("3");
      unmount();
    });
  });
});

// ─────────────────────────────────────────────
// ilha.mount — auto-discovery
// ─────────────────────────────────────────────

describe("ilha.mount()", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("discovers and mounts [data-ilha] elements", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = document.createElement("div");
    el.setAttribute("data-ilha", "counter");
    el.setAttribute("data-props", JSON.stringify({ count: 7 }));
    document.body.appendChild(el);

    const { unmount } = mount({ counter } as never);
    expect(el.innerHTML).toBe("<p>7</p>");
    unmount();
  });

  it("ignores unknown island names", () => {
    const el = document.createElement("div");
    el.setAttribute("data-ilha", "unknown");
    el.innerHTML = "<p>original</p>";
    document.body.appendChild(el);

    const { unmount } = mount({} as never);
    expect(el.innerHTML).toBe("<p>original</p>");
    unmount();
  });

  it("handles malformed data-props gracefully", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = document.createElement("div");
    el.setAttribute("data-ilha", "counter");
    el.setAttribute("data-props", "{invalid json}");
    document.body.appendChild(el);

    expect(() => mount({ counter } as never)).not.toThrow();
  });

  it("unmount() tears down all discovered islands", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .on("[data-inc]", "click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    const el = document.createElement("div");
    el.setAttribute("data-ilha", "counter");
    el.setAttribute("data-props", JSON.stringify({ count: 0 }));
    document.body.appendChild(el);

    const { unmount } = mount({ counter } as never);
    unmount();

    (el.querySelector("[data-inc]") as HTMLButtonElement).click();
    expect(el.querySelector("p")!.textContent).toBe("0");
  });

  it("scopes discovery to provided root", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const inside = document.createElement("div");
    inside.setAttribute("data-ilha", "counter");
    inside.setAttribute("data-props", JSON.stringify({ count: 1 }));

    const outside = document.createElement("div");
    outside.setAttribute("data-ilha", "counter");
    outside.setAttribute("data-props", JSON.stringify({ count: 2 }));
    outside.innerHTML = "<p>original</p>";

    const root = document.createElement("section");
    root.appendChild(inside);
    document.body.appendChild(root);
    document.body.appendChild(outside);

    const { unmount } = mount({ counter } as never, { root });
    expect(inside.innerHTML).toBe("<p>1</p>");
    expect(outside.innerHTML).toBe("<p>original</p>");
    unmount();
  });

  it("mounts multiple different islands", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<span>${state.count()}</span>`);

    const greeting = ilha
      .input(z.object({ name: z.string().default("world") }))
      .render(({ input }) => `<b>hello ${input.name}</b>`);

    const elA = document.createElement("div");
    elA.setAttribute("data-ilha", "counter");
    elA.setAttribute("data-props", JSON.stringify({ count: 3 }));

    const elB = document.createElement("div");
    elB.setAttribute("data-ilha", "greeting");
    elB.setAttribute("data-props", JSON.stringify({ name: "Ada" }));

    document.body.appendChild(elA);
    document.body.appendChild(elB);

    const { unmount } = mount({ counter, greeting } as never);
    expect(elA.innerHTML).toBe("<span>3</span>");
    expect(elB.innerHTML).toBe("<b>hello Ada</b>");
    unmount();
  });

  // ─────────────────────────────────────────────
  // Slots
  // ─────────────────────────────────────────────

  describe("slots", () => {
    beforeEach(() => {
      document.body.innerHTML = "";
    });

    it("SSR: renders child island inline via children proxy", () => {
      const badge = ilha
        .state("label", "hello")
        .render(({ state }) => `<span>${state.label()}</span>`);

      const card = ilha
        .slot("badge", badge as never)
        .render(({ slots }) => `<div>${slots.badge}</div>`);

      expect(card()).toBe("<div><span>hello</span></div>");
    });

    it("SSR: child renders with its own schema defaults", () => {
      const counter = ilha
        .input(z.object({ count: z.number().default(99) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const parent = ilha
        .slot("counter", counter as never)
        .render(({ slots }) => `<section>${slots.counter}</section>`);

      expect(parent()).toBe("<section><p>99</p></section>");
    });

    it("SSR: slot renders with passed props", () => {
      const counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const parent = ilha
        .slot("counter", counter as never)
        .render(({ slots }) => html`<div>${slots.counter({ count: 5 })}</div>`);

      expect(parent()).toBe("<div><p>5</p></div>");
    });

    it("client: slot element is present in DOM after mount", () => {
      const child = ilha.render(() => `<span>child</span>`);

      const parent = ilha
        .slot("child", child as never)
        .render(({ slots }) => `<div>${slots.child}</div>`);

      const el = makeEl();
      const unmount = parent.mount(el);

      expect(el.querySelector("[data-ilha-slot='child']")).not.toBeNull();
      expect(el.querySelector("[data-ilha-slot='child']")!.innerHTML).toBe("<span>child</span>");

      unmount();
      cleanup(el);
    });

    it("client: child island is interactive independently", () => {
      const child = ilha
        .state("count", 0)
        .on("[data-inc]@click", ({ state }) => {
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

      const parent = ilha
        .slot("child", child as never)
        .render(({ slots }) => `<div class="parent">${slots.child}</div>`);

      const el = makeEl();
      const unmount = parent.mount(el);

      el.querySelector<HTMLButtonElement>("[data-inc]")!.click();
      expect(el.querySelector("p")!.textContent).toBe("1");

      el.querySelector<HTMLButtonElement>("[data-inc]")!.click();
      expect(el.querySelector("p")!.textContent).toBe("2");

      unmount();
      cleanup(el);
    });

    it("client: parent re-render does not destroy child slot", () => {
      const child = ilha
        .state("count", 0)
        .on("[data-inc]@click", ({ state }) => {
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

      let parentAccessor!: (v?: number) => number | void;

      const parent = ilha
        .state("tick", 0)
        .slot("child", child as never)
        .render(({ state, slots }) => {
          parentAccessor = state.tick as typeof parentAccessor;
          return `<div><span>${state.tick()}</span>${slots.child}</div>`;
        });

      const el = makeEl();
      const unmount = parent.mount(el);

      el.querySelector<HTMLButtonElement>("[data-inc]")!.click();
      expect(el.querySelector("p")!.textContent).toBe("1");

      parentAccessor(1);
      expect(el.querySelector("span")!.textContent).toBe("1");
      expect(el.querySelector("p")!.textContent).toBe("1");

      el.querySelector<HTMLButtonElement>("[data-inc]")!.click();
      expect(el.querySelector("p")!.textContent).toBe("2");

      unmount();
      cleanup(el);
    });

    it("client: multiple slots are independently preserved on parent re-render", () => {
      const childA = ilha.state("val", "A").render(({ state }) => `<i>${state.val()}</i>`);

      const childB = ilha.state("val", "B").render(({ state }) => `<b>${state.val()}</b>`);

      let parentAccessor!: (v?: number) => number | void;

      const parent = ilha
        .state("tick", 0)
        .slot("a", childA as never)
        .slot("b", childB as never)
        .render(({ state, slots }) => {
          parentAccessor = state.tick as typeof parentAccessor;
          return `<div>${state.tick()}${slots.a}${slots.b}</div>`;
        });

      const el = makeEl();
      const unmount = parent.mount(el);

      const slotA = el.querySelector("[data-ilha-slot='a']")!;
      const slotB = el.querySelector("[data-ilha-slot='b']")!;

      parentAccessor(1);

      expect(el.querySelector("[data-ilha-slot='a']")).toBe(slotA);
      expect(el.querySelector("[data-ilha-slot='b']")).toBe(slotB);

      unmount();
      cleanup(el);
    });

    it("client: parent unmount cascades to child slots", () => {
      const childCalls: string[] = [];

      const child = ilha
        .state("x", 0)
        .effect(({ state }) => {
          childCalls.push(`run:${state.x()}`);
          return () => childCalls.push(`cleanup:${state.x()}`);
        })
        .render(({ state }) => `<span>${state.x()}</span>`);

      const parent = ilha
        .slot("child", child as never)
        .render(({ slots }) => `<div>${slots.child}</div>`);

      const el = makeEl();
      const unmount = parent.mount(el);

      expect(childCalls).toContain("run:0");
      unmount();
      expect(childCalls.some((l) => l.startsWith("cleanup:"))).toBe(true);

      cleanup(el);
    });

    it("client: unknown slot name in slots proxy renders empty string", () => {
      const parent = ilha.render(
        ({ slots }) => html`<div>${(slots as Record<string, SlotAccessor>)["nonexistent"]}</div>`,
      );

      const el = makeEl();
      const unmount = parent.mount(el);
      expect(el.innerHTML).toBe("<div></div>");
      unmount();
      cleanup(el);
    });

    it("client: slot receives props via slots.x(props)", () => {
      const counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const parent = ilha
        .slot("counter", counter as never)
        .render(({ slots }) => html`<div>${slots.counter({ count: 7 })}</div>`);

      const el = makeEl();
      const unmount = parent.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("7");
      unmount();
      cleanup(el);
    });

    it("client: slot receives props via data-props attribute", () => {
      const counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const parent = ilha
        .slot("counter", counter as never)
        .render(() => `<div><div data-ilha-slot="counter" data-props='{"count":3}'></div></div>`);

      const el = makeEl();
      const unmount = parent.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("3");
      unmount();
      cleanup(el);
    });
  });

  // ─────────────────────────────────────────────
  // .derived()
  // ─────────────────────────────────────────────

  describe(".derived()", () => {
    // ── SSR — async ──────────────────────────────────────────────────────────

    it("SSR: async derived is always loading: true during SSR", () => {
      const island = ilha
        .derived("data", async () => "resolved")
        .render(({ derived }) =>
          derived.data.loading ? "<p>loading</p>" : `<p>${derived.data.value}</p>`,
        );

      expect(island()).toBe("<p>loading</p>");
    });

    it("SSR: async derived.value and derived.error are undefined during SSR", () => {
      const island = ilha
        .derived("data", async () => 42)
        .render(({ derived }) => {
          const d = derived.data;
          return `${d.loading}:${d.value}:${d.error}`;
        });

      expect(island()).toBe("true:undefined:undefined");
    });

    it("SSR: multiple async derived keys all start as loading", () => {
      const island = ilha
        .derived("a", async () => 1)
        .derived("b", async () => 2)
        .render(({ derived }) => `${derived.a.loading}:${derived.b.loading}`);

      expect(island()).toBe("true:true");
    });

    // ── SSR — sync ───────────────────────────────────────────────────────────

    it("SSR: sync derived resolves immediately during SSR", () => {
      const island = ilha
        .state("count", 5)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ derived }) =>
          derived.doubled.loading ? "<p>loading</p>" : `<p>${derived.doubled.value}</p>`,
        );

      expect(island()).toBe("<p>10</p>");
    });

    it("SSR: sync derived has loading: false and correct value", () => {
      const island = ilha
        .state("name", "ada")
        .derived("upper", ({ state }) => state.name().toUpperCase())
        .render(({ derived }) => {
          const d = derived.upper;
          return `${d.loading}:${d.value}:${d.error}`;
        });

      expect(island()).toBe("false:ADA:undefined");
    });

    it("SSR: sync derived receives input", () => {
      const island = ilha
        .input(z.object({ multiplier: z.number().default(3) }))
        .derived("result", ({ input }) => input.multiplier * 10)
        .render(({ derived }) => `<p>${derived.result.value}</p>`);

      expect(island({ multiplier: 4 })).toBe("<p>40</p>");
    });

    it("SSR: mixed sync and async derived — sync resolves, async is loading", () => {
      const island = ilha
        .state("count", 3)
        .derived("sync", ({ state }) => state.count() * 2)
        .derived("async", async ({ state }) => state.count() * 3)
        .render(
          ({ derived }) =>
            `${derived.sync.loading}:${derived.sync.value}:${derived.async.loading}:${derived.async.value}`,
        );

      expect(island()).toBe("false:6:true:undefined");
    });

    // ── Client — basic resolve ────────────────────────────────────────────────

    it("client: async derived resolves and triggers re-render", async () => {
      const island = ilha
        .derived("msg", async () => {
          await new Promise((r) => setTimeout(r, 5));
          return "hello";
        })
        .render(({ derived }) =>
          derived.msg.loading ? "<p>loading</p>" : `<p>${derived.msg.value}</p>`,
        );

      const el = makeEl();
      const unmount = island.mount(el);

      expect(el.querySelector("p")!.textContent).toBe("loading");

      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("hello");

      unmount();
      cleanup(el);
    });

    it("client: sync derived is immediately available on mount", () => {
      const island = ilha
        .state("count", 7)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ derived }) => `<p>${derived.doubled.value}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);

      expect(el.querySelector("p")!.textContent).toBe("14");

      unmount();
      cleanup(el);
    });

    it("client: sync derived never has loading: true", () => {
      const island = ilha
        .state("x", 3)
        .derived("sq", ({ state }) => state.x() ** 2)
        .render(({ derived }) => `<p>${derived.sq.loading}:${derived.sq.value}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);

      expect(el.querySelector("p")!.textContent).toBe("false:9");

      unmount();
      cleanup(el);
    });

    it("client: async derived captures error and sets error envelope", async () => {
      const island = ilha
        .derived("data", async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error("boom");
        })
        .render(({ derived }) => {
          if (derived.data.loading) return "<p>loading</p>";
          if (derived.data.error) return `<p>error:${derived.data.error.message}</p>`;
          return `<p>${derived.data.value}</p>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);

      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("error:boom");

      unmount();
      cleanup(el);
    });

    it("client: non-Error throws are wrapped in Error", async () => {
      const island = ilha
        .derived("data", async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw "string error";
        })
        .render(({ derived }) => {
          if (derived.data.loading) return "<p>loading</p>";
          if (derived.data.error) return `<p>${derived.data.error instanceof Error}</p>`;
          return "<p>ok</p>";
        });

      const el = makeEl();
      const unmount = island.mount(el);

      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("true");

      unmount();
      cleanup(el);
    });

    // ── Client — reactivity ───────────────────────────────────────────────────

    it("client: sync derived re-runs reactively when state changes", () => {
      let accessor!: (v?: number) => number | void;

      const island = ilha
        .state("count", 2)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ state, derived }) => {
          accessor = state.count as typeof accessor;
          return `<p>${derived.doubled.value}</p>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);

      expect(el.querySelector("p")!.textContent).toBe("4");

      accessor(10);
      expect(el.querySelector("p")!.textContent).toBe("20");

      accessor(0);
      expect(el.querySelector("p")!.textContent).toBe("0");

      unmount();
      cleanup(el);
    });

    it("client: async derived re-runs when tracked state changes", async () => {
      let accessor!: (v?: string) => string | void;
      const calls: string[] = [];

      const island = ilha
        .state("query", "foo")
        .derived("result", async ({ state }) => {
          const q = state.query();
          calls.push(q);
          await new Promise((r) => setTimeout(r, 5));
          return q.toUpperCase();
        })
        .render(({ state, derived }) => {
          accessor = state.query as typeof accessor;
          return derived.result.loading ? "<p>…</p>" : `<p>${derived.result.value}</p>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);

      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("FOO");

      accessor("bar");
      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("BAR");

      expect(calls).toEqual(["foo", "bar"]);

      unmount();
      cleanup(el);
    });

    it("client: sync and async derived coexist independently", async () => {
      let accessor!: (v?: number) => number | void;

      const island = ilha
        .state("n", 3)
        .derived("sync", ({ state }) => state.n() * 2)
        .derived("async", async ({ state }) => {
          const n = state.n();
          await new Promise((r) => setTimeout(r, 5));
          return n * 10;
        })
        .render(({ state, derived }) => {
          accessor = state.n as typeof accessor;
          return `<p>${derived.sync.value}:${derived.async.loading ? "…" : derived.async.value}</p>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);

      // sync is immediately 6, async still loading
      expect(el.querySelector("p")!.textContent).toBe("6:…");

      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("6:30");

      accessor(5);
      // sync updates immediately
      expect(el.querySelector("p")!.textContent).toBe("10:…");

      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("10:50");

      unmount();
      cleanup(el);
    });

    it("client: async derived.value is preserved while re-fetching (stale-while-revalidate)", async () => {
      let accessor!: (v?: string) => string | void;

      const island = ilha
        .state("query", "foo")
        .derived("result", async ({ state }) => {
          const q = state.query();
          await new Promise((r) => setTimeout(r, 5));
          return q.toUpperCase();
        })
        .render(({ state, derived }) => {
          accessor = state.query as typeof accessor;
          return derived.result.loading
            ? `<p>loading:${derived.result.value ?? "none"}</p>`
            : `<p>done:${derived.result.value}</p>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);

      expect(el.querySelector("p")!.textContent).toBe("loading:none");

      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("done:FOO");

      accessor("bar");
      await Promise.resolve();
      expect(el.querySelector("p")!.textContent).toBe("loading:FOO");

      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("done:BAR");

      unmount();
      cleanup(el);
    });

    it("client: stale async derived result is ignored after state changes", async () => {
      let accessor!: (v?: number) => number | void;

      const island = ilha
        .state("n", 1)
        .derived("data", async ({ state, signal }) => {
          const n = state.n();
          await new Promise<void>((res) => setTimeout(res, n === 1 ? 40 : 5));
          if (signal.aborted) return -1;
          return n;
        })
        .render(({ state, derived }) => {
          accessor = state.n as typeof accessor;
          return derived.data.loading ? "<p>loading</p>" : `<p>${derived.data.value}</p>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);

      await new Promise((r) => setTimeout(r, 5));
      accessor(2);

      await new Promise((r) => setTimeout(r, 20));
      expect(el.querySelector("p")!.textContent).toBe("2");

      await new Promise((r) => setTimeout(r, 30));
      expect(el.querySelector("p")!.textContent).toBe("2");

      unmount();
      cleanup(el);
    });

    // ── Client — AbortSignal ──────────────────────────────────────────────────

    it("client: AbortSignal is aborted when state changes before fetch resolves", async () => {
      let accessor!: (v?: number) => number | void;
      const aborted: boolean[] = [];

      const island = ilha
        .state("n", 0)
        .derived("data", async ({ state, signal }) => {
          const n = state.n();
          await new Promise<void>((res) => setTimeout(res, 15));
          aborted.push(signal.aborted);
          return n;
        })
        .render(({ state, derived }) => {
          accessor = state.n as typeof accessor;
          return derived.data.loading ? "<p>loading</p>" : `<p>${derived.data.value}</p>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);

      await new Promise((r) => setTimeout(r, 5));
      accessor(1);

      await new Promise((r) => setTimeout(r, 30));

      expect(aborted[0]).toBe(true);
      expect(aborted[aborted.length - 1]).toBe(false);

      unmount();
      cleanup(el);
    });

    // ── Client — unmount ──────────────────────────────────────────────────────

    it("client: unmount stops derived effects and aborts pending fetch", async () => {
      let abortedAfterUnmount = false;

      const island = ilha
        .derived("data", async ({ signal }) => {
          await new Promise<void>((res) => setTimeout(res, 30));
          abortedAfterUnmount = signal.aborted;
          return "done";
        })
        .render(({ derived }) => (derived.data.loading ? "<p>loading</p>" : "<p>done</p>"));

      const el = makeEl();
      const unmount = island.mount(el);

      await new Promise((r) => setTimeout(r, 5));
      unmount();

      await new Promise((r) => setTimeout(r, 40));
      expect(abortedAfterUnmount).toBe(true);

      cleanup(el);
    });

    it("client: unmount stops sync derived reactive effect", () => {
      let accessor!: (v?: number) => number | void;

      const island = ilha
        .state("count", 1)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ state, derived }) => {
          accessor = state.count as typeof accessor;
          return `<p>${derived.doubled.value}</p>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);

      expect(el.querySelector("p")!.textContent).toBe("2");
      unmount();

      // after unmount, state changes should not update the DOM
      accessor(99);
      expect(el.querySelector("p")!.textContent).toBe("2");

      cleanup(el);
    });

    // ── Client — multiple instances & input access ────────────────────────────

    it("client: two mounted instances have independent derived state", async () => {
      const island = ilha
        .input(z.object({ prefix: z.string().default("x") }))
        .derived("data", async ({ input }) => {
          await new Promise((r) => setTimeout(r, 5));
          return `${input.prefix}-result`;
        })
        .render(({ derived }) =>
          derived.data.loading ? "<p>loading</p>" : `<p>${derived.data.value}</p>`,
        );

      const elA = makeEl();
      const elB = makeEl();
      const unmountA = island.mount(elA, { prefix: "a" });
      const unmountB = island.mount(elB, { prefix: "b" });

      await new Promise((r) => setTimeout(r, 15));

      expect(elA.querySelector("p")!.textContent).toBe("a-result");
      expect(elB.querySelector("p")!.textContent).toBe("b-result");

      unmountA();
      unmountB();
      cleanup(elA);
      cleanup(elB);
    });

    it("client: sync derived two instances are independent", () => {
      let accA!: (v?: number) => number | void;
      let accB!: (v?: number) => number | void;

      const island = ilha
        .state("n", 1)
        .derived("sq", ({ state }) => state.n() ** 2)
        .render(({ state, derived }) => {
          accA = accB = state.n as typeof accA;
          return `<p>${derived.sq.value}</p>`;
        });

      const elA = makeEl();
      const elB = makeEl();
      const unmountA = island.mount(elA, {});
      const unmountB = island.mount(elB, {});

      // capture independent accessors per instance
      let capA!: (v?: number) => number | void;
      let capB!: (v?: number) => number | void;

      const islandA = ilha
        .state("n", 1)
        .derived("sq", ({ state }) => state.n() ** 2)
        .render(({ state, derived }) => {
          capA = state.n as typeof capA;
          return `<p>${derived.sq.value}</p>`;
        });

      const islandB = ilha
        .state("n", 1)
        .derived("sq", ({ state }) => state.n() ** 2)
        .render(({ state, derived }) => {
          capB = state.n as typeof capB;
          return `<p>${derived.sq.value}</p>`;
        });

      unmountA();
      unmountB();
      cleanup(elA);
      cleanup(elB);

      const elC = makeEl();
      const elD = makeEl();
      const unmountC = islandA.mount(elC);
      const unmountD = islandB.mount(elD);

      capA(4);
      expect(elC.querySelector("p")!.textContent).toBe("16");
      expect(elD.querySelector("p")!.textContent).toBe("1");

      capB(3);
      expect(elD.querySelector("p")!.textContent).toBe("9");
      expect(elC.querySelector("p")!.textContent).toBe("16");

      unmountC();
      unmountD();
      cleanup(elC);
      cleanup(elD);
    });

    it("client: async derived fn receives input", async () => {
      const island = ilha
        .input(z.object({ multiplier: z.number().default(3) }))
        .derived("result", async ({ input }) => {
          await new Promise((r) => setTimeout(r, 5));
          return input.multiplier * 10;
        })
        .render(({ derived }) =>
          derived.result.loading ? "<p>…</p>" : `<p>${derived.result.value}</p>`,
        );

      const el = makeEl();
      const unmount = island.mount(el, { multiplier: 4 });

      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("40");

      unmount();
      cleanup(el);
    });

    it("client: sync derived fn receives input", () => {
      const island = ilha
        .input(z.object({ multiplier: z.number().default(3) }))
        .derived("result", ({ input }) => input.multiplier * 10)
        .render(({ derived }) => `<p>${derived.result.value}</p>`);

      const el = makeEl();
      const unmount = island.mount(el, { multiplier: 4 });

      expect(el.querySelector("p")!.textContent).toBe("40");

      unmount();
      cleanup(el);
    });
  });
});
