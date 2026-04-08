import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

import { z } from "zod";

import type { SlotAccessor } from "./index";
import ilha, { html, raw, mount, from, context } from "./index";

// ---------------------------------------------
// Helpers
// ---------------------------------------------

function dedent(str: string | { value: string }): string {
  const s = typeof str === "object" ? str.value : str;
  const lines = s.split("\n").filter((l) => l.trim() !== "");
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

// ---------------------------------------------
// html`` tagged template
// ---------------------------------------------

describe("html``", () => {
  it("renders static strings", () => {
    expect(
      html`
        <p>hello</p>
      `.value,
    ).toBe("<p>hello</p>");
  });

  it("escapes interpolated strings", () => {
    const val = '<script>alert("xss")</script>';
    expect(html`<p>${val}</p>`.value).toBe(
      "<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>",
    );
  });

  it("escapes interpolated numbers", () => {
    expect(html`<p>${42}</p>`.value).toBe("<p>42</p>");
  });

  it("skips null and undefined interpolations", () => {
    expect(html`<p>${null}${undefined}</p>`.value).toBe("<p></p>");
  });

  it("passes raw() through unescaped", () => {
    expect(html`<div>${raw("<b>bold</b>")}</div>`.value).toBe("<div><b>bold</b></div>");
  });

  it("calls function interpolations and escapes result", () => {
    const fn = () => "<em>hi</em>";
    expect(html`<p>${fn}</p>`.value).toBe("<p>&lt;em&gt;hi&lt;/em&gt;</p>");
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

  it("html`` result is a RawHtml object, not a string", () => {
    const result = html`
      <p>test</p>
    `;
    expect(typeof result).toBe("object");
    expect(result.value).toBe("<p>test</p>");
  });
});

// ---------------------------------------------
// html`` — Array interpolation
// ---------------------------------------------

describe("html`` array interpolation", () => {
  it("renders an array of strings as concatenated escaped HTML", () => {
    const items = ["foo", "bar", "baz"];
    expect(html`<ul>${items}</ul>`.value).toBe("<ul>foobarbaz</ul>");
  });

  it("escapes each string element in an array", () => {
    const items = ["<b>bold</b>", "<script>xss</script>"];
    expect(html`<ul>${items}</ul>`.value).toBe(
      "<ul>&lt;b&gt;bold&lt;/b&gt;&lt;script&gt;xss&lt;/script&gt;</ul>",
    );
  });

  it("renders an array of raw() items unescaped", () => {
    const items = [raw("<li>one</li>"), raw("<li>two</li>")];
    expect(html`<ul>${items}</ul>`.value).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("renders a mixed array of strings and raw() items correctly", () => {
    const items = ["<safe>", raw("<li>raw</li>")];
    expect(html`<ul>${items}</ul>`.value).toBe("<ul>&lt;safe&gt;<li>raw</li></ul>");
  });

  it("renders an empty array as empty string", () => {
    expect(html`<ul>${[]}</ul>`.value).toBe("<ul></ul>");
  });

  it("renders an array of numbers", () => {
    const items = [1, 2, 3];
    expect(html`<p>${items}</p>`.value).toBe("<p>123</p>");
  });

  it("renders an array with null/undefined entries, skipping them", () => {
    const items = ["a", null, undefined, "b"];
    expect(html`<p>${items}</p>`.value).toBe("<p>ab</p>");
  });

  it("renders an array of html`` results directly — the canonical list rendering pattern", () => {
    const fruits = ["apple", "banana", "cherry"];
    const result = html`<ul>${fruits.map((f) => html`<li>${f}</li>`)}</ul>`;
    expect(result.value).toBe("<ul><li>apple</li><li>banana</li><li>cherry</li></ul>");
  });

  it("renders an array produced by .map() with raw() — legacy pattern still works", () => {
    const fruits = ["apple", "banana", "cherry"];
    const result = html`<ul>${fruits.map((f) => raw(`<li>${f}</li>`))}</ul>`;
    expect(result.value).toBe("<ul><li>apple</li><li>banana</li><li>cherry</li></ul>");
  });

  it("renders a mapped array of html`` with XSS-safe escaping per item", () => {
    const items = ["<script>", "safe"];
    const result = html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`;
    expect(result.value).toBe("<ul><li>&lt;script&gt;</li><li>safe</li></ul>");
  });

  it("renders nested arrays by flattening one level", () => {
    const rows = [[raw("<td>a</td>"), raw("<td>b</td>")]];
    expect(html`<tr>${rows}</tr>`.value).toBe("<tr><td>a</td><td>b</td></tr>");
  });

  it("passes array of html`` results directly into parent html`` without .join()", () => {
    const badges = ["fire", "water"].map((t) => html`<span class="badge">${t}</span>`);
    const result = html`<div>${badges}</div>`;
    expect(result.value).toBe(
      '<div><span class="badge">fire</span><span class="badge">water</span></div>',
    );
  });

  it("does NOT produce commas when array of html`` is interpolated", () => {
    const items = ["a", "b", "c"].map((x) => html`<li>${x}</li>`);
    const result = html`<ul>${items}</ul>`;
    expect(result.value).not.toContain(",");
    expect(result.value).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
  });
});

// ---------------------------------------------
// raw()
// ---------------------------------------------

describe("raw()", () => {
  it("returns object with raw symbol", () => {
    const r = raw("<b>x</b>");
    expect(typeof r).toBe("object");
    expect(r.value).toBe("<b>x</b>");
  });
});

// ---------------------------------------------
// Island — SSR
// ---------------------------------------------

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

  it("render() accepts html`` return value (RawHtml)", () => {
    const island = ilha
      .input(z.object({ name: z.string().default("world") }))
      .render(({ input }) => html`<p>hello ${input.name}</p>`);

    expect(island()).toBe("<p>hello world</p>");
  });

  it("render() with html`` and array of html`` results produces no commas", () => {
    const island = ilha
      .input(z.object({}))
      .state("items", ["a", "b", "c"])
      .render(({ state }) => html`<ul>${state.items().map((i) => html`<li>${i}</li>`)}</ul>`);

    expect(island()).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
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
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .effect(({ state }) => {
        state.count(99);
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    expect(island({ count: 3 })).toBe("<p>3</p>");
  });
});

// ---------------------------------------------
// Island — client mount
// ---------------------------------------------

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
      .on("[data-inc]@click", ({ state }) => {
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
      .on("[data-inc]@click", ({ state }) => {
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
      .on("[data-btn]@click", ({ state }) => {
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

  // ---------------------------------------------
  // .on() modifiers
  // ---------------------------------------------

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

  describe(".on combined @-syntax", () => {
    it("combined @event fires handler", () => {
      const calls: number[] = [];
      const island = ilha
        .state("count", 0)
        .on("[data-btn]@click", ({ state }) => {
          calls.push(state.count());
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn></button>`);

      const el = makeEl();
      const unmount = island.mount(el);
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      expect(calls).toEqual([0, 1]);
      expect(el.querySelector("p")!.textContent).toBe("2");
      unmount();
      cleanup(el);
    });

    it("combined @event on root element (no selector prefix)", () => {
      const calls: number[] = [];
      const island = ilha
        .state("count", 0)
        .on("@click", ({ state }) => {
          calls.push(state.count());
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);
      (el as HTMLElement).click();
      expect(calls.length).toBe(1);
      unmount();
      cleanup(el);
    });

    it("combined @event:once fires only once", () => {
      const calls: number[] = [];
      const island = ilha
        .state("count", 0)
        .on("[data-btn]@click:once", ({ state }) => {
          calls.push(state.count());
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn></button>`);

      const el = makeEl();
      const unmount = island.mount(el);
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      expect(calls.length).toBe(1);
      expect(el.querySelector("p")!.textContent).toBe("1");
      unmount();
      cleanup(el);
    });

    it("combined @event ctx.event is typed as MouseEvent for click", () => {
      ilha
        .state("x", 0)
        .on("[data-btn]@click", ({ event }) => {
          const _button: number = event.button;
          void _button;
        })
        .render(() => `<button data-btn></button>`);

      expect(true).toBe(true);
    });

    it("combined @keydown ctx.event is typed as KeyboardEvent", () => {
      ilha
        .state("key", "")
        .on("[data-input]@keydown", ({ event, state }) => {
          state.key(event.key);
        })
        .render(({ state }) => `<input data-input value="${state.key()}" />`);

      expect(true).toBe(true);
    });

    it("combined @input ctx.event is typed as Event (base)", () => {
      ilha
        .state("val", "")
        .on("[data-input]@input", ({ event }) => {
          const _target = event.target as HTMLInputElement;
          void _target;
        })
        .render(() => `<input data-input />`);

      expect(true).toBe(true);
    });

    it("combined and legacy forms coexist on the same island", () => {
      const log: string[] = [];
      const island = ilha
        .state("count", 0)
        .on("[data-a]@click", ({ state }) => {
          log.push("a");
          state.count(state.count() + 1);
        })
        .on("[data-b]@click", ({ state }) => {
          log.push("b");
          state.count(state.count() + 10);
        })
        .render(
          ({ state }) => `<p>${state.count()}</p><button data-a></button><button data-b></button>`,
        );

      const el = makeEl();
      const unmount = island.mount(el);
      (el.querySelector("[data-a]") as HTMLButtonElement).click();
      (el.querySelector("[data-b]") as HTMLButtonElement).click();
      expect(log).toEqual(["a", "b"]);
      expect(el.querySelector("p")!.textContent).toBe("11");
      unmount();
      cleanup(el);
    });

    it("combined @event SSR is a no-op (handler not called)", () => {
      const calls: number[] = [];
      const island = ilha
        .state("count", 0)
        .on("[data-btn]@click", ({ state }) => {
          calls.push(state.count());
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn></button>`);

      expect(island()).toBe("<p>0</p><button data-btn></button>");
      expect(calls.length).toBe(0);
    });
  });

  // ---------------------------------------------
  // ilha.from()
  // ---------------------------------------------

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
      const unmount = from(el, island);
      expect(el.querySelector("span")!.textContent).toBe("99");

      unmount?.();
      cleanup(el);
    });
  });

  // ---------------------------------------------
  // ilha.context()
  // ---------------------------------------------

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
      expect(a()).toBe(0);
    });
  });

  // ---------------------------------------------
  // .transition()
  // ---------------------------------------------

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

  // ---------------------------------------------
  // SSR hydration (data-ilha-state)
  // ---------------------------------------------

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

      const unmount = counter.mount(el, { count: 1 });
      expect(el.querySelector("p")!.textContent).toBe("99");

      unmount();
      cleanup(el);
    });
  });

  // ---------------------------------------------
  // .hydratable()
  // ---------------------------------------------

  describe(".hydratable()", () => {
    beforeEach(() => {
      document.body.innerHTML = "";
    });

    describe("SSR output", () => {
      it("wraps output in a container with data-ilha attribute", async () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await counter.hydratable({ count: 3 }, { name: "counter" });
        expect(result).toContain('data-ilha="counter"');
      });

      it("embeds serialised props in data-ilha-props attribute", async () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await counter.hydratable({ count: 7 }, { name: "counter" });
        expect(result).toContain("data-ilha-props=");
        const doc = new DOMParser().parseFromString(result, "text/html");
        const wrapper = doc.querySelector("[data-ilha='counter']")!;
        const props = JSON.parse(wrapper.getAttribute("data-ilha-props")!);
        expect(props.count).toBe(7);
      });

      it("renders island content inside the wrapper", async () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await counter.hydratable({ count: 5 }, { name: "counter" });
        expect(result).toContain("<p>5</p>");
      });

      it("passes provided props to the island render", async () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(42) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await counter.hydratable({ count: 42 }, { name: "counter" });
        expect(result).toContain("<p>42</p>");
        const doc = new DOMParser().parseFromString(result, "text/html");
        const props = JSON.parse(
          doc.querySelector("[data-ilha='counter']")!.getAttribute("data-ilha-props")!,
        );
        expect(props.count).toBe(42);
      });

      it("returns a Promise<string>", () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = counter.hydratable({ count: 1 }, { name: "counter" });
        expect(result).toBeInstanceOf(Promise);
      });

      it("uses the provided 'as' tag as the wrapper element", async () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await counter.hydratable({ count: 1 }, { name: "counter", as: "section" });
        expect(result).toMatch(/^<section/);
        expect(result).toMatch(/<\/section>$/);
      });

      it("defaults to a div wrapper when 'as' is not provided", async () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await counter.hydratable({ count: 1 }, { name: "counter" });
        expect(result).toMatch(/^<div/);
        expect(result).toMatch(/<\/div>$/);
      });
    });

    describe("client mount via base island", () => {
      it("reads props from data-ilha-props when none are passed to mount()", () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "counter");
        el.setAttribute("data-ilha-props", JSON.stringify({ count: 11 }));
        el.innerHTML = "<p>ssr</p>";
        document.body.appendChild(el);

        const unmount = counter.mount(el);
        expect(el.querySelector("p")!.textContent).toBe("11");
        unmount();
      });

      it("explicit props passed to mount() override data-ilha-props", () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "counter");
        el.setAttribute("data-ilha-props", JSON.stringify({ count: 1 }));
        document.body.appendChild(el);

        const unmount = counter.mount(el, { count: 99 });
        expect(el.querySelector("p")!.textContent).toBe("99");
        unmount();
      });

      it("is reactive after hydration — state changes update the DOM", () => {
        let accessor!: (v?: number) => number | void;

        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => {
            accessor = state.count as typeof accessor;
            return `<p>${state.count()}</p>`;
          });

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "counter");
        el.setAttribute("data-ilha-props", JSON.stringify({ count: 0 }));
        document.body.appendChild(el);

        const unmount = counter.mount(el);
        accessor(7);
        expect(el.querySelector("p")!.textContent).toBe("7");
        unmount();
      });

      it("unmount tears down the hydrated island", () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .on("[data-inc]@click", ({ state }) => {
            state.count(state.count() + 1);
          })
          .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "counter");
        el.setAttribute("data-ilha-props", JSON.stringify({ count: 0 }));
        document.body.appendChild(el);

        const unmount = counter.mount(el);
        unmount();

        (el.querySelector("[data-inc]") as HTMLButtonElement).click();
        expect(el.querySelector("p")!.textContent).toBe("0");
      });
    });

    describe("ilha.mount() auto-discovery", () => {
      it("discovers all [data-ilha='counter'] elements and mounts them", () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const elA = document.createElement("div");
        elA.setAttribute("data-ilha", "counter");
        elA.setAttribute("data-ilha-props", JSON.stringify({ count: 1 }));

        const elB = document.createElement("div");
        elB.setAttribute("data-ilha", "counter");
        elB.setAttribute("data-ilha-props", JSON.stringify({ count: 2 }));

        document.body.appendChild(elA);
        document.body.appendChild(elB);

        const { unmount } = mount({ counter });
        expect(elA.querySelector("p")!.textContent).toBe("1");
        expect(elB.querySelector("p")!.textContent).toBe("2");
        unmount();
      });

      it("unmount tears down all discovered instances", () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .on("[data-inc]@click", ({ state }) => {
            state.count(state.count() + 1);
          })
          .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "counter");
        el.setAttribute("data-ilha-props", JSON.stringify({ count: 0 }));
        document.body.appendChild(el);

        const { unmount } = mount({ counter });
        unmount();

        (el.querySelector("[data-inc]") as HTMLButtonElement).click();
        expect(el.querySelector("p")!.textContent).toBe("0");
      });

      it("scopes discovery to provided root element", () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const inside = document.createElement("div");
        inside.setAttribute("data-ilha", "counter");
        inside.setAttribute("data-ilha-props", JSON.stringify({ count: 1 }));

        const outside = document.createElement("div");
        outside.setAttribute("data-ilha", "counter");
        outside.setAttribute("data-ilha-props", JSON.stringify({ count: 2 }));
        outside.innerHTML = "<p>original</p>";

        const root = document.createElement("section");
        root.appendChild(inside);
        document.body.appendChild(root);
        document.body.appendChild(outside);

        const { unmount } = mount({ counter }, { root });
        expect(inside.querySelector("p")!.textContent).toBe("1");
        expect(outside.querySelector("p")!.textContent).toBe("original");
        unmount();
      });

      it("handles malformed data-ilha-props gracefully", () => {
        const counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "counter");
        el.setAttribute("data-ilha-props", "{invalid json}");
        document.body.appendChild(el);

        expect(() => mount({ counter })).not.toThrow();
      });
    });
  });
});

// ---------------------------------------------
// island.mount() returns unmount()
// ---------------------------------------------

describe("island.mount() returns unmount()", () => {
  it("mount() returns a callable function", () => {
    const island = ilha.render(() => `<p>hi</p>`);
    const el = makeEl();
    const unmount = island.mount(el);
    expect(typeof unmount).toBe("function");
    unmount();
    cleanup(el);
  });

  it("unmount() stops reactivity — DOM no longer updates after call", () => {
    let accessor!: (v?: number) => number | void;

    const island = ilha.state("count", 0).render(({ state }) => {
      accessor = state.count as typeof accessor;
      return `<p>${state.count()}</p>`;
    });

    const el = makeEl();
    const unmount = island.mount(el);
    expect(el.querySelector("p")!.textContent).toBe("0");

    unmount();

    accessor(99);
    expect(el.querySelector("p")!.textContent).toBe("0");
    cleanup(el);
  });

  it("unmount() removes event listeners so clicks are silenced", () => {
    const calls: number[] = [];

    const island = ilha
      .state("count", 0)
      .on("[data-btn]@click", ({ state }) => {
        calls.push(state.count());
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-btn>+</button>`);

    const el = makeEl();
    const unmount = island.mount(el);

    (el.querySelector("[data-btn]") as HTMLButtonElement).click();
    expect(calls.length).toBe(1);

    unmount();

    (el.querySelector("[data-btn]") as HTMLButtonElement).click();
    expect(calls.length).toBe(1);
    cleanup(el);
  });

  it("unmount() runs effect cleanup callbacks", () => {
    const log: string[] = [];

    const island = ilha
      .state("x", 0)
      .effect(({ state }) => {
        log.push(`run:${state.x()}`);
        return () => log.push(`cleanup:${state.x()}`);
      })
      .render(({ state }) => `<p>${state.x()}</p>`);

    const el = makeEl();
    const unmount = island.mount(el);
    expect(log.some((l) => l.startsWith("run:"))).toBe(true);

    unmount();
    expect(log.some((l) => l.startsWith("cleanup:"))).toBe(true);
    cleanup(el);
  });

  it("unmount() runs onMount cleanup callbacks", () => {
    const log: string[] = [];

    const island = ilha
      .onMount(() => {
        log.push("mount");
        return () => log.push("destroy");
      })
      .render(() => `<p>hi</p>`);

    const el = makeEl();
    const unmount = island.mount(el);
    expect(log).toContain("mount");

    unmount();
    expect(log).toContain("destroy");
    cleanup(el);
  });

  it("calling unmount() multiple times does not throw", () => {
    const island = ilha.render(() => `<p>hi</p>`);
    const el = makeEl();
    const unmount = island.mount(el);
    expect(() => {
      unmount();
      unmount();
    }).not.toThrow();
    cleanup(el);
  });

  it("each mount() call returns an independent unmount() — unmounting A does not affect B", () => {
    let capA!: (v?: number) => number | void;
    let capB!: (v?: number) => number | void;

    const islandA = ilha.state("count", 0).render(({ state }) => {
      capA = state.count as typeof capA;
      return `<p>${state.count()}</p>`;
    });

    const islandB = ilha.state("count", 0).render(({ state }) => {
      capB = state.count as typeof capB;
      return `<p>${state.count()}</p>`;
    });

    const elA = makeEl();
    const elB = makeEl();
    const unmountA = islandA.mount(elA);
    const unmountB = islandB.mount(elB);

    capA(10);
    capB(20);

    unmountA();

    capA(99);
    expect(elA.querySelector("p")!.textContent).toBe("10");

    capB(55);
    expect(elB.querySelector("p")!.textContent).toBe("55");

    unmountB();
    cleanup(elA);
    cleanup(elB);
  });
});

// ---------------------------------------------
// ilha.mount() auto-discovery (top-level)
// ---------------------------------------------

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
    el.setAttribute("data-ilha-props", JSON.stringify({ count: 7 }));
    document.body.appendChild(el);

    const { unmount } = mount({ counter });
    expect(el.innerHTML).toBe("<p>7</p>");
    unmount();
  });

  it("ignores unknown island names", () => {
    const el = document.createElement("div");
    el.setAttribute("data-ilha", "unknown");
    el.innerHTML = "<p>original</p>";
    document.body.appendChild(el);

    const { unmount } = mount({});
    expect(el.innerHTML).toBe("<p>original</p>");
    unmount();
  });

  it("handles malformed data-ilha-props gracefully", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = document.createElement("div");
    el.setAttribute("data-ilha", "counter");
    el.setAttribute("data-ilha-props", "{invalid json}");
    document.body.appendChild(el);

    expect(() => mount({ counter })).not.toThrow();
  });

  it("unmount tears down all discovered islands", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    const el = document.createElement("div");
    el.setAttribute("data-ilha", "counter");
    el.setAttribute("data-ilha-props", JSON.stringify({ count: 0 }));
    document.body.appendChild(el);

    const { unmount } = mount({ counter });
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
    inside.setAttribute("data-ilha-props", JSON.stringify({ count: 1 }));

    const outside = document.createElement("div");
    outside.setAttribute("data-ilha", "counter");
    outside.setAttribute("data-ilha-props", JSON.stringify({ count: 2 }));
    outside.innerHTML = "<p>original</p>";

    const root = document.createElement("section");
    root.appendChild(inside);
    document.body.appendChild(root);
    document.body.appendChild(outside);

    const { unmount } = mount({ counter }, { root });
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
    elA.setAttribute("data-ilha-props", JSON.stringify({ count: 3 }));

    const elB = document.createElement("div");
    elB.setAttribute("data-ilha", "greeting");
    elB.setAttribute("data-ilha-props", JSON.stringify({ name: "Ada" }));

    document.body.appendChild(elA);
    document.body.appendChild(elB);

    const { unmount } = mount({ counter, greeting });
    expect(elA.innerHTML).toBe("<span>3</span>");
    expect(elB.innerHTML).toBe("<b>hello Ada</b>");
    unmount();
  });
});

// ---------------------------------------------
// Slots
// ---------------------------------------------

describe("slots", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("SSR renders child island inline via children proxy", () => {
    const badge = ilha
      .state("label", "hello")
      .render(({ state }) => `<span>${state.label()}</span>`);

    const card = ilha.slot("badge", badge).render(({ slots }) => `<div>${slots.badge}</div>`);

    expect(card()).toBe("<div><span>hello</span></div>");
  });

  it("SSR child renders with its own schema defaults", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(99) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const parent = ilha
      .slot("counter", counter)
      .render(({ slots }) => `<section>${slots.counter}</section>`);

    expect(parent()).toBe("<section><p>99</p></section>");
  });

  it("SSR slot renders with passed props", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const parent = ilha
      .slot("counter", counter)
      .render(({ slots }) => html`<div>${slots.counter({ count: 5 })}</div>`);

    expect(parent()).toBe("<div><p>5</p></div>");
  });

  it("client slot element is present in DOM after mount", () => {
    const child = ilha.render(() => `<span>child</span>`);

    const parent = ilha.slot("child", child).render(({ slots }) => `<div>${slots.child}</div>`);

    const el = makeEl();
    const unmount = parent.mount(el);
    expect(el.querySelector("[data-ilha-slot='child']")).not.toBeNull();
    expect(el.querySelector("[data-ilha-slot='child']")!.innerHTML).toBe("<span>child</span>");
    unmount();
    cleanup(el);
  });

  it("client child island is interactive independently", () => {
    const child = ilha
      .state("count", 0)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    const parent = ilha
      .slot("child", child)
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

  it("client parent re-render does not destroy child slot", () => {
    const child = ilha
      .state("count", 0)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    let parentAccessor!: (v?: number) => number | void;

    const parent = ilha
      .state("tick", 0)
      .slot("child", child)
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

  it("client multiple slots are independently preserved on parent re-render", () => {
    const childA = ilha.state("val", "A").render(({ state }) => `<i>${state.val()}</i>`);
    const childB = ilha.state("val", "B").render(({ state }) => `<b>${state.val()}</b>`);

    let parentAccessor!: (v?: number) => number | void;

    const parent = ilha
      .state("tick", 0)
      .slot("a", childA)
      .slot("b", childB)
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

  it("client parent unmount cascades to child slots", () => {
    const childCalls: string[] = [];

    const child = ilha
      .state("x", 0)
      .effect(({ state }) => {
        childCalls.push(`run:${state.x()}`);
        return () => childCalls.push(`cleanup:${state.x()}`);
      })
      .render(({ state }) => `<span>${state.x()}</span>`);

    const parent = ilha.slot("child", child).render(({ slots }) => `<div>${slots.child}</div>`);

    const el = makeEl();
    const unmount = parent.mount(el);
    expect(childCalls).toContain("run:0");
    unmount();
    expect(childCalls.some((l) => l.startsWith("cleanup:"))).toBe(true);
    cleanup(el);
  });

  it("client unknown slot name in slots proxy renders empty string", () => {
    const parent = ilha.render(
      ({ slots }) => html`<div>${(slots as Record<string, SlotAccessor>)["nonexistent"]}</div>`,
    );

    const el = makeEl();
    const unmount = parent.mount(el);
    expect(el.innerHTML).toBe("<div></div>");
    unmount();
    cleanup(el);
  });

  it("client slot receives props via slots.x(props)", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const parent = ilha
      .slot("counter", counter)
      .render(({ slots }) => html`<div>${slots.counter({ count: 7 })}</div>`);

    const el = makeEl();
    const unmount = parent.mount(el);
    expect(el.querySelector("p")!.textContent).toBe("7");
    unmount();
    cleanup(el);
  });

  it("client slot receives props via data-props attribute", () => {
    const counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const parent = ilha
      .slot("counter", counter)
      .render(() => `<div><div data-ilha-slot="counter" data-props='{"count":3}'></div></div>`);

    const el = makeEl();
    const unmount = parent.mount(el);
    expect(el.querySelector("p")!.textContent).toBe("3");
    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------
// .derived
// ---------------------------------------------

describe(".derived", () => {
  describe("SSR async", () => {
    it("SSR async derived is always loading:true during SSR", async () => {
      const island = ilha
        .derived("data", async () => "resolved")
        .render(({ derived }) =>
          derived.data.loading ? `<p>loading</p>` : `<p>${derived.data.value}</p>`,
        );

      expect(await island()).toBe("<p>resolved</p>");
    });

    it("SSR async derived.value and derived.error are undefined during SSR", async () => {
      const island = ilha
        .derived("data", async () => 42)
        .render(({ derived }) => {
          const d = derived.data;
          return `${d.loading}${d.value}${d.error}`;
        });

      expect(await island()).toBe("false42undefined");
    });

    it("SSR multiple async derived keys all start as loading", async () => {
      const island = ilha
        .derived("a", async () => 1)
        .derived("b", async () => 2)
        .render(({ derived }) => `${derived.a.loading}${derived.b.loading}`);

      expect(await island()).toBe("falsefalse");
    });
  });

  describe("SSR sync", () => {
    it("SSR sync derived resolves immediately during SSR", () => {
      const island = ilha
        .state("count", 5)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ derived }) =>
          derived.doubled.loading ? `<p>loading</p>` : `<p>${derived.doubled.value}</p>`,
        );

      expect(island()).toBe("<p>10</p>");
    });

    it("SSR sync derived has loading:false and correct value", () => {
      const island = ilha
        .state("name", "ada")
        .derived("upper", ({ state }) => state.name().toUpperCase())
        .render(({ derived }) => {
          const d = derived.upper;
          return `${d.loading}${d.value}${d.error}`;
        });

      expect(island()).toBe("falseADAundefined");
    });

    it("SSR sync derived receives input", () => {
      const island = ilha
        .input(z.object({ multiplier: z.number().default(3) }))
        .derived("result", ({ input }) => input.multiplier * 10)
        .render(({ derived }) => `<p>${derived.result.value}</p>`);

      expect(island({ multiplier: 4 })).toBe("<p>40</p>");
    });

    it("SSR mixed sync and async derived: sync resolves, async is loading", async () => {
      const island = ilha
        .state("count", 3)
        .derived("sync", ({ state }) => state.count() * 2)
        .derived("async", async ({ state }) => state.count() * 3)
        .render(
          ({ derived }) =>
            `${derived.sync.loading}${derived.sync.value}${derived.async.loading}${derived.async.value}`,
        );

      expect(await island()).toBe("false6false9");
    });

    it("SSR island returns a Promise when async derived is present", () => {
      const island = ilha
        .derived("data", async () => 42)
        .render(({ derived }) => `<p>${derived.data.value}</p>`);

      const result = island();
      expect(result).toBeInstanceOf(Promise);
    });

    it("SSR island returns a string when all derived are sync", () => {
      const island = ilha
        .state("count", 2)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ derived }) => `<p>${derived.doubled.value}</p>`);

      const result = island();
      expect(typeof result).toBe("string");
      expect(result).toBe("<p>4</p>");
    });

    it("SSR toString keeps async derived in loading state", () => {
      const island = ilha
        .derived("data", async () => 42)
        .render(({ derived }) =>
          derived.data.loading ? `<p>loading</p>` : `<p>${derived.data.value}</p>`,
        );

      expect(island.toString()).toBe("<p>loading</p>");
    });

    it("SSR template interpolation uses toString fallback for async derived", () => {
      const island = ilha
        .derived("data", async () => "resolved")
        .render(({ derived }) =>
          derived.data.loading ? `<p>loading</p>` : `<p>${derived.data.value}</p>`,
        );

      expect(`<div>${island}</div>`).toBe("<div><p>loading</p></div>");
    });

    it("SSR awaited async derived rejection populates error envelope", async () => {
      const island = ilha
        .derived("data", async () => {
          throw new Error("boom");
        })
        .render(({ derived }) => {
          if (derived.data.loading) return `<p>loading</p>`;
          if (derived.data.error) return `<p>error:${derived.data.error.message}</p>`;
          return `<p>${derived.data.value}</p>`;
        });

      expect(await island()).toBe("<p>error:boom</p>");
    });

    it("SSR awaited async non-Error throw is wrapped in Error", async () => {
      const island = ilha
        .derived("data", async () => {
          throw "bad";
        })
        .render(({ derived }) => {
          if (derived.data.loading) return `<p>loading</p>`;
          return `<p>${derived.data.error instanceof Error}</p>`;
        });

      expect(await island()).toBe("<p>true</p>");
    });

    it("SSR toString resolves sync derived but keeps async derived loading", () => {
      const island = ilha
        .state("count", 3)
        .derived("sync", ({ state }) => state.count() * 2)
        .derived("async", async ({ state }) => state.count() * 3)
        .render(
          ({ derived }) =>
            `${derived.sync.loading}${derived.sync.value}${derived.async.loading}${derived.async.value}`,
        );

      expect(island.toString()).toBe("false6trueundefined");
    });
  });

  describe("Client basic resolve", () => {
    it("client async derived resolves and triggers re-render", async () => {
      const island = ilha
        .derived("msg", async () => {
          await new Promise((r) => setTimeout(r, 5));
          return "hello";
        })
        .render(({ derived }) =>
          derived.msg.loading ? `<p>loading</p>` : `<p>${derived.msg.value}</p>`,
        );

      const el = makeEl();
      const unmount = island.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("loading");
      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("hello");
      unmount();
      cleanup(el);
    });

    it("client sync derived is immediately available on mount", () => {
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

    it("client sync derived never has loading:true", () => {
      const island = ilha
        .state("x", 3)
        .derived("sq", ({ state }) => state.x() ** 2)
        .render(({ derived }) => `<p>${derived.sq.loading}${derived.sq.value}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("false9");
      unmount();
      cleanup(el);
    });

    it("client async derived captures error and sets error envelope", async () => {
      const island = ilha
        .derived("data", async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error("boom");
        })
        .render(({ derived }) => {
          if (derived.data.loading) return `<p>loading</p>`;
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

    it("client non-Error throws are wrapped in Error", async () => {
      const island = ilha
        .derived("data", async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw "string error";
        })
        .render(({ derived }) => {
          if (derived.data.loading) return `<p>loading</p>`;
          if (derived.data.error) return `<p>${derived.data.error instanceof Error}</p>`;
          return `<p>ok</p>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);
      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("true");
      unmount();
      cleanup(el);
    });
  });

  describe("Client reactivity", () => {
    it("client sync derived re-runs reactively when state changes", () => {
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

    it("client async derived re-runs when tracked state changes", async () => {
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
          return derived.result.loading ? `<p></p>` : `<p>${derived.result.value}</p>`;
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

    it("client sync and async derived coexist independently", async () => {
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
          return `<p>${derived.sync.value}${derived.async.loading ? "" : derived.async.value}</p>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("6");
      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("630");
      accessor(5);
      expect(el.querySelector("p")!.textContent).toBe("10");
      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("1050");
      unmount();
      cleanup(el);
    });

    it("client async derived.value is preserved while re-fetching (stale-while-revalidate)", async () => {
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

    it("client stale async derived result is ignored after state changes", async () => {
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
          return derived.data.loading ? `<p>loading</p>` : `<p>${derived.data.value}</p>`;
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
  });

  describe("Client AbortSignal", () => {
    it("client AbortSignal is aborted when state changes before fetch resolves", async () => {
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
          return derived.data.loading ? `<p>loading</p>` : `<p>${derived.data.value}</p>`;
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
  });

  describe("Client unmount", () => {
    it("client unmount stops derived effects and aborts pending fetch", async () => {
      let abortedAfterUnmount = false;

      const island = ilha
        .derived("data", async ({ signal }) => {
          await new Promise<void>((res) => setTimeout(res, 30));
          abortedAfterUnmount = signal.aborted;
          return "done";
        })
        .render(({ derived }) => (derived.data.loading ? `<p>loading</p>` : `<p>done</p>`));

      const el = makeEl();
      const unmount = island.mount(el);
      await new Promise((r) => setTimeout(r, 5));
      unmount();
      await new Promise((r) => setTimeout(r, 40));
      expect(abortedAfterUnmount).toBe(true);
      cleanup(el);
    });

    it("client unmount stops sync derived reactive effect", () => {
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
      accessor(99);
      expect(el.querySelector("p")!.textContent).toBe("2");
      cleanup(el);
    });
  });

  describe("Client multiple instances / input access", () => {
    it("client two mounted instances have independent derived state", async () => {
      const island = ilha
        .input(z.object({ prefix: z.string().default("x") }))
        .derived("data", async ({ input }) => {
          await new Promise((r) => setTimeout(r, 5));
          return `${input.prefix}-result`;
        })
        .render(({ derived }) =>
          derived.data.loading ? `<p>loading</p>` : `<p>${derived.data.value}</p>`,
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

    it("client sync derived two instances are independent", () => {
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

    it("client async derived fn receives input", async () => {
      const island = ilha
        .input(z.object({ multiplier: z.number().default(3) }))
        .derived("result", async ({ input }) => {
          await new Promise((r) => setTimeout(r, 5));
          return input.multiplier * 10;
        })
        .render(({ derived }) =>
          derived.result.loading ? `<p></p>` : `<p>${derived.result.value}</p>`,
        );

      const el = makeEl();
      const unmount = island.mount(el, { multiplier: 4 });
      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("40");
      unmount();
      cleanup(el);
    });

    it("client sync derived fn receives input", () => {
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

// ---------------------------------------------
// .bind
// ---------------------------------------------

describe(".bind", () => {
  describe("SSR", () => {
    it("SSR .bind is a no-op — island renders normally", () => {
      const island = ilha
        .state("email", "default@example.com")
        .bind("[data-email]", "email")
        .render(({ state }) => `<input data-email value="${state.email()}">`);

      expect(island()).toBe(`<input data-email value="default@example.com">`);
    });
  });

  describe("DOM -> state", () => {
    it("client text input change updates state", () => {
      const island = ilha
        .state("name", "ada")
        .bind("[data-name]", "name")
        .render(({ state }) => `<input data-name value="${state.name()}"><p>${state.name()}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);
      el.querySelector<HTMLInputElement>("[data-name]")!.value = "grace";
      el.querySelector<HTMLInputElement>("[data-name]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("grace");
      unmount();
      cleanup(el);
    });

    it("client checkbox change updates boolean state", () => {
      const island = ilha
        .state("checked", false)
        .bind("[data-cb]", "checked")
        .render(
          ({ state }) =>
            `<input type="checkbox" data-cb ${state.checked() ? "checked" : ""}><p>${state.checked()}</p>`,
        );

      const el = makeEl();
      const unmount = island.mount(el);
      el.querySelector<HTMLInputElement>("[data-cb]")!.checked = true;
      el.querySelector<HTMLInputElement>("[data-cb]")!.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toBe("true");
      unmount();
      cleanup(el);
    });

    it("client select change updates state", () => {
      const island = ilha
        .state("size", "m")
        .bind("[data-size]", "size")
        .render(
          ({ state }) =>
            `<select data-size><option value="s">S</option><option value="m">M</option><option value="l">L</option></select><p>${state.size()}</p>`,
        );

      const el = makeEl();
      const unmount = island.mount(el);
      el.querySelector<HTMLSelectElement>("[data-size]")!.value = "l";
      el.querySelector<HTMLSelectElement>("[data-size]")!.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toBe("l");
      unmount();
      cleanup(el);
    });

    it("client number input updates numeric state", () => {
      const island = ilha
        .state("count", 0)
        .bind("[data-num]", "count")
        .render(({ state }) => `<input type="number" data-num><p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);
      el.querySelector<HTMLInputElement>("[data-num]")!.value = "42";
      el.querySelector<HTMLInputElement>("[data-num]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("42");
      unmount();
      cleanup(el);
    });
  });

  describe("state -> DOM", () => {
    it("client initial state is synced to input value on mount", () => {
      const island = ilha
        .state("email", "hello@example.com")
        .bind("[data-email]", "email")
        .render(({ state }) => `<input data-email value="${state.email()}">`);

      const el = makeEl();
      const unmount = island.mount(el);
      expect(el.querySelector<HTMLInputElement>("[data-email]")!.value).toBe("hello@example.com");
      unmount();
      cleanup(el);
    });

    it("client programmatic state change updates input value", () => {
      let accessor!: (v?: string) => string | void;

      const island = ilha
        .state("email", "a@b.com")
        .bind("[data-email]", "email")
        .render(({ state }) => {
          accessor = state.email as typeof accessor;
          return `<input data-email value="${state.email()}">`;
        });

      const el = makeEl();
      const unmount = island.mount(el);
      accessor("new@example.com");
      expect(el.querySelector<HTMLInputElement>("[data-email]")!.value).toBe("new@example.com");
      unmount();
      cleanup(el);
    });

    it("client programmatic state change updates checkbox checked", () => {
      let accessor!: (v?: boolean) => boolean | void;

      const island = ilha
        .state("active", false)
        .bind("[data-cb]", "active")
        .render(({ state }) => {
          accessor = state.active as typeof accessor;
          return `<input type="checkbox" data-cb ${state.active() ? "checked" : ""}>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);
      expect(el.querySelector<HTMLInputElement>("[data-cb]")!.checked).toBe(false);
      accessor(true);
      expect(el.querySelector<HTMLInputElement>("[data-cb]")!.checked).toBe(true);
      accessor(false);
      expect(el.querySelector<HTMLInputElement>("[data-cb]")!.checked).toBe(false);
      unmount();
      cleanup(el);
    });
  });

  describe("Two-way", () => {
    it("client two-way DOM change reflects in render output", () => {
      const island = ilha
        .state("query", "")
        .bind("[data-q]", "query")
        .render(({ state }) => `<input data-q><p>${state.query()}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);
      el.querySelector<HTMLInputElement>("[data-q]")!.value = "svelte";
      el.querySelector<HTMLInputElement>("[data-q]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("svelte");
      el.querySelector<HTMLInputElement>("[data-q]")!.value = "ilha";
      el.querySelector<HTMLInputElement>("[data-q]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("ilha");
      unmount();
      cleanup(el);
    });
  });

  describe("transform", () => {
    it("client transform coerces DOM string to number", () => {
      const island = ilha
        .state("age", 0)
        .bind("[data-age]", "age")
        .render(({ state }) => `<input type="text" data-age><p>${state.age()}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);
      el.querySelector<HTMLInputElement>("[data-age]")!.value = "25";
      el.querySelector<HTMLInputElement>("[data-age]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("25");
      el.querySelector<HTMLInputElement>("[data-age]")!.value = "99";
      el.querySelector<HTMLInputElement>("[data-age]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("99");
      unmount();
      cleanup(el);
    });
  });

  describe("Cleanup", () => {
    it("client unmount removes bind listeners — DOM changes no longer update state", () => {
      const island = ilha
        .state("val", "initial")
        .bind("[data-val]", "val")
        .render(({ state }) => `<input data-val value="${state.val()}"><p>${state.val()}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);
      el.querySelector<HTMLInputElement>("[data-val]")!.value = "changed";
      el.querySelector<HTMLInputElement>("[data-val]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("changed");
      unmount();
      el.querySelector<HTMLInputElement>("[data-val]")!.value = "after-unmount";
      el.querySelector<HTMLInputElement>("[data-val]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("changed");
      cleanup(el);
    });
  });

  describe("Re-render survival", () => {
    it("client bind survives parent re-render triggered by other state", () => {
      let tickAccessor!: (v?: number) => number | void;

      const island = ilha
        .state("tick", 0)
        .state("email", "a@b.com")
        .bind("[data-email]", "email")
        .on("[data-inc]@click", ({ state }) => {
          state.tick(state.tick() + 1);
        })
        .render(({ state }) => {
          tickAccessor = state.tick as typeof tickAccessor;
          return `<p>${state.tick()}</p><input data-email value="${state.email()}"><button data-inc></button>`;
        });

      const el = makeEl();
      const unmount = island.mount(el);
      tickAccessor(1);
      expect(el.querySelector("p")!.textContent).toBe("1");
      el.querySelector<HTMLInputElement>("[data-email]")!.value = "new@example.com";
      el.querySelector<HTMLInputElement>("[data-email]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector<HTMLInputElement>("[data-email]")!.value).toBe("new@example.com");
      unmount();
      cleanup(el);
    });
  });

  describe("Multiple binds", () => {
    it("client multiple .bind calls work independently", () => {
      const island = ilha
        .state("first", "")
        .state("last", "")
        .bind("[data-first]", "first")
        .bind("[data-last]", "last")
        .render(
          ({ state }) =>
            `<input data-first><input data-last><p>${state.first()} ${state.last()}</p>`,
        );

      const el = makeEl();
      const unmount = island.mount(el);
      el.querySelector<HTMLInputElement>("[data-first]")!.value = "Ada";
      el.querySelector<HTMLInputElement>("[data-first]")!.dispatchEvent(new Event("input"));
      el.querySelector<HTMLInputElement>("[data-last]")!.value = "Lovelace";
      el.querySelector<HTMLInputElement>("[data-last]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("Ada Lovelace");
      unmount();
      cleanup(el);
    });
  });

  describe("Radio groups", () => {
    it("client radio group change updates string state", () => {
      const island = ilha
        .state("plan", "pro")
        .bind("[name='plan']", "plan")
        .render(
          ({ state }) =>
            html`
            <input type="radio" name="plan" value="free" ${state.plan() === "free" ? "checked" : ""}>
            <input type="radio" name="plan" value="pro" ${state.plan() === "pro" ? "checked" : ""}>
            <p>${state.plan()}</p>
          `,
        );

      const el = makeEl();
      const unmount = island.mount(el);
      const free = el.querySelector<HTMLInputElement>("input[name='plan'][value='free']")!;
      free.checked = true;
      free.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toBe("free");
      unmount();
      cleanup(el);
    });

    it("client programmatic radio state change updates checked input", () => {
      let accessor!: (v?: string) => string | void;

      const island = ilha
        .state("plan", "free")
        .bind("[name='plan']", "plan")
        .render(({ state }) => {
          accessor = state.plan as typeof accessor;
          return html`
            <input type="radio" name="plan" value="free" ${state.plan() === "free" ? "checked" : ""}>
            <input type="radio" name="plan" value="pro" ${state.plan() === "pro" ? "checked" : ""}>
          `;
        });

      const el = makeEl();
      const unmount = island.mount(el);
      accessor("pro");
      expect(el.querySelector<HTMLInputElement>("input[name='plan'][value='free']")!.checked).toBe(
        false,
      );
      expect(el.querySelector<HTMLInputElement>("input[name='plan'][value='pro']")!.checked).toBe(
        true,
      );
      unmount();
      cleanup(el);
    });

    it("client radio group coerces DOM string to number from state type", () => {
      const island = ilha
        .state("level", 2)
        .bind("[name='level']", "level")
        .render(
          ({ state }) =>
            html`
            <input type="radio" name="level" value="1" ${state.level() === 1 ? "checked" : ""}>
            <input type="radio" name="level" value="2" ${state.level() === 2 ? "checked" : ""}>
            <input type="radio" name="level" value="3" ${state.level() === 3 ? "checked" : ""}>
            <p>${state.level()}</p>
          `,
        );

      const el = makeEl();
      const unmount = island.mount(el);
      const three = el.querySelector<HTMLInputElement>("input[name='level'][value='3']")!;
      three.checked = true;
      three.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toBe("3");
      unmount();
      cleanup(el);
    });
  });
});

// ---------------------------------------------
// .onMount
// ---------------------------------------------

describe(".onMount", () => {
  it("runs the callback once on mount", () => {
    const calls: number[] = [];

    const island = ilha
      .state("count", 0)
      .onMount(() => {
        calls.push(1);
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = island.mount(el);
    expect(calls).toEqual([1]);
    unmount();
    cleanup(el);
  });

  it("does NOT run the callback more than once even when state changes", () => {
    const calls: number[] = [];
    let accessor!: (v: number) => void;

    const island = ilha
      .state("count", 0)
      .onMount(({ state }) => {
        accessor = state.count as typeof accessor;
        calls.push(state.count());
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = island.mount(el);
    accessor(1);
    accessor(2);
    accessor(3);
    expect(calls).toEqual([0]);
    unmount();
    cleanup(el);
  });

  it("receives correct ctx.host, ctx.state, and ctx.input", () => {
    let capturedHost: Element | null = null;
    let capturedCount: number | null = null;
    let capturedLabel: string | null = null;

    const island = ilha
      .input(z.object({ label: z.string().default("hi") }))
      .derived("labelLen", ({ input }) => input.label.length)
      .onMount(({ host, derived, input }) => {
        capturedHost = host;
        capturedCount = derived.labelLen.value ?? null;
        capturedLabel = input.label;
      })
      .render(({ derived }) => `<p>${derived.labelLen.value}</p>`);

    const el = makeEl();
    const unmount = island.mount(el, { label: "hello" });
    expect(capturedHost!).toBe(el);
    expect(capturedCount!).toBe(5);
    expect(capturedLabel!).toBe("hello");
    unmount();
    cleanup(el);
  });

  it("runs the cleanup returned from onMount on unmount", () => {
    const log: string[] = [];

    const island = ilha
      .onMount(() => {
        log.push("mount");
        return () => log.push("destroy");
      })
      .render(() => `<p>hi</p>`);

    const el = makeEl();
    const unmount = island.mount(el);
    expect(log).toEqual(["mount"]);
    unmount();
    expect(log).toEqual(["mount", "destroy"]);
    cleanup(el);
  });

  it("does NOT run the cleanup on each re-render, only on unmount", () => {
    const log: string[] = [];
    let accessor!: (v: number) => void;

    const island = ilha
      .state("count", 0)
      .onMount(({ state }) => {
        accessor = state.count as typeof accessor;
        return () => log.push("destroy");
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = island.mount(el);
    accessor(1);
    accessor(2);
    expect(log).toEqual([]);
    unmount();
    expect(log).toEqual(["destroy"]);
    cleanup(el);
  });

  it("does not subscribe to state reads inside onMount (no reactive tracking)", () => {
    const renders: number[] = [];
    let accessor!: (v: number) => void;

    const island = ilha
      .state("count", 0)
      .onMount(({ state }) => {
        void state.count();
      })
      .render(({ state }) => {
        accessor = state.count as typeof accessor;
        renders.push(state.count());
        return `<p>${state.count()}</p>`;
      });

    const el = makeEl();
    const unmount = island.mount(el);
    const initialRenders = renders.length;
    accessor(99);
    expect(renders.length).toBe(initialRenders + 1);
    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------
// dev-mode warnings
// ---------------------------------------------

describe("dev-mode warnings", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("from() selector not found", () => {
    it("warns when selector matches no element", () => {
      const island = ilha.render(() => `<p>hi</p>`);
      from("#definitely-does-not-exist", island);
      expect(warnSpy).toHaveBeenCalled();
      const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
      expect(msg).toMatch(/ilha/i);
    });

    it("warn message includes the missing selector", () => {
      const island = ilha.render(() => `<p>hi</p>`);
      from("#my-missing-el", island);
      const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
      expect(msg).toContain("#my-missing-el");
    });
  });

  describe("malformed data-ilha-props", () => {
    beforeEach(() => {
      document.body.innerHTML = "";
    });

    it("warns when data-ilha-props contains invalid JSON", () => {
      const counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = document.createElement("div");
      el.setAttribute("data-ilha", "counter");
      el.setAttribute("data-ilha-props", "{not valid json}");
      document.body.appendChild(el);

      mount({ counter });
      expect(warnSpy).toHaveBeenCalled();
      const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
      expect(msg).toMatch(/ilha/i);
    });
  });

  describe(".on() selector matches nothing on mount", () => {
    it("warns when an .on() selector does not match any element", () => {
      const island = ilha
        .state("count", 0)
        .on("[data-nonexistent-btn]@click", ({ state }) => {
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = island.mount(el);
      expect(warnSpy).toHaveBeenCalled();
      const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
      expect(msg).toMatch(/ilha/i);
      unmount();
      cleanup(el);
    });

    it("does NOT warn when an .on() selector matches at least one element", () => {
      const island = ilha
        .state("count", 0)
        .on("[data-inc]@click", ({ state }) => {
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

      const el = makeEl();
      const unmount = island.mount(el);
      expect(warnSpy).not.toHaveBeenCalled();
      unmount();
      cleanup(el);
    });
  });

  describe("validation failure error message", () => {
    it("throws with [ilha] prefix on invalid input props", () => {
      const island = ilha
        .input(z.object({ count: z.number() }))
        .render(({ input }) => `${input.count}`);

      expect(() => island({ count: "bad" as never })).toThrow("[ilha]");
    });
  });
});
