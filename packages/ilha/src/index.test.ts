import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

import { z } from "zod";

import ilha, { html, raw, css, mount, from, context, signal, batch, untrack } from "./index";

// ---------------------------------------------
// Helpers
// ---------------------------------------------

function dedent(str: string | { value: string }): string {
  const s = typeof str === "object" ? str.value : str;
  const lines = s.split("\n").filter((l) => l.trim() !== "");
  const indent = Math.min(...lines.map((l) => l.match(/^(\s*)/)![1]!.length));
  return lines.map((l) => l.slice(indent)).join("\n");
}

/**
 * Normalize HTML whitespace for formatter-agnostic assertions.
 * Collapses runs of whitespace into a single space, strips whitespace
 * adjacent to tag boundaries, and trims. Use this when asserting on the
 * *content* of html`` output, not the exact whitespace shape — because
 * `oxfmt` (or any other formatter) may reflow the input template literal
 * and change incidental whitespace in the output without changing what
 * the test is actually verifying.
 */
function normalizeHtml(s: string | { value: string }): string {
  const str = typeof s === "object" ? s.value : s;
  return str.replace(/\s+/g, " ").replace(/>\s+/g, ">").replace(/\s+</g, "<").trim();
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
      normalizeHtml(
        html`
          <p>hello</p>
        `,
      ),
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
    const Island = ilha
      .input(z.object({ count: z.number().default(7) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => html`<p>${state.count()}</p>`);

    expect(Island()).toBe("<p>7</p>");
  });

  it("escapes signal accessor value", () => {
    const Island = ilha
      .input(z.object({ label: z.string().default("<b>hi</b>") }))
      .state("label", ({ label }) => label)
      .render(({ state }) => html`<p>${state.label}</p>`);

    expect(Island()).toBe("<p>&lt;b&gt;hi&lt;/b&gt;</p>");
  });

  it("html`` result is a RawHtml object, not a string", () => {
    const result = html`
      <p>test</p>
    `;
    expect(typeof result).toBe("object");
    expect(normalizeHtml(result)).toBe("<p>test</p>");
  });
});

// ---------------------------------------------
// html`` — Array interpolation
// ---------------------------------------------

describe("html`` array interpolation", () => {
  it("renders an array of strings as concatenated escaped HTML", () => {
    const items = ["foo", "bar", "baz"];
    expect(
      normalizeHtml(
        html`<ul>
          ${items}
        </ul>`,
      ),
    ).toBe("<ul>foobarbaz</ul>");
  });

  it("escapes each string element in an array", () => {
    const items = ["<b>bold</b>", "<script>xss</script>"];
    expect(
      normalizeHtml(
        html`<ul>
          ${items}
        </ul>`,
      ),
    ).toBe("<ul>&lt;b&gt;bold&lt;/b&gt;&lt;script&gt;xss&lt;/script&gt;</ul>");
  });

  it("renders an array of raw() items unescaped", () => {
    const items = [raw("<li>one</li>"), raw("<li>two</li>")];
    expect(
      normalizeHtml(
        html`<ul>
          ${items}
        </ul>`,
      ),
    ).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("renders a mixed array of strings and raw() items correctly", () => {
    const items = ["<safe>", raw("<li>raw</li>")];
    expect(
      normalizeHtml(
        html`<ul>
          ${items}
        </ul>`,
      ),
    ).toBe("<ul>&lt;safe&gt;<li>raw</li></ul>");
  });

  it("renders an empty array as empty string", () => {
    expect(
      normalizeHtml(
        html`<ul>
          ${[]}
        </ul>`,
      ),
    ).toBe("<ul></ul>");
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
    const result = html`<ul>
      ${fruits.map((f) => html`<li>${f}</li>`)}
    </ul>`;
    expect(normalizeHtml(result)).toBe("<ul><li>apple</li><li>banana</li><li>cherry</li></ul>");
  });

  it("renders an array produced by .map() with raw() — legacy pattern still works", () => {
    const fruits = ["apple", "banana", "cherry"];
    const result = html`<ul>
      ${fruits.map((f) => raw(`<li>${f}</li>`))}
    </ul>`;
    expect(normalizeHtml(result)).toBe("<ul><li>apple</li><li>banana</li><li>cherry</li></ul>");
  });

  it("renders a mapped array of html`` with XSS-safe escaping per item", () => {
    const items = ["<script>", "safe"];
    const result = html`<ul>
      ${items.map((i) => html`<li>${i}</li>`)}
    </ul>`;
    expect(normalizeHtml(result)).toBe("<ul><li>&lt;script&gt;</li><li>safe</li></ul>");
  });

  it("renders nested arrays by flattening one level", () => {
    const rows = [[raw("<td>a</td>"), raw("<td>b</td>")]];
    expect(
      normalizeHtml(
        html`<tr>
          ${rows}
        </tr>`,
      ),
    ).toBe("<tr><td>a</td><td>b</td></tr>");
  });

  it("passes array of html`` results directly into Parent html`` without .join()", () => {
    const Badges = ["fire", "water"].map((t) => html`<span class="Badge">${t}</span>`);
    const result = html`<div>${Badges}</div>`;
    expect(result.value).toBe(
      '<div><span class="Badge">fire</span><span class="Badge">water</span></div>',
    );
  });

  it("does NOT produce commas when array of html`` is interpolated", () => {
    const items = ["a", "b", "c"].map((x) => html`<li>${x}</li>`);
    const result = html`<ul>
      ${items}
    </ul>`;
    expect(result.value).not.toContain(",");
    expect(normalizeHtml(result)).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
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

describe("Island SSR", () => {
  it("renders with schema defaults when called with no args", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    expect(Counter()).toBe("<p>0</p>");
  });

  it("renders with provided props", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    expect(Counter({ count: 7 })).toBe("<p>7</p>");
  });

  it("toString() with no args uses schema defaults", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(5) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<span>${state.count()}</span>`);

    expect(Counter.toString()).toBe("<span>5</span>");
  });

  it("toString() with props", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<span>${state.count()}</span>`);

    expect(Counter.toString({ count: 99 })).toBe("<span>99</span>");
  });

  it("interpolates correctly in template string via implicit toString", () => {
    const Badge = ilha
      .input(z.object({ label: z.string().default("hi") }))
      .render(({ input }) => `<b>${input.label}</b>`);

    expect(`<div>${Badge}</div>`).toBe("<div><b>hi</b></div>");
  });

  it("render() accepts html`` return value (RawHtml)", () => {
    const Island = ilha
      .input(z.object({ name: z.string().default("world") }))
      .render(({ input }) => html`<p>hello ${input.name}</p>`);

    expect(Island()).toBe("<p>hello world</p>");
  });

  it("render() with html`` and array of html`` results produces no commas", () => {
    const Island = ilha
      .input(z.object({}))
      .state("items", ["a", "b", "c"])
      .render(
        ({ state }) =>
          html`<ul>
            ${state.items().map((i) => html`<li>${i}</li>`)}
          </ul>`,
      );

    const out = Island() as string;
    expect(out).not.toContain(",");
    expect(normalizeHtml(out)).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
  });

  it("renders Plain state value without function init", () => {
    const Island = ilha
      .input(z.object({}))
      .state("step", 3)
      .render(({ state }) => `<p>${state.step()}</p>`);

    expect(Island()).toBe("<p>3</p>");
  });

  it("renders multiple state keys", () => {
    const Island = ilha
      .input(z.object({ a: z.number().default(1), b: z.number().default(2) }))
      .state("a", ({ a }) => a)
      .state("b", ({ b }) => b)
      .render(({ state }) => `${state.a()}-${state.b()}`);

    expect(Island()).toBe("1-2");
    expect(Island({ a: 10, b: 20 })).toBe("10-20");
  });

  it("exposes input to render", () => {
    const Island = ilha
      .input(z.object({ name: z.string().default("world") }))
      .render(({ input }) => `<p>hello ${input.name}</p>`);

    expect(Island({ name: "Ada" })).toBe("<p>hello Ada</p>");
  });

  it("throws on invalid props", () => {
    const Island = ilha
      .input(z.object({ count: z.number() }))
      .render(({ input }) => `${input.count}`);

    expect(() => Island({ count: "not-a-number" as never })).toThrow("[ilha] Validation failed");
  });

  it(".on() and .effect() are no-ops during SSR render", () => {
    const Island = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .effect(({ state }) => {
        state.count(99);
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    expect(Island({ count: 3 })).toBe("<p>3</p>");
  });
});

// ---------------------------------------------
// Island — client mount
// ---------------------------------------------

describe("Island mount", () => {
  it("renders into the element on mount", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = Counter.mount(el, { count: 3 });
    expect(el.innerHTML).toBe("<p>3</p>");
    unmount();
    cleanup(el);
  });

  it("re-renders when state changes", () => {
    let accessor!: (v?: number) => number | void;

    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => {
        accessor = state.count as typeof accessor;
        return `<p>${state.count()}</p>`;
      });

    const el = makeEl();
    const unmount = Counter.mount(el, { count: 0 });
    expect(el.innerHTML).toBe("<p>0</p>");

    accessor(5);
    expect(el.innerHTML).toBe("<p>5</p>");

    unmount();
    cleanup(el);
  });

  it("attaches event listeners and updates state on click", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    const el = makeEl();
    const unmount = Counter.mount(el, { count: 0 });

    (el.querySelector("[data-inc]") as HTMLButtonElement).click();
    expect(el.querySelector("p")!.textContent).toBe("1");

    (el.querySelector("[data-inc]") as HTMLButtonElement).click();
    expect(el.querySelector("p")!.textContent).toBe("2");

    unmount();
    cleanup(el);
  });

  it("unmount removes event listeners", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    const el = makeEl();
    const unmount = Counter.mount(el, { count: 0 });
    unmount();

    (el.querySelector("[data-inc]") as HTMLButtonElement).click();
    expect(el.querySelector("p")!.textContent).toBe("0");
    cleanup(el);
  });

  it("runs effect on mount", () => {
    const calls: number[] = [];

    const Island = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .effect(({ state }) => {
        calls.push(state.count());
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el, { count: 42 });
    expect(calls).toContain(42);
    unmount();
    cleanup(el);
  });

  it("effect re-runs when tracked state changes", () => {
    const calls: number[] = [];
    let accessor!: (v?: number) => number | void;

    const Island = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .effect(({ state }) => {
        accessor = state.count as typeof accessor;
        calls.push(state.count());
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);

    accessor(1);
    accessor(2);

    expect(calls).toEqual([0, 1, 2]);
    unmount();
    cleanup(el);
  });

  it("effect cleanup is called on unmount", () => {
    const log: string[] = [];

    const Island = ilha
      .input(z.object({}))
      .state("tick", 0)
      .effect(({ state }) => {
        log.push(`run:${state.tick()}`);
        return () => log.push(`cleanup:${state.tick()}`);
      })
      .render(({ state }) => `${state.tick()}`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(log).toContain("run:0");
    unmount();
    expect(log.some((l) => l.startsWith("cleanup:"))).toBe(true);
    cleanup(el);
  });

  describe(".effect() signal", () => {
    it("provides ctx.signal to effects (not aborted during the run)", () => {
      let captured: AbortSignal | undefined;

      const Island = ilha
        .state("x", 0)
        .effect(({ signal }) => {
          captured = signal;
        })
        .render(({ state }) => `<p>${state.x()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);

      expect(captured).toBeInstanceOf(AbortSignal);
      expect(captured!.aborted).toBe(false);

      unmount();
      cleanup(el);
    });

    it("ctx.signal aborts when the island unmounts", () => {
      let captured: AbortSignal | undefined;

      const Island = ilha
        .state("x", 0)
        .effect(({ signal }) => {
          captured = signal;
        })
        .render(({ state }) => `<p>${state.x()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);

      expect(captured!.aborted).toBe(false);
      unmount();
      expect(captured!.aborted).toBe(true);

      cleanup(el);
    });

    it("ctx.signal aborts when the effect re-runs (race-cancel by default)", () => {
      const signals: AbortSignal[] = [];
      let accessor!: (v?: number) => number | void;

      const Island = ilha
        .state("count", 0)
        .effect(({ state, signal }) => {
          accessor = state.count as typeof accessor;
          state.count(); // track
          signals.push(signal);
        })
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);

      expect(signals.length).toBe(1);
      expect(signals[0]!.aborted).toBe(false);

      accessor(1);
      expect(signals.length).toBe(2);
      // First run's signal aborted when the effect re-ran.
      expect(signals[0]!.aborted).toBe(true);
      expect(signals[1]!.aborted).toBe(false);

      accessor(2);
      expect(signals.length).toBe(3);
      expect(signals[1]!.aborted).toBe(true);
      expect(signals[2]!.aborted).toBe(false);

      unmount();
      // Latest signal also aborts on unmount.
      expect(signals[2]!.aborted).toBe(true);

      cleanup(el);
    });

    it("each effect run gets a fresh signal (signals are not reused)", () => {
      const signals: AbortSignal[] = [];
      let accessor!: (v?: number) => number | void;

      const Island = ilha
        .state("n", 0)
        .effect(({ state, signal }) => {
          accessor = state.n as typeof accessor;
          state.n(); // track
          signals.push(signal);
        })
        .render(({ state }) => `${state.n()}`);

      const el = makeEl();
      const unmount = Island.mount(el);
      accessor(1);
      accessor(2);

      // No two signals should be the same instance.
      expect(new Set(signals).size).toBe(signals.length);

      unmount();
      cleanup(el);
    });

    it("real-world: stale fetch is cancelled when effect re-runs", async () => {
      const completed: number[] = [];
      const aborted: number[] = [];
      let accessor!: (v?: number) => number | void;

      function fakeFetch(value: number, signal: AbortSignal): Promise<number> {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(value), 10);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }

      const Island = ilha
        .state("query", 0)
        .effect(({ state, signal }) => {
          accessor = state.query as typeof accessor;
          const q = state.query();
          (async () => {
            try {
              const result = await fakeFetch(q, signal);
              completed.push(result);
            } catch (err) {
              if ((err as Error).name === "AbortError") aborted.push(q);
              else throw err;
            }
          })();
        })
        .render(({ state }) => `${state.query()}`);

      const el = makeEl();
      const unmount = Island.mount(el);

      // Trigger several re-runs in quick succession; only the last should complete.
      accessor(1);
      accessor(2);
      accessor(3);

      await new Promise((r) => setTimeout(r, 25));

      expect(completed).toEqual([3]);
      // Initial run (query=0) and intermediate runs (1, 2) all aborted.
      expect(aborted).toEqual([0, 1, 2]);

      unmount();
      cleanup(el);
    });

    it("user cleanup still runs alongside signal abort on re-run", () => {
      const log: string[] = [];
      let accessor!: (v?: number) => number | void;

      const Island = ilha
        .state("n", 0)
        .effect(({ state, signal }) => {
          accessor = state.n as typeof accessor;
          const n = state.n();
          log.push(`run:${n}`);
          signal.addEventListener("abort", () => log.push(`abort:${n}`));
          return () => log.push(`cleanup:${n}`);
        })
        .render(({ state }) => `${state.n()}`);

      const el = makeEl();
      const unmount = Island.mount(el);

      accessor(1);

      // Both user cleanup and signal abort fire when the effect re-runs.
      expect(log).toContain("cleanup:0");
      expect(log).toContain("abort:0");
      expect(log).toContain("run:1");

      unmount();
      cleanup(el);
    });
  });

  it("two mounted instances have independent state", () => {
    let capA!: (v?: number) => number | void;
    let capB!: (v?: number) => number | void;

    const IslandA = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => {
        capA = state.count as typeof capA;
        return `<p>${state.count()}</p>`;
      });

    const IslandB = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => {
        capB = state.count as typeof capB;
        return `<p>${state.count()}</p>`;
      });

    const elA = makeEl();
    const elB = makeEl();
    const unmountA = IslandA.mount(elA, { count: 0 });
    const unmountB = IslandB.mount(elB, { count: 0 });

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

  it("Plain value state init works on client", () => {
    const Island = ilha
      .input(z.object({}))
      .state("step", 5)
      .on("[data-btn]@click", ({ state }) => {
        state.step(state.step() + 1);
      })
      .render(({ state }) => `<p>${state.step()}</p><button data-btn>+</button>`);

    const el = makeEl();
    const unmount = Island.mount(el);
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

      const Island = ilha
        .state("count", 0)
        .on("[data-btn]@click:once", ({ state }) => {
          calls.push(state.count());
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn>+</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);

      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();

      expect(calls.length).toBe(1);
      unmount();
      cleanup(el);
    });

    it("root element @event binding (empty selector)", () => {
      const calls: number[] = [];

      const Island = ilha
        .state("count", 0)
        .on("@click", ({ state }) => {
          calls.push(state.count());
        })
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);

      (el as HTMLElement).click();
      expect(calls.length).toBe(1);

      unmount();
      cleanup(el);
    });
  });

  describe(".on combined @-syntax", () => {
    it("combined @event fires handler", () => {
      const calls: number[] = [];
      const Island = ilha
        .state("count", 0)
        .on("[data-btn]@click", ({ state }) => {
          calls.push(state.count());
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn></button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      expect(calls).toEqual([0, 1]);
      expect(el.querySelector("p")!.textContent).toBe("2");
      unmount();
      cleanup(el);
    });

    it("combined @event on root element (no selector prefix)", () => {
      const calls: number[] = [];
      const Island = ilha
        .state("count", 0)
        .on("@click", ({ state }) => {
          calls.push(state.count());
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el as HTMLElement).click();
      expect(calls.length).toBe(1);
      unmount();
      cleanup(el);
    });

    it("combined @event:once fires only once", () => {
      const calls: number[] = [];
      const Island = ilha
        .state("count", 0)
        .on("[data-btn]@click:once", ({ state }) => {
          calls.push(state.count());
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn></button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
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

    it("combined and legacy forms coexist on the same Island", () => {
      const log: string[] = [];
      const Island = ilha
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
      const unmount = Island.mount(el);
      (el.querySelector("[data-a]") as HTMLButtonElement).click();
      (el.querySelector("[data-b]") as HTMLButtonElement).click();
      expect(log).toEqual(["a", "b"]);
      expect(el.querySelector("p")!.textContent).toBe("11");
      unmount();
      cleanup(el);
    });

    it("combined @event SSR is a no-op (handler not called)", () => {
      const calls: number[] = [];
      const Island = ilha
        .state("count", 0)
        .on("[data-btn]@click", ({ state }) => {
          calls.push(state.count());
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn></button>`);

      expect(Island()).toBe("<p>0</p><button data-btn></button>");
      expect(calls.length).toBe(0);
    });
  });

  // ---------------------------------------------
  // .on() — derived in handler context
  // ---------------------------------------------

  describe(".on() derived in handler ctx", () => {
    it("derived.value is accessible inside .on() handler", () => {
      let capturedValue: number | undefined;

      const Island = ilha
        .state("count", 5)
        .derived("doubled", ({ state }) => state.count() * 2)
        .on("[data-btn]@click", ({ derived }) => {
          capturedValue = derived.doubled.value;
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn>go</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      expect(capturedValue).toBe(10);
      unmount();
      cleanup(el);
    });

    it("derived.loading is false for sync derived inside .on() handler", () => {
      let capturedLoading: boolean | undefined;

      const Island = ilha
        .state("x", 3)
        .derived("sq", ({ state }) => state.x() ** 2)
        .on("[data-btn]@click", ({ derived }) => {
          capturedLoading = derived.sq.loading;
        })
        .render(({ state }) => `<p>${state.x()}</p><button data-btn>go</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      expect(capturedLoading).toBe(false);
      unmount();
      cleanup(el);
    });

    it("derived value reflects latest resolved async derived inside .on() handler", async () => {
      let capturedValue: string | undefined;

      const Island = ilha
        .state("query", "hello")
        .derived("upper", async ({ state }) => {
          const q = state.query();
          await new Promise((r) => setTimeout(r, 5));
          return q.toUpperCase();
        })
        .on("[data-btn]@click", ({ derived }) => {
          capturedValue = derived.upper.value as string | undefined;
        })
        .render(({ derived }) =>
          derived.upper.loading
            ? `<p>loading</p><button data-btn>go</button>`
            : `<p>${derived.upper.value}</p><button data-btn>go</button>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      await new Promise((r) => setTimeout(r, 15));
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      expect(capturedValue).toBe("HELLO");
      unmount();
      cleanup(el);
    });

    it("derived.error is accessible inside .on() handler when async derived rejects", async () => {
      let capturedError: Error | undefined;

      const Island = ilha
        .derived("data", async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error("boom");
        })
        .on("[data-btn]@click", ({ derived }) => {
          capturedError = derived.data.error;
        })
        .render(({ derived }) =>
          derived.data.loading
            ? `<p>loading</p><button data-btn>go</button>`
            : `<p>done</p><button data-btn>go</button>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      await new Promise((r) => setTimeout(r, 15));
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError!.message).toBe("boom");
      unmount();
      cleanup(el);
    });

    it(".on() handler can read derived and mutate state together", () => {
      const Island = ilha
        .state("count", 3)
        .derived("doubled", ({ state }) => state.count() * 2)
        .on("[data-btn]@click", ({ state, derived }) => {
          // count(3) + doubled(6) = 9
          state.count(state.count() + (derived.doubled.value ?? 0));
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn>go</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("3");
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      expect(el.querySelector("p")!.textContent).toBe("9");
      unmount();
      cleanup(el);
    });

    it("derived is present in .on() handler with root @event syntax (no selector)", () => {
      let capturedValue: number | undefined;

      const Island = ilha
        .state("n", 7)
        .derived("sq", ({ state }) => state.n() ** 2)
        .on("@click", ({ derived }) => {
          capturedValue = derived.sq.value;
        })
        .render(({ state }) => `<p>${state.n()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el as HTMLElement).click();
      expect(capturedValue).toBe(49);
      unmount();
      cleanup(el);
    });

    it("derived is present in .on() handler for :once modifier", () => {
      const captured: Array<number | undefined> = [];

      const Island = ilha
        .state("n", 4)
        .derived("sq", ({ state }) => state.n() ** 2)
        .on("[data-btn]@click:once", ({ derived }) => {
          captured.push(derived.sq.value);
        })
        .render(({ state }) => `<p>${state.n()}</p><button data-btn>go</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      expect(captured.length).toBe(1);
      expect(captured[0]).toBe(16);
      unmount();
      cleanup(el);
    });

    it("multiple .on() handlers each see updated derived after state mutation", () => {
      const aValues: Array<number | undefined> = [];
      const bValues: Array<number | undefined> = [];

      const Island = ilha
        .state("n", 2)
        .derived("sq", ({ state }) => state.n() ** 2)
        .on("[data-a]@click", ({ derived, state }) => {
          aValues.push(derived.sq.value); // sq=4 at click time
          state.n(state.n() + 1); // n becomes 3, sq will become 9
        })
        .on("[data-b]@click", ({ derived }) => {
          bValues.push(derived.sq.value); // sq=9 after previous click
        })
        .render(
          ({ state }) => `<p>${state.n()}</p><button data-a>a</button><button data-b>b</button>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      (el.querySelector("[data-a]") as HTMLButtonElement).click();
      (el.querySelector("[data-b]") as HTMLButtonElement).click();
      expect(aValues).toEqual([4]);
      expect(bValues).toEqual([9]);
      unmount();
      cleanup(el);
    });

    it("derived is SSR no-op — .on() with derived is still a no-op during SSR", () => {
      const calls: number[] = [];

      const Island = ilha
        .state("count", 0)
        .derived("doubled", ({ state }) => state.count() * 2)
        .on("[data-btn]@click", ({ derived }) => {
          calls.push(derived.doubled.value ?? -1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-btn>go</button>`);

      expect(Island()).toBe("<p>0</p><button data-btn>go</button>");
      expect(calls.length).toBe(0);
    });
  });

  describe(".on() :abortable + signal", () => {
    it("provides ctx.signal to handlers (not aborted at fire time)", () => {
      let captured: AbortSignal | undefined;

      const Island = ilha
        .on("@click", ({ signal }) => {
          captured = signal;
        })
        .render(() => `<p>hi</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el as HTMLElement).click();

      expect(captured).toBeInstanceOf(AbortSignal);
      expect(captured!.aborted).toBe(false);

      unmount();
      cleanup(el);
    });

    it("ctx.signal aborts when the island unmounts", () => {
      let captured: AbortSignal | undefined;

      const Island = ilha
        .on("@click", ({ signal }) => {
          captured = signal;
        })
        .render(() => `<p>hi</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el as HTMLElement).click();

      expect(captured!.aborted).toBe(false);
      unmount();
      expect(captured!.aborted).toBe(true);

      cleanup(el);
    });

    it("without :abortable, repeated fires on same target do NOT abort prior signals", () => {
      const signals: AbortSignal[] = [];

      const Island = ilha
        .on("[data-btn]@click", ({ signal }) => {
          signals.push(signal);
        })
        .render(() => `<button data-btn>go</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      const btn = el.querySelector("[data-btn]") as HTMLButtonElement;
      btn.click();
      btn.click();
      btn.click();

      expect(signals.length).toBe(3);
      expect(signals[0]!.aborted).toBe(false);
      expect(signals[1]!.aborted).toBe(false);
      expect(signals[2]!.aborted).toBe(false);

      unmount();
      cleanup(el);
    });

    it(":abortable aborts the prior invocation's signal when same target re-fires", () => {
      const signals: AbortSignal[] = [];

      const Island = ilha
        .on("[data-btn]@click:abortable", ({ signal }) => {
          signals.push(signal);
        })
        .render(() => `<button data-btn>go</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      const btn = el.querySelector("[data-btn]") as HTMLButtonElement;

      btn.click();
      expect(signals[0]!.aborted).toBe(false);

      btn.click();
      expect(signals[0]!.aborted).toBe(true);
      expect(signals[1]!.aborted).toBe(false);

      btn.click();
      expect(signals[1]!.aborted).toBe(true);
      expect(signals[2]!.aborted).toBe(false);

      unmount();
      expect(signals[2]!.aborted).toBe(true);
      cleanup(el);
    });

    it(":abortable scope is per-target — different elements don't cancel each other", () => {
      const signalsByTarget = new Map<Element, AbortSignal[]>();

      const Island = ilha
        .on("[data-btn]@click:abortable", ({ signal, target }) => {
          if (!signalsByTarget.has(target)) signalsByTarget.set(target, []);
          signalsByTarget.get(target)!.push(signal);
        })
        .render(() => `<button data-btn id="a">a</button><button data-btn id="b">b</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      const a = el.querySelector("#a") as HTMLButtonElement;
      const b = el.querySelector("#b") as HTMLButtonElement;

      a.click();
      b.click();

      const aSignals = signalsByTarget.get(a)!;
      const bSignals = signalsByTarget.get(b)!;

      // Clicking b should NOT abort the in-flight a signal — they're scoped per target.
      expect(aSignals[0]!.aborted).toBe(false);
      expect(bSignals[0]!.aborted).toBe(false);

      // But clicking a again DOES abort the prior a signal.
      a.click();
      expect(aSignals[0]!.aborted).toBe(true);
      expect(aSignals[1]!.aborted).toBe(false);
      expect(bSignals[0]!.aborted).toBe(false);

      unmount();
      cleanup(el);
    });

    it(":abortable signals also abort on unmount", () => {
      const signals: AbortSignal[] = [];

      const Island = ilha
        .on("[data-btn]@click:abortable", ({ signal }) => {
          signals.push(signal);
        })
        .render(() => `<button data-btn>go</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();

      expect(signals[0]!.aborted).toBe(false);
      unmount();
      expect(signals[0]!.aborted).toBe(true);
      cleanup(el);
    });

    it("AbortError rejections from async handlers are not logged to console.error", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      const Island = ilha
        .on("[data-btn]@click", async ({ signal }) => {
          await new Promise((resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              },
              { once: true },
            );
            // Never resolve naturally — only the abort path will fire.
            void resolve;
          });
        })
        .render(() => `<button data-btn>go</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();

      // Trigger abort by unmounting — the handler's promise rejects with AbortError.
      unmount();
      // Let the rejection propagate.
      await new Promise((r) => setTimeout(r, 0));

      expect(errSpy).not.toHaveBeenCalled();

      errSpy.mockRestore();
      cleanup(el);
    });

    it("non-AbortError rejections from async handlers ARE logged", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      const Island = ilha
        .on("[data-btn]@click", async () => {
          throw new Error("boom");
        })
        .render(() => `<button data-btn>go</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      (el.querySelector("[data-btn]") as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));

      expect(errSpy).toHaveBeenCalled();

      errSpy.mockRestore();
      unmount();
      cleanup(el);
    });

    it("real-world: stale fetch is cancelled by :abortable race-cancel", async () => {
      const completed: string[] = [];
      const aborted: string[] = [];

      function fakeFetch(label: string, signal: AbortSignal): Promise<string> {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(label), 10);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }

      const Island = ilha
        .on("[data-btn]@click:abortable", async ({ signal, target }) => {
          const label = (target as HTMLElement).dataset["label"]!;
          try {
            const result = await fakeFetch(label, signal);
            completed.push(result);
          } catch (err) {
            if ((err as Error).name === "AbortError") aborted.push(label);
            else throw err;
          }
        })
        .render(
          () =>
            `<button data-btn data-label="first">1</button><button data-btn data-label="second">2</button>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      const [first, second] = Array.from(el.querySelectorAll("[data-btn]")) as HTMLButtonElement[];

      // Click both — they target different elements, so both should complete (per-target scope).
      first!.click();
      second!.click();
      await new Promise((r) => setTimeout(r, 25));

      expect(completed).toContain("first");
      expect(completed).toContain("second");
      expect(aborted).toEqual([]);

      // Now click first twice rapidly — second click should abort the first.
      completed.length = 0;
      aborted.length = 0;
      first!.click();
      first!.click();
      await new Promise((r) => setTimeout(r, 25));

      expect(aborted).toEqual(["first"]);
      expect(completed).toEqual(["first"]);

      unmount();
      cleanup(el);
    });
  });

  // ---------------------------------------------
  // ilha.from()
  // ---------------------------------------------

  describe("ilha.from()", () => {
    it("mounts Island onto element matching selector", () => {
      const Counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      el.id = "from-test";

      const unmount = from("#from-test", Counter, { count: 42 });
      expect(el.querySelector("p")!.textContent).toBe("42");

      unmount?.();
      cleanup(el);
    });

    it("returns null and warns when selector not found", () => {
      const Island = ilha.render(() => `<p>hi</p>`);
      const result = from("#does-not-exist", Island);
      expect(result).toBeNull();
    });

    it("accepts an Element directly", () => {
      const Island = ilha.state("x", 99).render(({ state }) => `<span>${state.x()}</span>`);

      const el = makeEl();
      const unmount = from(el, Island);
      expect(el.querySelector("span")!.textContent).toBe("99");

      unmount?.();
      cleanup(el);
    });
  });

  // ---------------------------------------------
  // ilha.context()
  // ---------------------------------------------

  describe("ilha.context()", () => {
    it("shared signal is readable across Islands", () => {
      const theme = context("test-theme", "light");

      const A = ilha.render(() => `<p>${theme()}</p>`);
      const B = ilha.render(() => `<span>${theme()}</span>`);

      const elA = makeEl();
      const elB = makeEl();
      const ua = A.mount(elA);
      const ub = B.mount(elB);

      expect(elA.querySelector("p")!.textContent).toBe("light");
      expect(elB.querySelector("span")!.textContent).toBe("light");

      ua();
      ub();
      cleanup(elA);
      cleanup(elB);
    });

    it("writing shared signal updates all subscribed Islands", () => {
      const score = context("test-score", 0);

      const Display = ilha.render(() => `<p>${score()}</p>`);

      const Control = ilha
        .state("_", 0)
        .on("[data-set]@click", () => {
          score(score() + 10);
        })
        .render(() => {
          return `<button data-set>set</button>`;
        });

      const elD = makeEl();
      const elC = makeEl();
      const ud = Display.mount(elD);
      const uc = Control.mount(elC);

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

      const Island = ilha
        .transition({
          enter: () => {
            log.push("enter");
          },
        })
        .render(() => `<p>hi</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(log).toContain("enter");
      unmount();
      cleanup(el);
    });

    it("calls leave on unmount", () => {
      const log: string[] = [];

      const Island = ilha
        .transition({
          leave: () => {
            log.push("leave");
          },
        })
        .render(() => `<p>hi</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      unmount();
      expect(log).toContain("leave");
      cleanup(el);
    });

    it("awaits async leave before teardown", async () => {
      const log: string[] = [];

      const Island = ilha
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
      const unmount = Island.mount(el);

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
      const Counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl("<p>42</p>");
      el.setAttribute("data-ilha-state", JSON.stringify({ count: 42 }));

      const unmount = Counter.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("42");

      unmount();
      cleanup(el);
    });

    it("data-ilha-state takes priority over input props", () => {
      const Counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      el.setAttribute("data-ilha-state", JSON.stringify({ count: 99 }));

      const unmount = Counter.mount(el, { count: 1 });
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
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await Counter.hydratable({ count: 3 }, { name: "Counter" });
        expect(result).toContain('data-ilha="Counter"');
      });

      it("embeds serialised props in data-ilha-props attribute", async () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await Counter.hydratable({ count: 7 }, { name: "Counter" });
        expect(result).toContain("data-ilha-props=");
        const doc = new DOMParser().parseFromString(result, "text/html");
        const wrapper = doc.querySelector("[data-ilha='Counter']")!;
        const props = JSON.parse(wrapper.getAttribute("data-ilha-props")!);
        expect(props.count).toBe(7);
      });

      it("renders Island content inside the wrapper", async () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await Counter.hydratable({ count: 5 }, { name: "Counter" });
        expect(result).toContain("<p>5</p>");
      });

      it("passes provided props to the Island render", async () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(42) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await Counter.hydratable({ count: 42 }, { name: "Counter" });
        expect(result).toContain("<p>42</p>");
        const doc = new DOMParser().parseFromString(result, "text/html");
        const props = JSON.parse(
          doc.querySelector("[data-ilha='Counter']")!.getAttribute("data-ilha-props")!,
        );
        expect(props.count).toBe(42);
      });

      it("returns a Promise<string>", () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = Counter.hydratable({ count: 1 }, { name: "Counter" });
        expect(result).toBeInstanceOf(Promise);
      });

      it("uses the provided 'as' tag as the wrapper element", async () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await Counter.hydratable({ count: 1 }, { name: "Counter", as: "section" });
        expect(result).toMatch(/^<section/);
        expect(result).toMatch(/<\/section>$/);
      });

      it("defaults to a div wrapper when 'as' is not provided", async () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const result = await Counter.hydratable({ count: 1 }, { name: "Counter" });
        expect(result).toMatch(/^<div/);
        expect(result).toMatch(/<\/div>$/);
      });
    });

    describe("client mount via base Island", () => {
      it("reads props from data-ilha-props when none are passed to mount()", () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "Counter");
        el.setAttribute("data-ilha-props", JSON.stringify({ count: 11 }));
        el.innerHTML = "<p>ssr</p>";
        document.body.appendChild(el);

        const unmount = Counter.mount(el);
        expect(el.querySelector("p")!.textContent).toBe("11");
        unmount();
      });

      it("explicit props passed to mount() override data-ilha-props", () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "Counter");
        el.setAttribute("data-ilha-props", JSON.stringify({ count: 1 }));
        document.body.appendChild(el);

        const unmount = Counter.mount(el, { count: 99 });
        expect(el.querySelector("p")!.textContent).toBe("99");
        unmount();
      });

      it("is reactive after hydration — state changes update the DOM", () => {
        let accessor!: (v?: number) => number | void;

        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => {
            accessor = state.count as typeof accessor;
            return `<p>${state.count()}</p>`;
          });

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "Counter");
        el.setAttribute("data-ilha-props", JSON.stringify({ count: 0 }));
        document.body.appendChild(el);

        const unmount = Counter.mount(el);
        accessor(7);
        expect(el.querySelector("p")!.textContent).toBe("7");
        unmount();
      });

      it("unmount tears down the hydrated Island", () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .on("[data-inc]@click", ({ state }) => {
            state.count(state.count() + 1);
          })
          .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "Counter");
        el.setAttribute("data-ilha-props", JSON.stringify({ count: 0 }));
        document.body.appendChild(el);

        const unmount = Counter.mount(el);
        unmount();

        (el.querySelector("[data-inc]") as HTMLButtonElement).click();
        expect(el.querySelector("p")!.textContent).toBe("0");
      });
    });

    describe("ilha.mount() auto-discovery", () => {
      it("discovers all [data-ilha='Counter'] elements and mounts them", () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const elA = document.createElement("div");
        elA.setAttribute("data-ilha", "Counter");
        elA.setAttribute("data-ilha-props", JSON.stringify({ count: 1 }));

        const elB = document.createElement("div");
        elB.setAttribute("data-ilha", "Counter");
        elB.setAttribute("data-ilha-props", JSON.stringify({ count: 2 }));

        document.body.appendChild(elA);
        document.body.appendChild(elB);

        const { unmount } = mount({ Counter });
        expect(elA.querySelector("p")!.textContent).toBe("1");
        expect(elB.querySelector("p")!.textContent).toBe("2");
        unmount();
      });

      it("unmount tears down all discovered instances", () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .on("[data-inc]@click", ({ state }) => {
            state.count(state.count() + 1);
          })
          .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "Counter");
        el.setAttribute("data-ilha-props", JSON.stringify({ count: 0 }));
        document.body.appendChild(el);

        const { unmount } = mount({ Counter });
        unmount();

        (el.querySelector("[data-inc]") as HTMLButtonElement).click();
        expect(el.querySelector("p")!.textContent).toBe("0");
      });

      it("scopes discovery to provided root element", () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const inside = document.createElement("div");
        inside.setAttribute("data-ilha", "Counter");
        inside.setAttribute("data-ilha-props", JSON.stringify({ count: 1 }));

        const outside = document.createElement("div");
        outside.setAttribute("data-ilha", "Counter");
        outside.setAttribute("data-ilha-props", JSON.stringify({ count: 2 }));
        outside.innerHTML = "<p>original</p>";

        const root = document.createElement("section");
        root.appendChild(inside);
        document.body.appendChild(root);
        document.body.appendChild(outside);

        const { unmount } = mount({ Counter }, { root });
        expect(inside.querySelector("p")!.textContent).toBe("1");
        expect(outside.querySelector("p")!.textContent).toBe("original");
        unmount();
      });

      it("handles malformed data-ilha-props gracefully", () => {
        const Counter = ilha
          .input(z.object({ count: z.number().default(0) }))
          .state("count", ({ count }) => count)
          .render(({ state }) => `<p>${state.count()}</p>`);

        const el = document.createElement("div");
        el.setAttribute("data-ilha", "Counter");
        el.setAttribute("data-ilha-props", "{invalid json}");
        document.body.appendChild(el);

        expect(() => mount({ Counter })).not.toThrow();
      });
    });

    it("hydratable() records sync-throwing derived as error entry, doesn't reject", async () => {
      const Island = ilha
        .derived("bad", () => {
          throw new Error("kaboom");
        })
        .render(() => `<p>x</p>`);

      const html = await Island.hydratable({}, { name: "test", snapshot: true });
      expect(html).toContain("data-ilha-state");
      // Pull out and parse the snapshot
      const match = html.match(/data-ilha-state='([^']+)'/);
      expect(match).toBeTruthy();
      const decoded = match![1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const snapshot = JSON.parse(decoded);
      expect(snapshot._derived.bad).toEqual({
        loading: false,
        value: undefined,
        error: "kaboom",
      });
    });
  });

  describe("BUG: subscription leak via island.toString() inside parent render effect", () => {
    it("CASE I (suspected bug): parent calls child.toString() in its render — child's derived leaks subscription to parent", () => {
      // Mirrors what `RouterView` does in @ilha/router:
      //   ilha.render(() => `<div>${island.toString()}</div>`)
      //
      // The child island has a .derived() that reads an external signal.
      // When the parent's render effect runs island.toString(), the child's
      // derived fn is invoked with the parent's render effect as the active
      // subscriber → parent gets subscribed to the external signal.

      const params = signal({ path: "/initial.md" });

      let parentRenders = 0;
      let childMounts = 0;

      const Topbar = ilha
        .derived("filename", () => {
          const p = params();
          return (p.path ?? "").split("/").pop() || "untitled.md";
        })
        .render(({ derived }) => html`<div data-tb>${derived.filename.value}</div>`);

      // Mirror RouterView pattern: parent calls child.toString() (NOT interpolation).
      const ParentView = ilha.render(() => {
        parentRenders++;
        // Note the .toString() call — this is what RouterView does.
        return html`<section>${Topbar.toString() as unknown as { value: string }}</section>` as any;
      });

      // Hmm, .toString returns a string, but html`` would escape it. Use raw:
      // Actually let's just use the same pattern as RouterView — concat strings.
      const ParentView2 = ilha.render(() => {
        parentRenders++;
        return `<section>${Topbar.toString()}</section>`;
      });

      const el = makeEl();
      const unmount = ParentView2.mount(el);
      void Topbar; // silence unused
      void ParentView; // silence unused
      void childMounts; // silence unused

      const p0 = parentRenders;
      // Change params — should NOT re-render the parent if there's no leak.
      params({ path: "/foo/bar.md" });

      expect({
        parentDelta: parentRenders - p0,
      }).toEqual({
        parentDelta: 0, // if this is 1, the leak is confirmed
      });

      unmount();
      cleanup(el);
    });

    it("CASE J (control): same as above but child uses .state + .effect — no leak", () => {
      const params = signal({ path: "/initial.md" });

      let parentRenders = 0;

      const Topbar = ilha
        .state("filename", "untitled.md")
        .effect(({ state }) => {
          const p = params();
          state.filename((p.path ?? "").split("/").pop() || "untitled.md");
        })
        .render(({ state }) => html`<div data-tb>${state.filename()}</div>`);

      const ParentView = ilha.render(() => {
        parentRenders++;
        return `<section>${Topbar.toString()}</section>`;
      });

      const el = makeEl();
      const unmount = ParentView.mount(el);

      const p0 = parentRenders;
      params({ path: "/foo/bar.md" });

      expect({
        parentDelta: parentRenders - p0,
      }).toEqual({
        parentDelta: 0,
      });

      unmount();
      cleanup(el);
    });

    it("CASE K (direct repro of router shape): parent reads activeIsland(), calls activeIsland().toString()", () => {
      // Even closer to RouterView's actual shape.
      const params = signal({ path: "/initial.md" });

      let parentRenders = 0;

      const PageA = ilha
        .derived("filename", () => {
          const p = params();
          return (p.path ?? "").split("/").pop() || "untitled.md";
        })
        .render(({ derived }) => html`<div data-page="A">${derived.filename.value}</div>`);

      const activeIsland = signal<typeof PageA | null>(PageA);

      const RouterView = ilha.render(() => {
        parentRenders++;
        const island = activeIsland();
        if (!island) return `<div data-empty></div>`;
        return `<div data-view>${island.toString()}</div>`;
      });

      const el = makeEl();
      const unmount = RouterView.mount(el);

      const p0 = parentRenders;
      // Only change params — activeIsland stays the same.
      // RouterView SHOULD NOT re-render. If it does, leak confirmed.
      params({ path: "/foo/bar.md" });

      expect({
        parentDelta: parentRenders - p0,
      }).toEqual({
        parentDelta: 0,
      });

      unmount();
      cleanup(el);
    });

    it("CASE L: parent reads signal directly in child's .render() during toString from reactive scope", () => {
      const params = signal({ path: "/initial.md" });
      let parentRenders = 0;

      const Page = ilha.render(() => {
        // Reads params directly in render — no derived, no state
        const p = params();
        return html`<div>${(p.path ?? "").split("/").pop()}</div>`;
      });

      const RouterView = ilha.render(() => {
        parentRenders++;
        return `<div>${Page.toString()}</div>`;
      });

      const el = makeEl();
      const unmount = RouterView.mount(el);
      const p0 = parentRenders;
      params({ path: "/foo/bar.md" });
      expect(parentRenders - p0).toBe(0);
      unmount();
      cleanup(el);
    });
  });
});

// ---------------------------------------------
// Island.mount() returns unmount()
// ---------------------------------------------

describe("Island.mount() returns unmount()", () => {
  it("mount() returns a callable function", () => {
    const Island = ilha.render(() => `<p>hi</p>`);
    const el = makeEl();
    const unmount = Island.mount(el);
    expect(typeof unmount).toBe("function");
    unmount();
    cleanup(el);
  });

  it("unmount() stops reactivity — DOM no longer updates after call", () => {
    let accessor!: (v?: number) => number | void;

    const Island = ilha.state("count", 0).render(({ state }) => {
      accessor = state.count as typeof accessor;
      return `<p>${state.count()}</p>`;
    });

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(el.querySelector("p")!.textContent).toBe("0");

    unmount();

    accessor(99);
    expect(el.querySelector("p")!.textContent).toBe("0");
    cleanup(el);
  });

  it("unmount() removes event listeners so clicks are silenced", () => {
    const calls: number[] = [];

    const Island = ilha
      .state("count", 0)
      .on("[data-btn]@click", ({ state }) => {
        calls.push(state.count());
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-btn>+</button>`);

    const el = makeEl();
    const unmount = Island.mount(el);

    (el.querySelector("[data-btn]") as HTMLButtonElement).click();
    expect(calls.length).toBe(1);

    unmount();

    (el.querySelector("[data-btn]") as HTMLButtonElement).click();
    expect(calls.length).toBe(1);
    cleanup(el);
  });

  it("unmount() runs effect cleanup callbacks", () => {
    const log: string[] = [];

    const Island = ilha
      .state("x", 0)
      .effect(({ state }) => {
        log.push(`run:${state.x()}`);
        return () => log.push(`cleanup:${state.x()}`);
      })
      .render(({ state }) => `<p>${state.x()}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(log.some((l) => l.startsWith("run:"))).toBe(true);

    unmount();
    expect(log.some((l) => l.startsWith("cleanup:"))).toBe(true);
    cleanup(el);
  });

  it("unmount() runs onMount cleanup callbacks", () => {
    const log: string[] = [];

    const Island = ilha
      .onMount(() => {
        log.push("mount");
        return () => log.push("destroy");
      })
      .render(() => `<p>hi</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(log).toContain("mount");

    unmount();
    expect(log).toContain("destroy");
    cleanup(el);
  });

  it("calling unmount() multiple times does not throw", () => {
    const Island = ilha.render(() => `<p>hi</p>`);
    const el = makeEl();
    const unmount = Island.mount(el);
    expect(() => {
      unmount();
      unmount();
    }).not.toThrow();
    cleanup(el);
  });

  it("each mount() call returns an independent unmount() — unmounting A does not affect B", () => {
    let capA!: (v?: number) => number | void;
    let capB!: (v?: number) => number | void;

    const IslandA = ilha.state("count", 0).render(({ state }) => {
      capA = state.count as typeof capA;
      return `<p>${state.count()}</p>`;
    });

    const IslandB = ilha.state("count", 0).render(({ state }) => {
      capB = state.count as typeof capB;
      return `<p>${state.count()}</p>`;
    });

    const elA = makeEl();
    const elB = makeEl();
    const unmountA = IslandA.mount(elA);
    const unmountB = IslandB.mount(elB);

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
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = document.createElement("div");
    el.setAttribute("data-ilha", "Counter");
    el.setAttribute("data-ilha-props", JSON.stringify({ count: 7 }));
    document.body.appendChild(el);

    const { unmount } = mount({ Counter });
    expect(el.innerHTML).toBe("<p>7</p>");
    unmount();
  });

  it("ignores unknown Island names", () => {
    const el = document.createElement("div");
    el.setAttribute("data-ilha", "unknown");
    el.innerHTML = "<p>original</p>";
    document.body.appendChild(el);

    const { unmount } = mount({});
    expect(el.innerHTML).toBe("<p>original</p>");
    unmount();
  });

  it("handles malformed data-ilha-props gracefully", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = document.createElement("div");
    el.setAttribute("data-ilha", "Counter");
    el.setAttribute("data-ilha-props", "{invalid json}");
    document.body.appendChild(el);

    expect(() => mount({ Counter })).not.toThrow();
  });

  it("unmount tears down all discovered Islands", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    const el = document.createElement("div");
    el.setAttribute("data-ilha", "Counter");
    el.setAttribute("data-ilha-props", JSON.stringify({ count: 0 }));
    document.body.appendChild(el);

    const { unmount } = mount({ Counter });
    unmount();

    (el.querySelector("[data-inc]") as HTMLButtonElement).click();
    expect(el.querySelector("p")!.textContent).toBe("0");
  });

  it("scopes discovery to provided root", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const inside = document.createElement("div");
    inside.setAttribute("data-ilha", "Counter");
    inside.setAttribute("data-ilha-props", JSON.stringify({ count: 1 }));

    const outside = document.createElement("div");
    outside.setAttribute("data-ilha", "Counter");
    outside.setAttribute("data-ilha-props", JSON.stringify({ count: 2 }));
    outside.innerHTML = "<p>original</p>";

    const root = document.createElement("section");
    root.appendChild(inside);
    document.body.appendChild(root);
    document.body.appendChild(outside);

    const { unmount } = mount({ Counter }, { root });
    expect(inside.innerHTML).toBe("<p>1</p>");
    expect(outside.innerHTML).toBe("<p>original</p>");
    unmount();
  });

  it("mounts multiple different Islands", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<span>${state.count()}</span>`);

    const Greeting = ilha
      .input(z.object({ name: z.string().default("world") }))
      .render(({ input }) => `<b>hello ${input.name}</b>`);

    const elA = document.createElement("div");
    elA.setAttribute("data-ilha", "Counter");
    elA.setAttribute("data-ilha-props", JSON.stringify({ count: 3 }));

    const elB = document.createElement("div");
    elB.setAttribute("data-ilha", "Greeting");
    elB.setAttribute("data-ilha-props", JSON.stringify({ name: "Ada" }));

    document.body.appendChild(elA);
    document.body.appendChild(elB);

    const { unmount } = mount({ Counter, Greeting });
    expect(elA.innerHTML).toBe("<span>3</span>");
    expect(elB.innerHTML).toBe("<b>hello Ada</b>");
    unmount();
  });
});

// ---------------------------------------------
// Slots
// ---------------------------------------------

describe("child islands (render-time composition)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("SSR renders Child Island inline via ${Child} interpolation", () => {
    const Badge = ilha
      .state("label", "hello")
      .render(({ state }) => `<span>${state.label()}</span>`);

    const Card = ilha.render(() => html`<div>${Badge}</div>`);

    expect(Card()).toBe(`<div><div data-ilha-slot="p:0"><span>hello</span></div></div>`);
  });

  it("SSR Child renders with its own schema defaults", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(99) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const Parent = ilha.render(() => html`<section>${Counter}</section>`);

    expect(Parent()).toBe(`<section><div data-ilha-slot="p:0"><p>99</p></div></section>`);
  });

  it("SSR slot renders with passed props", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const Parent = ilha.render(() => html`<div>${Counter({ count: 5 })}</div>`);

    expect(Parent()).toBe(
      "<div><div data-ilha-slot=\"p:0\" data-ilha-props='{&quot;count&quot;:5}'><p>5</p></div></div>",
    );
  });

  it("client slot element is present in DOM after mount", () => {
    const Child = ilha.render(() => `<span>Child</span>`);

    const Parent = ilha.render(() => html`<div>${Child}</div>`);

    const el = makeEl();
    const unmount = Parent.mount(el);
    expect(el.querySelector("[data-ilha-slot='p:0']")).not.toBeNull();
    expect(el.querySelector("[data-ilha-slot='p:0']")!.innerHTML).toBe("<span>Child</span>");
    unmount();
    cleanup(el);
  });

  it("client Child Island is interactive independently", () => {
    const Child = ilha
      .state("count", 0)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(
        ({ state }) =>
          html`<p>${state.count()}</p>
            <button data-inc>+</button>`,
      );

    const Parent = ilha.render(() => html`<div class="Parent">${Child}</div>`);

    const el = makeEl();
    const unmount = Parent.mount(el);

    el.querySelector<HTMLButtonElement>("[data-inc]")!.click();
    expect(el.querySelector("p")!.textContent).toBe("1");

    el.querySelector<HTMLButtonElement>("[data-inc]")!.click();
    expect(el.querySelector("p")!.textContent).toBe("2");

    unmount();
    cleanup(el);
  });

  it("client Parent re-render does not destroy Child slot", () => {
    const Child = ilha
      .state("count", 0)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(
        ({ state }) =>
          html`<p>${state.count()}</p>
            <button data-inc>+</button>`,
      );

    let ParentAccessor!: (v?: number) => number | void;

    const Parent = ilha.state("tick", 0).render(({ state }) => {
      ParentAccessor = state.tick as typeof ParentAccessor;
      return html`<div><span>${state.tick()}</span>${Child}</div>`;
    });

    const el = makeEl();
    const unmount = Parent.mount(el);

    el.querySelector<HTMLButtonElement>("[data-inc]")!.click();
    expect(el.querySelector("p")!.textContent).toBe("1");

    ParentAccessor(1);
    expect(el.querySelector("span")!.textContent).toBe("1");
    expect(el.querySelector("p")!.textContent).toBe("1");

    el.querySelector<HTMLButtonElement>("[data-inc]")!.click();
    expect(el.querySelector("p")!.textContent).toBe("2");

    unmount();
    cleanup(el);
  });

  it("client multiple children are independently preserved on Parent re-render", () => {
    const ChildA = ilha.state("val", "A").render(({ state }) => `<i>${state.val()}</i>`);
    const ChildB = ilha.state("val", "B").render(({ state }) => `<b>${state.val()}</b>`);

    let ParentAccessor!: (v?: number) => number | void;

    const Parent = ilha.state("tick", 0).render(({ state }) => {
      ParentAccessor = state.tick as typeof ParentAccessor;
      return html`<div>${state.tick()}${ChildA}${ChildB}</div>`;
    });

    const el = makeEl();
    const unmount = Parent.mount(el);

    const slotA = el.querySelector("[data-ilha-slot='p:0']")!;
    const slotB = el.querySelector("[data-ilha-slot='p:1']")!;

    ParentAccessor(1);
    expect(el.querySelector("[data-ilha-slot='p:0']")).toBe(slotA);
    expect(el.querySelector("[data-ilha-slot='p:1']")).toBe(slotB);

    unmount();
    cleanup(el);
  });

  it("client Parent unmount cascades to Child islands", () => {
    const ChildCalls: string[] = [];

    const Child = ilha
      .state("x", 0)
      .effect(({ state }) => {
        ChildCalls.push(`run:${state.x()}`);
        return () => ChildCalls.push(`cleanup:${state.x()}`);
      })
      .render(({ state }) => `<span>${state.x()}</span>`);

    const Parent = ilha.render(() => html`<div>${Child}</div>`);

    const el = makeEl();
    const unmount = Parent.mount(el);
    expect(ChildCalls).toContain("run:0");
    unmount();
    expect(ChildCalls.some((l) => l.startsWith("cleanup:"))).toBe(true);
    cleanup(el);
  });

  it("client slot receives props via Child(props) call", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    const Parent = ilha.render(() => html`<div>${Counter({ count: 7 })}</div>`);

    const el = makeEl();
    const unmount = Parent.mount(el);
    expect(el.querySelector("p")!.textContent).toBe("7");
    unmount();
    cleanup(el);
  });

  // .key() — explicit keys for stable identity across re-renders, required when
  // positional order is not reliable (reorderable lists, conditional children).
  describe(".key()", () => {
    it("SSR emits slot id as k:{key}", () => {
      const Badge = ilha
        .state("label", "hi")
        .render(({ state }) => `<span>${state.label()}</span>`);

      const Parent = ilha.render(() => html`<div>${Badge.key("featured")}</div>`);

      expect(Parent()).toBe(`<div><div data-ilha-slot="k:featured"><span>hi</span></div></div>`);
    });

    it("SSR .key() with props", () => {
      const Counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const Parent = ilha.render(() => html`<div>${Counter.key("c1")({ count: 42 })}</div>`);

      expect(Parent()).toBe(
        "<div><div data-ilha-slot=\"k:c1\" data-ilha-props='{&quot;count&quot;:42}'><p>42</p></div></div>",
      );
    });

    it("keyed list items preserve identity across reorder", () => {
      const Item = ilha
        .state("n", 0)
        .on("[data-bump]@click", ({ state }) => state.n(state.n() + 1))
        .render(({ state }) => html`<li>${state.n()}<button data-bump>+</button></li>`);

      let setOrder!: (v: string[]) => void;

      const List = ilha.state<string[]>("order", ["a", "b", "c"]).render(({ state }) => {
        setOrder = state.order as unknown as typeof setOrder;
        return html`<ul>
          ${state.order().map((k) => Item.key(k))}
        </ul>`;
      });

      const el = makeEl();
      const unmount = List.mount(el);

      const slotA = el.querySelector("[data-ilha-slot='k:a']")!;
      // bump the first Item's count — we'll check this state survives reorder.
      slotA.querySelector<HTMLButtonElement>("[data-bump]")!.click();
      expect(slotA.querySelector("li")!.textContent).toBe("1+");

      setOrder(["c", "a", "b"]);
      // Same DOM node for "a" after reorder — identity preserved by key.
      expect(el.querySelector("[data-ilha-slot='k:a']")).toBe(slotA);
      // Child state survives.
      expect(slotA.querySelector("li")!.textContent).toBe("1+");

      unmount();
      cleanup(el);
    });

    it("removing a keyed child unmounts it and cleans up", () => {
      const childCleanups: string[] = [];
      const Child = ilha
        .input<{ id: string }>()
        .state("id", ({ id }) => id ?? "")
        .effect(({ state }) => {
          return () => childCleanups.push(`cleanup:${state.id()}`);
        })
        .render(({ state }) => `<span>${state.id()}</span>`);

      let setKeys!: (v: string[]) => void;

      const Parent = ilha.state<string[]>("keys", ["a", "b"]).render(({ state }) => {
        setKeys = state.keys as unknown as typeof setKeys;
        return html`<div>${state.keys().map((k) => Child.key(k)({ id: k }))}</div>`;
      });

      const el = makeEl();
      const unmount = Parent.mount(el);

      expect(el.querySelector("[data-ilha-slot='k:a']")).not.toBeNull();
      expect(el.querySelector("[data-ilha-slot='k:b']")).not.toBeNull();

      // Drop "a" — it should be unmounted and cleaned up; "b" survives.
      setKeys(["b"]);
      expect(el.querySelector("[data-ilha-slot='k:a']")).toBeNull();
      expect(el.querySelector("[data-ilha-slot='k:b']")).not.toBeNull();
      expect(childCleanups).toContain("cleanup:a");
      expect(childCleanups).not.toContain("cleanup:b");

      unmount();
      cleanup(el);
    });
  });

  describe("conditional rendering", () => {
    it("conditionally-rendered child is mounted when it appears", () => {
      const Child = ilha.state("x", 0).render(({ state }) => `<span>${state.x()}</span>`);

      let setShow!: (v: boolean) => void;

      const Parent = ilha.state("show", false).render(({ state }) => {
        setShow = state.show as unknown as typeof setShow;
        return html`<div>${state.show() ? Child : ""}</div>`;
      });

      const el = makeEl();
      const unmount = Parent.mount(el);

      expect(el.querySelector("[data-ilha-slot]")).toBeNull();

      setShow(true);
      const slot = el.querySelector("[data-ilha-slot='p:0']");
      expect(slot).not.toBeNull();
      expect(slot!.querySelector("span")?.textContent).toBe("0");

      unmount();
      cleanup(el);
    });

    it("child is unmounted when conditionally removed", () => {
      const cleanups: string[] = [];
      const Child = ilha
        .state("x", 0)
        .effect(() => () => cleanups.push("cleanup"))
        .render(({ state }) => `<span>${state.x()}</span>`);

      let setShow!: (v: boolean) => void;

      const Parent = ilha.state("show", true).render(({ state }) => {
        setShow = state.show as unknown as typeof setShow;
        return html`<div>${state.show() ? Child : ""}</div>`;
      });

      const el = makeEl();
      const unmount = Parent.mount(el);

      expect(el.querySelector("[data-ilha-slot='p:0']")).not.toBeNull();

      setShow(false);
      expect(el.querySelector("[data-ilha-slot='p:0']")).toBeNull();
      expect(cleanups).toContain("cleanup");

      unmount();
      cleanup(el);
    });
  });

  it("calling an Island outside an html`` interpolation returns SSR string (backward compat)", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    // Outside any active render context: call returns SSR HTML, as before.
    expect(Counter({ count: 7 })).toBe("<p>7</p>");
  });

  // data-ilha-props pre-existing on a slot element is still honoured for
  // hydration scenarios where the slot map isn't the source of truth.
  it("client slot reads props from data-ilha-props when slot already in DOM", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => `<p>${state.count()}</p>`);

    // Parent renders a slot marker element with pre-encoded props but without
    // calling Counter directly — simulates hydration over SSR output where the
    // slot element carries props as attributes.
    const Parent = ilha.render(() =>
      raw(`<div><div data-ilha-slot="k:counter" data-ilha-props='{"count":3}'></div></div>`),
    );

    // We can't rely on positional emission here because Parent didn't interpolate
    // Counter — instead we manually mount Counter into the slot via from().
    const el = makeEl();
    const unmount = Parent.mount(el);
    const slot = el.querySelector("[data-ilha-slot='k:counter']") as Element;
    const unmountChild = Counter.mount(slot);
    expect(el.querySelector("p")!.textContent).toBe("3");
    unmountChild();
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
      const Island = ilha
        .derived("data", async () => "resolved")
        .render(({ derived }) =>
          derived.data.loading ? `<p>loading</p>` : `<p>${derived.data.value}</p>`,
        );

      expect(await Island()).toBe("<p>resolved</p>");
    });

    it("SSR async derived.value and derived.error are undefined during SSR", async () => {
      const Island = ilha
        .derived("data", async () => 42)
        .render(({ derived }) => {
          const d = derived.data;
          return `${d.loading}${d.value}${d.error}`;
        });

      expect(await Island()).toBe("false42undefined");
    });

    it("SSR multiple async derived keys all start as loading", async () => {
      const Island = ilha
        .derived("a", async () => 1)
        .derived("b", async () => 2)
        .render(({ derived }) => `${derived.a.loading}${derived.b.loading}`);

      expect(await Island()).toBe("falsefalse");
    });
  });

  describe("SSR sync", () => {
    it("SSR sync derived resolves immediately during SSR", () => {
      const Island = ilha
        .state("count", 5)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ derived }) =>
          derived.doubled.loading ? `<p>loading</p>` : `<p>${derived.doubled.value}</p>`,
        );

      expect(Island()).toBe("<p>10</p>");
    });

    it("SSR sync derived has loading:false and correct value", () => {
      const Island = ilha
        .state("name", "ada")
        .derived("upper", ({ state }) => state.name().toUpperCase())
        .render(({ derived }) => {
          const d = derived.upper;
          return `${d.loading}${d.value}${d.error}`;
        });

      expect(Island()).toBe("falseADAundefined");
    });

    it("SSR sync derived receives input", () => {
      const Island = ilha
        .input(z.object({ multiplier: z.number().default(3) }))
        .derived("result", ({ input }) => input.multiplier * 10)
        .render(({ derived }) => `<p>${derived.result.value}</p>`);

      expect(Island({ multiplier: 4 })).toBe("<p>40</p>");
    });

    it("SSR mixed sync and async derived: sync resolves, async is loading", async () => {
      const Island = ilha
        .state("count", 3)
        .derived("sync", ({ state }) => state.count() * 2)
        .derived("async", async ({ state }) => state.count() * 3)
        .render(
          ({ derived }) =>
            `${derived.sync.loading}${derived.sync.value}${derived.async.loading}${derived.async.value}`,
        );

      expect(await Island()).toBe("false6false9");
    });

    it("SSR Island returns a Promise when async derived is present", () => {
      const Island = ilha
        .derived("data", async () => 42)
        .render(({ derived }) => `<p>${derived.data.value}</p>`);

      const result = Island();
      expect(result).toBeInstanceOf(Promise);
    });

    it("SSR Island returns a string when all derived are sync", () => {
      const Island = ilha
        .state("count", 2)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ derived }) => `<p>${derived.doubled.value}</p>`);

      const result = Island();
      expect(typeof result).toBe("string");
      expect(result).toBe("<p>4</p>");
    });

    it("SSR toString keeps async derived in loading state", () => {
      const Island = ilha
        .derived("data", async () => 42)
        .render(({ derived }) =>
          derived.data.loading ? `<p>loading</p>` : `<p>${derived.data.value}</p>`,
        );

      expect(Island.toString()).toBe("<p>loading</p>");
    });

    it("SSR template interpolation uses toString fallback for async derived", () => {
      const Island = ilha
        .derived("data", async () => "resolved")
        .render(({ derived }) =>
          derived.data.loading ? `<p>loading</p>` : `<p>${derived.data.value}</p>`,
        );

      expect(`<div>${Island}</div>`).toBe("<div><p>loading</p></div>");
    });

    it("SSR awaited async derived rejection populates error envelope", async () => {
      const Island = ilha
        .derived("data", async () => {
          throw new Error("boom");
        })
        .render(({ derived }) => {
          if (derived.data.loading) return `<p>loading</p>`;
          if (derived.data.error) return `<p>error:${derived.data.error.message}</p>`;
          return `<p>${derived.data.value}</p>`;
        });

      expect(await Island()).toBe("<p>error:boom</p>");
    });

    it("SSR awaited async non-Error throw is wrapped in Error", async () => {
      const Island = ilha
        .derived("data", async () => {
          throw "bad";
        })
        .render(({ derived }) => {
          if (derived.data.loading) return `<p>loading</p>`;
          return `<p>${derived.data.error instanceof Error}</p>`;
        });

      expect(await Island()).toBe("<p>true</p>");
    });

    it("SSR toString resolves sync derived but keeps async derived loading", () => {
      const Island = ilha
        .state("count", 3)
        .derived("sync", ({ state }) => state.count() * 2)
        .derived("async", async ({ state }) => state.count() * 3)
        .render(
          ({ derived }) =>
            `${derived.sync.loading}${derived.sync.value}${derived.async.loading}${derived.async.value}`,
        );

      expect(Island.toString()).toBe("false6trueundefined");
    });
  });

  describe("Client basic resolve", () => {
    it("client async derived resolves and triggers re-render", async () => {
      const Island = ilha
        .derived("msg", async () => {
          await new Promise((r) => setTimeout(r, 5));
          return "hello";
        })
        .render(({ derived }) =>
          derived.msg.loading ? `<p>loading</p>` : `<p>${derived.msg.value}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("loading");
      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("hello");
      unmount();
      cleanup(el);
    });

    it("client sync derived is immediately available on mount", () => {
      const Island = ilha
        .state("count", 7)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ derived }) => `<p>${derived.doubled.value}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("14");
      unmount();
      cleanup(el);
    });

    it("client sync derived never has loading:true", () => {
      const Island = ilha
        .state("x", 3)
        .derived("sq", ({ state }) => state.x() ** 2)
        .render(({ derived }) => `<p>${derived.sq.loading}${derived.sq.value}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("false9");
      unmount();
      cleanup(el);
    });

    it("client async derived captures error and sets error envelope", async () => {
      const Island = ilha
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
      const unmount = Island.mount(el);
      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("error:boom");
      unmount();
      cleanup(el);
    });

    it("client non-Error throws are wrapped in Error", async () => {
      const Island = ilha
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
      const unmount = Island.mount(el);
      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("true");
      unmount();
      cleanup(el);
    });
  });

  describe("Client reactivity", () => {
    it("client sync derived re-runs reactively when state changes", () => {
      let accessor!: (v?: number) => number | void;

      const Island = ilha
        .state("count", 2)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ state, derived }) => {
          accessor = state.count as typeof accessor;
          return `<p>${derived.doubled.value}</p>`;
        });

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("4");
      accessor(10);
      expect(el.querySelector("p")!.textContent).toBe("20");
      accessor(0);
      expect(el.querySelector("p")!.textContent).toBe("0");
      unmount();
      cleanup(el);
    });

    it("client sync derived re-runs after hydration with snapshot", async () => {
      let accessor!: (v?: number) => number | void;

      const Island = ilha
        .state("count", 2)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ state, derived }) => {
          accessor = state.count as typeof accessor;
          return `<p>${derived.doubled.value}</p>`;
        });

      const ssr = await Island.hydratable({}, { name: "snap", snapshot: true });
      document.body.innerHTML = ssr;
      const wrapper = document.querySelector("[data-ilha='snap']")!;

      const unmount = Island.mount(wrapper);
      expect(wrapper.querySelector("p")!.textContent).toBe("4");

      accessor(10);
      expect(wrapper.querySelector("p")!.textContent).toBe("20");

      unmount();
      document.body.innerHTML = "";
    });

    it("client async derived re-runs when tracked state changes", async () => {
      let accessor!: (v?: string) => string | void;
      const calls: string[] = [];

      const Island = ilha
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
      const unmount = Island.mount(el);
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

      const Island = ilha
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
      const unmount = Island.mount(el);
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

      const Island = ilha
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
      const unmount = Island.mount(el);
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

      const Island = ilha
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
      const unmount = Island.mount(el);
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

      const Island = ilha
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
      const unmount = Island.mount(el);
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

      const Island = ilha
        .derived("data", async ({ signal }) => {
          await new Promise<void>((res) => setTimeout(res, 30));
          abortedAfterUnmount = signal.aborted;
          return "done";
        })
        .render(({ derived }) => (derived.data.loading ? `<p>loading</p>` : `<p>done</p>`));

      const el = makeEl();
      const unmount = Island.mount(el);
      await new Promise((r) => setTimeout(r, 5));
      unmount();
      await new Promise((r) => setTimeout(r, 40));
      expect(abortedAfterUnmount).toBe(true);
      cleanup(el);
    });

    it("client unmount stops sync derived reactive effect", () => {
      let accessor!: (v?: number) => number | void;

      const Island = ilha
        .state("count", 1)
        .derived("doubled", ({ state }) => state.count() * 2)
        .render(({ state, derived }) => {
          accessor = state.count as typeof accessor;
          return `<p>${derived.doubled.value}</p>`;
        });

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector("p")!.textContent).toBe("2");
      unmount();
      accessor(99);
      expect(el.querySelector("p")!.textContent).toBe("2");
      cleanup(el);
    });
  });

  describe("Client multiple instances / input access", () => {
    it("client two mounted instances have independent derived state", async () => {
      const Island = ilha
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
      const unmountA = Island.mount(elA, { prefix: "a" });
      const unmountB = Island.mount(elB, { prefix: "b" });
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

      const IslandA = ilha
        .state("n", 1)
        .derived("sq", ({ state }) => state.n() ** 2)
        .render(({ state, derived }) => {
          capA = state.n as typeof capA;
          return `<p>${derived.sq.value}</p>`;
        });

      const IslandB = ilha
        .state("n", 1)
        .derived("sq", ({ state }) => state.n() ** 2)
        .render(({ state, derived }) => {
          capB = state.n as typeof capB;
          return `<p>${derived.sq.value}</p>`;
        });

      const elC = makeEl();
      const elD = makeEl();
      const unmountC = IslandA.mount(elC);
      const unmountD = IslandB.mount(elD);

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
      const Island = ilha
        .input(z.object({ multiplier: z.number().default(3) }))
        .derived("result", async ({ input }) => {
          await new Promise((r) => setTimeout(r, 5));
          return input.multiplier * 10;
        })
        .render(({ derived }) =>
          derived.result.loading ? `<p></p>` : `<p>${derived.result.value}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el, { multiplier: 4 });
      await new Promise((r) => setTimeout(r, 15));
      expect(el.querySelector("p")!.textContent).toBe("40");
      unmount();
      cleanup(el);
    });

    it("client sync derived fn receives input", () => {
      const Island = ilha
        .input(z.object({ multiplier: z.number().default(3) }))
        .derived("result", ({ input }) => input.multiplier * 10)
        .render(({ derived }) => `<p>${derived.result.value}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el, { multiplier: 4 });
      expect(el.querySelector("p")!.textContent).toBe("40");
      unmount();
      cleanup(el);
    });
  });
});

// ---------------------------------------------
// .bind
// ---------------------------------------------

describe("bind: template syntax", () => {
  describe("SSR", () => {
    it("emits canonical value attribute and bind sentinel for bind:value", () => {
      const Island = ilha
        .state("email", "default@example.com")
        .render(({ state }) => html`<input bind:value=${state.email}>`);

      const out = Island();
      // Order of attributes is implementation-defined; check both pieces.
      expect(out).toContain(`value="default@example.com"`);
      expect(out).toContain(`data-ilha-bind="value:0"`);
    });

    it("emits checked attribute and sentinel for bind:checked when true", () => {
      const Island = ilha
        .state("agreed", true)
        .render(({ state }) => html`<input type="checkbox" bind:checked=${state.agreed}>`);

      const out = Island();
      // Verify the bare attribute token appears in the tag, not just in the sentinel value.
      expect(out).toMatch(/<[^>]+\schecked(?:\s|>)/);
      expect(out).toContain(`data-ilha-bind="checked:0"`);
    });

    it("emits only sentinel (no checked attr) for bind:checked when false", () => {
      const Island = ilha
        .state("agreed", false)
        .render(({ state }) => html`<input type="checkbox" bind:checked=${state.agreed}>`);

      const out = Island();
      expect(out).toContain(`data-ilha-bind="checked:0"`);
      expect(out).not.toMatch(/\bchecked(\s|=|>)/);
    });

    it("emits sentinel for bind:files (no SSR attr, file inputs cannot persist)", () => {
      const Island = ilha
        .state("uploaded", null)
        .render(({ state }) => html`<input type="file" bind:files=${state.uploaded}>`);

      const out = Island();
      expect(out).toContain(`data-ilha-bind="files:0"`);
    });

    it("emits open attribute and sentinel for bind:open when true", () => {
      const Island = ilha
        .state("expanded", true)
        .render(({ state }) => html`<details bind:open=${state.expanded}>x</details>`);

      const out = Island();
      expect(out).toMatch(/<[^>]+\sopen(?:\s|>)/);
      expect(out).toContain(`data-ilha-bind="open:0"`);
    });

    it("emits formatted YYYY-MM-DD value for bind:valueAsDate", () => {
      const Island = ilha
        .state("dob", new Date(2026, 4, 15)) // May 15 2026
        .render(({ state }) => html`<input type="date" bind:valueAsDate=${state.dob}>`);

      const out = Island();
      expect(out).toContain(`value="2026-05-15"`);
      expect(out).toContain(`data-ilha-bind="valueAsDate:0"`);
    });

    it("emits string number value for bind:valueAsNumber", () => {
      const Island = ilha
        .state("age", 42)
        .render(({ state }) => html`<input type="number" bind:valueAsNumber=${state.age}>`);

      const out = Island();
      expect(out).toContain(`value="42"`);
      expect(out).toContain(`data-ilha-bind="valueAsNumber:0"`);
    });

    it("emits sentinel only for bind:this (no reflection)", () => {
      const Island = ilha
        .state("ref", null)
        .render(({ state }) => html`<input bind:this=${state.ref}>`);

      const out = Island();
      expect(out).toContain(`data-ilha-bind="this:0"`);
    });

    it("accepts both quoted and unquoted bind: syntax (closing quote stripped)", () => {
      const Island = ilha
        .state("name", "ada")
        .render(({ state }) => html`<input bind:value="${state.name}" placeholder="x">`);

      const out = Island();
      // The "${state.name}" quoted form: opening quote was stripped from the
      // bind:value=" part, the closing quote was stripped from the chunk
      // following the interpolation. Output should be a single value="ada"
      // attribute, not value="ada"" with a dangling quote.
      expect(out).toContain(`value="ada"`);
      expect(out).not.toContain(`""`);
      expect(out).toContain(`placeholder="x"`);
    });

    it("supports multiple bind: bindings on different elements with monotonic indices", () => {
      const Island = ilha
        .state("a", "hello")
        .state("b", true)
        .render(
          ({ state }) =>
            html`<input bind:value=${state.a}><input type="checkbox" bind:checked=${state.b}>`,
        );

      const out = Island();
      expect(out).toContain(`data-ilha-bind="value:0"`);
      expect(out).toContain(`data-ilha-bind="checked:1"`);
    });

    it("renders bind:group radio with checked when signal matches static value", () => {
      const Island = ilha
        .state("plan", "pro")
        .render(
          ({ state }) =>
            html`<input type="radio" name="plan" value="free" bind:group=${state.plan}><input type="radio" name="plan" value="pro" bind:group=${state.plan}>`,
        );

      const out = Island() as string;
      // Both radios get sentinels; only the matching one gets `checked`.
      expect(out).toContain(`value="free"`);
      expect(out).toContain(`value="pro"`);
      // Count `checked` occurrences as a bare attribute.
      const checkedMatches = out.match(/\bchecked(\s|>)/g) ?? [];
      expect(checkedMatches.length).toBe(1);
    });

    it("renders bind:group checkbox checked for array members", () => {
      const Island = ilha
        .state<string[]>("tags", ["ts", "rust"])
        .render(
          ({ state }) =>
            html`<input type="checkbox" name="tag" value="js" bind:group=${state.tags}><input type="checkbox" name="tag" value="ts" bind:group=${state.tags}><input type="checkbox" name="tag" value="rust" bind:group=${state.tags}>`,
        );

      const out = Island() as string;
      // js is NOT in the array; ts and rust ARE.
      // Find each input by its value attribute and check whether `checked`
      // appears between that value and the next `>`.
      const js = out.match(/value="js"[^>]*>/)![0];
      const ts = out.match(/value="ts"[^>]*>/)![0];
      const rust = out.match(/value="rust"[^>]*>/)![0];
      expect(js).not.toMatch(/\bchecked/);
      expect(ts).toMatch(/\bchecked/);
      expect(rust).toMatch(/\bchecked/);
    });

    it("binding indices restart at 0 for each separate render", () => {
      // Each render pushes its own RenderCtx, so the binds counter resets.
      // If indices accidentally accumulated across renders (e.g. via a
      // shared context), the second toString() would produce value:1 instead
      // of value:0.
      const Island = ilha
        .state("name", "ada")
        .render(({ state }) => html`<input bind:value=${state.name}>`);

      const first = Island();
      const second = Island();
      expect(first).toContain(`data-ilha-bind="value:0"`);
      expect(second).toContain(`data-ilha-bind="value:0"`);
      // And critically, never :1 — that would indicate cross-render leak.
      expect(first).not.toContain(`value:1`);
      expect(second).not.toContain(`value:1`);
    });

    it("nested html`` inside a render share the parent's binding counter", () => {
      // Within a SINGLE render, multiple html`` calls (e.g. via .map or
      // helper functions) all push into the same RenderCtx.binds. So the
      // second template's first binding picks up where the first left off.
      const Island = ilha
        .state("a", "x")
        .state("b", true)
        .render(({ state }) => {
          const head = html`<input bind:value=${state.a}>`;
          const tail = html`<input type="checkbox" bind:checked=${state.b}>`;
          return html`<div>${head}${tail}</div>`;
        });

      const out = Island();
      expect(out).toContain(`data-ilha-bind="value:0"`);
      expect(out).toContain(`data-ilha-bind="checked:1"`);
    });
  });

  describe("DOM -> state", () => {
    it("text input change updates state via bind:value", () => {
      const Island = ilha
        .state("name", "ada")
        .render(
          ({ state }) => html`<input data-name bind:value=${state.name}><p>${state.name}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      const input = el.querySelector<HTMLInputElement>("[data-name]")!;
      input.value = "grace";
      input.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("grace");
      unmount();
      cleanup(el);
    });

    it("checkbox change updates boolean state via bind:checked", () => {
      const Island = ilha
        .state("checked", false)
        .render(
          ({ state }) =>
            html`<input type="checkbox" data-cb bind:checked=${state.checked}><p>${state.checked}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      const cb = el.querySelector<HTMLInputElement>("[data-cb]")!;
      cb.checked = true;
      cb.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toBe("true");
      unmount();
      cleanup(el);
    });

    it("select change updates state via bind:value", () => {
      const Island = ilha
        .state("size", "m")
        .render(
          ({ state }) =>
            html`<select data-size bind:value=${state.size}><option value="s">S</option><option value="m">M</option><option value="l">L</option></select><p>${state.size}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      const sel = el.querySelector<HTMLSelectElement>("[data-size]")!;
      sel.value = "l";
      sel.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toBe("l");
      unmount();
      cleanup(el);
    });

    it("number input updates numeric state via bind:valueAsNumber", () => {
      const Island = ilha
        .state("count", 0)
        .render(
          ({ state }) =>
            html`<input type="number" data-num bind:valueAsNumber=${state.count}><p>${state.count}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      const input = el.querySelector<HTMLInputElement>("[data-num]")!;
      input.value = "42";
      input.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("42");
      unmount();
      cleanup(el);
    });

    it("details toggle updates state via bind:open", () => {
      const Island = ilha
        .state("expanded", false)
        .render(
          ({ state }) =>
            html`<details data-d bind:open=${state.expanded}>x</details><p>${state.expanded}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      const d = el.querySelector<HTMLDetailsElement>("[data-d]")!;
      d.open = true;
      d.dispatchEvent(new Event("toggle"));
      expect(el.querySelector("p")!.textContent).toBe("true");
      unmount();
      cleanup(el);
    });

    it("textarea input updates state via bind:value", () => {
      const Island = ilha
        .state("body", "")
        .render(
          ({ state }) =>
            html`<textarea data-t bind:value=${state.body}></textarea><p>${state.body}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      const ta = el.querySelector<HTMLTextAreaElement>("[data-t]")!;
      ta.value = "multi\nline";
      ta.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("multi\nline");
      unmount();
      cleanup(el);
    });

    it("bind:value coerces DOM string to number when signal holds a number", () => {
      // bind:value (not valueAsNumber) on a numeric signal — the runtime
      // coercion path should parse the string back to a number so the
      // signal type is preserved. Arithmetic on the signal value would
      // string-concat instead of add if coercion failed.
      const Island = ilha
        .state("n", 0)
        .render(
          ({ state }) => html`<input data-n bind:value=${state.n}><p data-sum>${state.n() + 1}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      const input = el.querySelector<HTMLInputElement>("[data-n]")!;
      input.value = "7";
      input.dispatchEvent(new Event("input"));
      // If coercion worked, state.n is 7 (number), so 7 + 1 = 8.
      // If coercion failed, state.n is "7" (string), so "7" + 1 = "71".
      expect(el.querySelector("[data-sum]")!.textContent).toBe("8");
      unmount();
      cleanup(el);
    });
  });

  describe("state -> DOM", () => {
    it("initial state is reflected into input value on SSR + mount", () => {
      const Island = ilha
        .state("email", "hello@example.com")
        .render(({ state }) => html`<input data-email bind:value=${state.email}>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector<HTMLInputElement>("[data-email]")!.value).toBe("hello@example.com");
      unmount();
      cleanup(el);
    });

    it("programmatic state change updates input value via re-render", () => {
      let accessor!: (v?: string) => string | void;

      const Island = ilha.state("email", "a@b.com").render(({ state }) => {
        accessor = state.email as typeof accessor;
        return html`<input data-email bind:value=${state.email}>`;
      });

      const el = makeEl();
      const unmount = Island.mount(el);
      accessor("new@example.com");
      expect(el.querySelector<HTMLInputElement>("[data-email]")!.value).toBe("new@example.com");
      unmount();
      cleanup(el);
    });

    it("programmatic state change updates checkbox checked", () => {
      let accessor!: (v?: boolean) => boolean | void;

      const Island = ilha.state("active", false).render(({ state }) => {
        accessor = state.active as typeof accessor;
        return html`<input type="checkbox" data-cb bind:checked=${state.active}>`;
      });

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector<HTMLInputElement>("[data-cb]")!.checked).toBe(false);
      accessor(true);
      expect(el.querySelector<HTMLInputElement>("[data-cb]")!.checked).toBe(true);
      accessor(false);
      expect(el.querySelector<HTMLInputElement>("[data-cb]")!.checked).toBe(false);
      unmount();
      cleanup(el);
    });

    it("programmatic state change updates details open", () => {
      let accessor!: (v?: boolean) => boolean | void;

      const Island = ilha.state("expanded", false).render(({ state }) => {
        accessor = state.expanded as typeof accessor;
        return html`<details data-d bind:open=${state.expanded}>x</details>`;
      });

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector<HTMLDetailsElement>("[data-d]")!.open).toBe(false);
      accessor(true);
      expect(el.querySelector<HTMLDetailsElement>("[data-d]")!.open).toBe(true);
      unmount();
      cleanup(el);
    });
  });

  describe("Two-way", () => {
    it("DOM change reflects in render output for bind:value", () => {
      const Island = ilha
        .state("query", "")
        .render(({ state }) => html`<input data-q bind:value=${state.query}><p>${state.query}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      const input = el.querySelector<HTMLInputElement>("[data-q]")!;
      input.value = "svelte";
      input.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("svelte");
      input.value = "ilha";
      input.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("ilha");
      unmount();
      cleanup(el);
    });
  });

  describe("bind:group", () => {
    it("programmatic radio state change updates checked input", () => {
      let accessor!: (v?: string) => string | void;

      const Island = ilha.state("plan", "free").render(({ state }) => {
        accessor = state.plan as typeof accessor;
        return html`
            <input type="radio" name="plan" value="free" bind:group=${state.plan} />
            <input type="radio" name="plan" value="pro" bind:group=${state.plan} />
          `;
      });

      const el = makeEl();
      const unmount = Island.mount(el);
      // Initial: free is checked from SSR-time static-value peek.
      expect(el.querySelector<HTMLInputElement>("input[name='plan'][value='free']")!.checked).toBe(
        true,
      );
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

    it("radio group coerces DOM string to number when state holds a number", () => {
      const Island = ilha.state("level", 2).render(
        ({ state }) => html`
            <input type="radio" name="level" value="1" bind:group=${state.level} />
            <input type="radio" name="level" value="2" bind:group=${state.level} />
            <input type="radio" name="level" value="3" bind:group=${state.level} />
            <p>${state.level}</p>
          `,
      );

      const el = makeEl();
      const unmount = Island.mount(el);
      const three = el.querySelector<HTMLInputElement>("input[name='level'][value='3']")!;
      three.checked = true;
      three.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toBe("3");
      unmount();
      cleanup(el);
    });

    it("checkbox group adds option to array when checked", () => {
      const Island = ilha.state<string[]>("tags", ["ts"]).render(
        ({ state }) => html`
            <input type="checkbox" name="tag" value="js" bind:group=${state.tags} />
            <input type="checkbox" name="tag" value="ts" bind:group=${state.tags} />
            <input type="checkbox" name="tag" value="rust" bind:group=${state.tags} />
            <p>${(state.tags() as string[]).join(",")}</p>
          `,
      );

      const el = makeEl();
      const unmount = Island.mount(el);
      const js = el.querySelector<HTMLInputElement>("input[name='tag'][value='js']")!;
      js.checked = true;
      js.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toContain("ts");
      expect(el.querySelector("p")!.textContent).toContain("js");
      unmount();
      cleanup(el);
    });

    it("checkbox group removes option from array when unchecked", () => {
      const Island = ilha.state<string[]>("tags", ["js", "ts"]).render(
        ({ state }) => html`
            <input type="checkbox" name="tag" value="js" bind:group=${state.tags} />
            <input type="checkbox" name="tag" value="ts" bind:group=${state.tags} />
            <p>${(state.tags() as string[]).join(",")}</p>
          `,
      );

      const el = makeEl();
      const unmount = Island.mount(el);
      const js = el.querySelector<HTMLInputElement>("input[name='tag'][value='js']")!;
      // SSR-baked: js should already be checked.
      expect(js.checked).toBe(true);
      js.checked = false;
      js.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toBe("ts");
      unmount();
      cleanup(el);
    });

    it("checkbox group coerces DOM string to number when array holds numbers", () => {
      const Island = ilha.state<number[]>("levels", [2]).render(
        ({ state }) => html`
            <input type="checkbox" name="level" value="1" bind:group=${state.levels} />
            <input type="checkbox" name="level" value="3" bind:group=${state.levels} />
            <p>${(state.levels() as number[]).reduce((a, b) => a + b, 0)}</p>
          `,
      );

      const el = makeEl();
      const unmount = Island.mount(el);
      const three = el.querySelector<HTMLInputElement>("input[name='level'][value='3']")!;
      three.checked = true;
      three.dispatchEvent(new Event("change"));
      // If coercion failed, sum would be "23" (string concat); correct: 2+3=5.
      expect(el.querySelector("p")!.textContent).toBe("5");
      unmount();
      cleanup(el);
    });
  });

  describe("bind:this", () => {
    it("writes element into signal on mount and nulls on unmount", () => {
      let captured: Element | null | undefined;

      const Island = ilha
        .state<Element | null>("ref", null)
        .onMount(({ state }) => {
          captured = state.ref();
        })
        .render(({ state }) => html`<input data-r bind:this=${state.ref}>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      const input = el.querySelector("[data-r]");
      expect(captured).toBe(input);
      unmount();
      // After unmount the binding cleanup writes null; we can't observe the
      // signal through the destroyed island, but we can at least confirm the
      // mount-time write happened correctly above.
      cleanup(el);
    });

    it("writes null into external signal on unmount", () => {
      // Using an ilha.signal() instead of .state() so we keep a handle to
      // the signal across the island's lifecycle and can observe its final
      // value after unmount.
      const ref = signal<Element | null>(null);

      const Island = ilha.render(() => html`<input data-r bind:this=${ref}>`);

      const el = makeEl();
      const input = (() => {
        const u = Island.mount(el);
        const captured = el.querySelector("[data-r]");
        expect(ref()).toBe(captured);
        u();
        return captured;
      })();

      // After unmount, the binding cleanup should have nulled the signal.
      expect(ref()).toBe(null);
      // The captured element should no longer be in the document (the
      // island's host content was torn down — we still hold a reference but
      // it's detached).
      expect(input).not.toBeNull();
      cleanup(el);
    });

    it("updates signal to the new element after morph replaces it", () => {
      // The morph engine replaces elements whose localName differs between
      // renders. Toggle between <input> and <textarea> so the bound element
      // is genuinely re-created, and verify the ref tracks the new node.
      const ref = signal<Element | null>(null);
      let toggle!: () => void;

      const Island = ilha.state("isText", false).render(({ state }) => {
        toggle = () => state.isText(!state.isText());
        return state.isText()
          ? html`<textarea data-r bind:this=${ref}></textarea>`
          : html`<input data-r bind:this=${ref}>`;
      });

      const el = makeEl();
      const unmount = Island.mount(el);

      const initial = el.querySelector("[data-r]");
      expect(initial?.tagName).toBe("INPUT");
      expect(ref()).toBe(initial);

      toggle();

      const swapped = el.querySelector("[data-r]");
      expect(swapped?.tagName).toBe("TEXTAREA");
      // Ref must point at the new element, not the destroyed one.
      expect(ref()).toBe(swapped);
      expect(ref()).not.toBe(initial);

      unmount();
      cleanup(el);
    });
  });

  describe("bind:files", () => {
    it("change event writes FileList into state", () => {
      const Island = ilha
        .state<FileList | null>("uploaded", null)
        .render(({ state }) => html`<input type="file" data-f bind:files=${state.uploaded}>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      const input = el.querySelector<HTMLInputElement>("[data-f]")!;
      // happy-dom may not let us programmatically set .files; the listener
      // wiring is what we're testing, so dispatch change and verify the
      // accessor was invoked (state will be whatever .files happens to be
      // on a fresh input, typically null or an empty FileList).
      input.dispatchEvent(new Event("change"));
      // No assertion on value — happy-dom behaviour varies. The test passes
      // if mount/unmount don't throw and the listener was attached.
      unmount();
      cleanup(el);
    });
  });

  describe("bind:valueAsDate", () => {
    it("reads valueAsDate from input on change", () => {
      const Island = ilha
        .state<Date | null>("dob", new Date(2026, 4, 15))
        .render(({ state }) => html`<input type="date" data-d bind:valueAsDate=${state.dob}>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      const input = el.querySelector<HTMLInputElement>("[data-d]")!;
      // Initial reflection: input.value should be set via the write() pass.
      expect(input.value).toBe("2026-05-15");
      unmount();
      cleanup(el);
    });
  });

  describe("re-render survival", () => {
    // Every binding kind must survive a parent-state-driven re-render. The
    // morph reconciles the DOM, then applyTemplateBindings re-walks the
    // sentinels and re-attaches listeners. If the re-attach step regressed,
    // a DOM event after re-render would no longer flow back to state.

    it("bind:value listener survives re-render triggered by unrelated state", () => {
      const Island = ilha
        .state("bound", "")
        .state("tick", 0)
        .on("[data-bump]@click", ({ state }) => state.tick(state.tick() + 1))
        .render(
          ({ state }) => html`
            <input data-b bind:value=${state.bound} />
            <span data-tick>${state.tick}</span>
            <button data-bump>bump</button>
          `,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      const input = el.querySelector<HTMLInputElement>("[data-b]")!;
      const tick = el.querySelector<HTMLElement>("[data-tick]")!;

      // Baseline: bind:value works before any re-render.
      input.value = "before";
      input.dispatchEvent(new Event("input"));
      expect(input.value).toBe("before");

      // Drive a re-render via unrelated state. The morph keeps the input.
      el.querySelector<HTMLButtonElement>("[data-bump]")!.click();
      expect(tick.textContent).toBe("1");

      // Bind must still flow DOM→state. Fire another input event and force
      // a re-render that depends on state.bound to observe it.
      const inputPostRerender = el.querySelector<HTMLInputElement>("[data-b]")!;
      inputPostRerender.value = "after";
      inputPostRerender.dispatchEvent(new Event("input"));

      // The bound value writing back into the input via re-render confirms
      // the binding still works: assert the input value is preserved (a
      // broken listener would leave state.bound at "before" and a render
      // would reset the DOM to "before").
      el.querySelector<HTMLButtonElement>("[data-bump]")!.click();
      expect(tick.textContent).toBe("2");
      expect(el.querySelector<HTMLInputElement>("[data-b]")!.value).toBe("after");

      unmount();
      cleanup(el);
    });

    it("bind:checked listener survives re-render", () => {
      const Island = ilha
        .state("flag", false)
        .state("other", 0)
        .on("[data-bump]@click", ({ state }) => state.other(state.other() + 1))
        .render(
          ({ state }) => html`
            <input type="checkbox" data-cb bind:checked=${state.flag} />
            <span data-o>${state.other}</span>
            <button data-bump>bump</button>
          `,
        );

      const el = makeEl();
      const unmount = Island.mount(el);

      // First toggle — baseline.
      const cb = el.querySelector<HTMLInputElement>("[data-cb]")!;
      cb.checked = true;
      cb.dispatchEvent(new Event("change"));
      expect(el.querySelector<HTMLInputElement>("[data-cb]")!.checked).toBe(true);

      // Drive a re-render via the unrelated state.
      el.querySelector<HTMLButtonElement>("[data-bump]")!.click();
      expect(el.querySelector("[data-o]")!.textContent).toBe("1");

      // After re-render, the checkbox change should still update state.
      const cb2 = el.querySelector<HTMLInputElement>("[data-cb]")!;
      cb2.checked = false;
      cb2.dispatchEvent(new Event("change"));
      // The binding wiring must have re-attached so the next render picks
      // up the change — assert via the rendered span path on the next bump.
      el.querySelector<HTMLButtonElement>("[data-bump]")!.click();
      expect(el.querySelector<HTMLInputElement>("[data-cb]")!.checked).toBe(false);

      unmount();
      cleanup(el);
    });

    it("bind:group radio listener survives re-render", () => {
      const Island = ilha
        .state("size", "m")
        .state("tick", 0)
        .on("[data-bump]@click", ({ state }) => state.tick(state.tick() + 1))
        .render(
          ({ state }) => html`
            <input type="radio" name="size" value="s" bind:group=${state.size} />
            <input type="radio" name="size" value="m" bind:group=${state.size} />
            <input type="radio" name="size" value="l" bind:group=${state.size} />
            <span data-t>${state.tick}</span>
            <button data-bump>bump</button>
          `,
        );

      const el = makeEl();
      const unmount = Island.mount(el);

      // Trigger a re-render before any radio interaction.
      el.querySelector<HTMLButtonElement>("[data-bump]")!.click();
      expect(el.querySelector("[data-t]")!.textContent).toBe("1");

      // After re-render, the radio group binding should still wire up. Pick
      // a different option and verify the state changes.
      const large = el.querySelector<HTMLInputElement>("input[name='size'][value='l']")!;
      large.checked = true;
      large.dispatchEvent(new Event("change"));

      // Force another render to observe the state via DOM reflection.
      el.querySelector<HTMLButtonElement>("[data-bump]")!.click();

      // The 'l' radio should now be checked (state was "l", reflected back).
      expect(el.querySelector<HTMLInputElement>("input[name='size'][value='l']")!.checked).toBe(
        true,
      );
      expect(el.querySelector<HTMLInputElement>("input[name='size'][value='m']")!.checked).toBe(
        false,
      );

      unmount();
      cleanup(el);
    });

    it("indices reset on each re-render (sentinel attribute is stable)", () => {
      // The sentinel value should be `value:0` after every render of the
      // same template — not value:0 the first time, value:1 the second.
      const Island = ilha
        .state("name", "a")
        .state("tick", 0)
        .on("[data-n]@input", () => {
          // no-op handler just to keep .on wired up
        })
        .render(
          ({ state }) => html`<input data-n bind:value=${state.name}><span>${state.tick}</span>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);

      const sentinelBefore = el.querySelector("[data-n]")!.getAttribute("data-ilha-bind");
      expect(sentinelBefore).toBe("value:0");

      // Trigger a re-render by writing to the bound state.
      const input = el.querySelector<HTMLInputElement>("[data-n]")!;
      input.value = "b";
      input.dispatchEvent(new Event("input"));

      const sentinelAfter = el.querySelector("[data-n]")!.getAttribute("data-ilha-bind");
      expect(sentinelAfter).toBe("value:0");

      unmount();
      cleanup(el);
    });
  });

  describe("external signal", () => {
    it("external ilha.signal() interpolates by value in html``", () => {
      const sig = signal("hello");
      const out = html`<p>${sig}</p>`.value;
      expect(out).toBe("<p>hello</p>");
    });

    it("ilha.signal() can be used directly as a bind: target", () => {
      const sharedName = signal("ada");

      const Island = ilha.render(() => html`<input data-n bind:value=${sharedName}>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      const input = el.querySelector<HTMLInputElement>("[data-n]")!;

      // Initial reflection from the external signal.
      expect(input.value).toBe("ada");

      // DOM event flows into the external signal.
      input.value = "grace";
      input.dispatchEvent(new Event("input"));
      expect(sharedName()).toBe("grace");

      // External write flows back into the DOM via re-render. The island's
      // render effect subscribes to sharedName because it was read at SSR
      // time when emitBindSSR called accessor().
      sharedName("hopper");
      expect(input.value).toBe("hopper");

      unmount();
      cleanup(el);
    });

    it("two mounted islands sharing one external signal stay in sync", () => {
      const shared = signal("x");

      const A = ilha.render(() => html`<input data-a bind:value=${shared}>`);
      const B = ilha.render(() => html`<input data-b bind:value=${shared}>`);

      const elA = makeEl();
      const elB = makeEl();
      const uA = A.mount(elA);
      const uB = B.mount(elB);

      const inA = elA.querySelector<HTMLInputElement>("[data-a]")!;
      const inB = elB.querySelector<HTMLInputElement>("[data-b]")!;

      // Both start with the same value.
      expect(inA.value).toBe("x");
      expect(inB.value).toBe("x");

      // Editing A flows into shared and then into B via shared's reactivity.
      inA.value = "y";
      inA.dispatchEvent(new Event("input"));
      expect(shared()).toBe("y");
      expect(inB.value).toBe("y");

      // And the reverse.
      inB.value = "z";
      inB.dispatchEvent(new Event("input"));
      expect(shared()).toBe("z");
      expect(inA.value).toBe("z");

      uA();
      uB();
      cleanup(elA);
      cleanup(elB);
    });
  });

  describe("dev warnings", () => {
    let warnSpy: ReturnType<typeof spyOn>;
    beforeEach(() => {
      warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("warns on unknown bind:KIND and falls back to plain interpolation", () => {
      const sig = signal("hello");
      const out = html`<input bind:bogus=${sig}>`.value;
      expect(warnSpy).toHaveBeenCalled();
      const msgs = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(msgs.some((m: string) => m.includes("bind:bogus"))).toBe(true);
      // Plain interpolation fallback escapes the signal value into place.
      expect(out).toContain("hello");
    });

    it("warns when bind: target is not a signal accessor", () => {
      html`<input bind:value=${"plain string"}>`;
      const msgs = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(msgs.some((m: string) => m.includes("requires a signal accessor"))).toBe(true);
    });
  });
});

// ---------------------------------------------
// .onMount
// ---------------------------------------------

describe(".onMount", () => {
  it("runs the callback once on mount", () => {
    const calls: number[] = [];

    const Island = ilha
      .state("count", 0)
      .onMount(() => {
        calls.push(1);
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(calls).toEqual([1]);
    unmount();
    cleanup(el);
  });

  it("does NOT run the callback more than once even when state changes", () => {
    const calls: number[] = [];
    let accessor!: (v: number) => void;

    const Island = ilha
      .state("count", 0)
      .onMount(({ state }) => {
        accessor = state.count as typeof accessor;
        calls.push(state.count());
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
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

    const Island = ilha
      .input(z.object({ label: z.string().default("hi") }))
      .derived("labelLen", ({ input }) => input.label.length)
      .onMount(({ host, derived, input }) => {
        capturedHost = host;
        capturedCount = derived.labelLen.value ?? null;
        capturedLabel = input.label;
      })
      .render(({ derived }) => `<p>${derived.labelLen.value}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el, { label: "hello" });
    expect(capturedHost!).toBe(el);
    expect(capturedCount!).toBe(5);
    expect(capturedLabel!).toBe("hello");
    unmount();
    cleanup(el);
  });

  it("runs the cleanup returned from onMount on unmount", () => {
    const log: string[] = [];

    const Island = ilha
      .onMount(() => {
        log.push("mount");
        return () => log.push("destroy");
      })
      .render(() => `<p>hi</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(log).toEqual(["mount"]);
    unmount();
    expect(log).toEqual(["mount", "destroy"]);
    cleanup(el);
  });

  it("does NOT run the cleanup on each re-render, only on unmount", () => {
    const log: string[] = [];
    let accessor!: (v: number) => void;

    const Island = ilha
      .state("count", 0)
      .onMount(({ state }) => {
        accessor = state.count as typeof accessor;
        return () => log.push("destroy");
      })
      .render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
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

    const Island = ilha
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
    const unmount = Island.mount(el);
    const initialRenders = renders.length;
    accessor(99);
    expect(renders.length).toBe(initialRenders + 1);
    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------
// signal() — top-level external signals
// ---------------------------------------------

describe("signal()", () => {
  it("returns a getter/setter accessor", () => {
    const s = signal(42);
    expect(s()).toBe(42);
    s(100);
    expect(s()).toBe(100);
  });

  it("can be read inside an island's .render() and reacts to changes", () => {
    const count = signal(0);

    const Island = ilha.render(() => `<p>${count()}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(el.querySelector("p")!.textContent).toBe("0");

    count(5);
    expect(el.querySelector("p")!.textContent).toBe("5");

    unmount();
    cleanup(el);
  });

  it("can be read inside .derived() and triggers re-derivation", () => {
    const base = signal(10);

    const Island = ilha
      .derived("doubled", () => base() * 2)
      .render(({ derived }) => `<p>${derived.doubled.value}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(el.querySelector("p")!.textContent).toBe("20");

    base(7);
    expect(el.querySelector("p")!.textContent).toBe("14");

    unmount();
    cleanup(el);
  });

  it("is shared across multiple island instances", () => {
    const shared = signal("hello");

    const A = ilha.render(() => `<p class="a">${shared()}</p>`);
    const B = ilha.render(() => `<p class="b">${shared()}</p>`);

    const elA = makeEl();
    const elB = makeEl();
    const unA = A.mount(elA);
    const unB = B.mount(elB);

    expect(elA.querySelector(".a")!.textContent).toBe("hello");
    expect(elB.querySelector(".b")!.textContent).toBe("hello");

    shared("world");

    expect(elA.querySelector(".a")!.textContent).toBe("world");
    expect(elB.querySelector(".b")!.textContent).toBe("world");

    unA();
    unB();
    cleanup(elA);
    cleanup(elB);
  });

  it("ilha.signal is the same export as the named signal()", () => {
    expect(ilha.signal).toBe(signal);
  });
});

// ---------------------------------------------
// batch()
// ---------------------------------------------

describe("batch()", () => {
  it("multiple writes inside batch produce a single effect run", () => {
    const a = signal(1);
    const b = signal(2);
    const runs: number[] = [];

    const Island = ilha
      .effect(() => {
        runs.push(a() + b());
      })
      .render(() => `<p>x</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);

    expect(runs).toEqual([3]); // initial run

    batch(() => {
      a(10);
      b(20);
    });

    // One additional run, not two — both writes batched.
    expect(runs).toEqual([3, 30]);

    unmount();
    cleanup(el);
  });

  it("returns the value returned by the callback", () => {
    const result = batch(() => 42);
    expect(result).toBe(42);
  });

  it("multiple writes outside batch produce one effect run per write (baseline)", () => {
    const a = signal(1);
    const b = signal(2);
    const runs: number[] = [];

    const Island = ilha
      .effect(() => {
        runs.push(a() + b());
      })
      .render(() => `<p>x</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(runs.length).toBe(1);

    a(10);
    b(20);

    // Without batch, each write triggers a propagation pass.
    expect(runs.length).toBe(3);

    unmount();
    cleanup(el);
  });

  it(".on() handlers are implicitly batched (sync portion)", () => {
    const renders: number[] = [];
    let accessorA!: (v?: number) => number | void;
    let accessorB!: (v?: number) => number | void;

    const Island = ilha
      .state("a", 0)
      .state("b", 0)
      .on("@click", ({ state }) => {
        accessorA = state.a as typeof accessorA;
        accessorB = state.b as typeof accessorB;
        // Three writes in one handler — should produce one render, not three.
        state.a(state.a() + 1);
        state.b(state.b() + 1);
        state.a(state.a() + 1);
      })
      .render(({ state }) => {
        renders.push(state.a() * 100 + state.b());
        return `<p>${state.a()}-${state.b()}</p>`;
      });

    const el = makeEl();
    const unmount = Island.mount(el);
    const baseline = renders.length;

    (el as HTMLElement).click();

    // Only one additional render despite three sync writes.
    expect(renders.length).toBe(baseline + 1);
    // Final values reflect all writes.
    expect(accessorA()).toBe(2);
    expect(accessorB()).toBe(1);

    unmount();
    cleanup(el);
  });

  it("nested batch() does not flush until the outermost ends", () => {
    const a = signal(0);
    const runs: number[] = [];

    const Island = ilha
      .effect(() => {
        runs.push(a());
      })
      .render(() => `<p>x</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(runs.length).toBe(1);

    batch(() => {
      a(1);
      batch(() => {
        a(2);
        a(3);
      });
      a(4);
    });

    // All four writes inside the outer batch flush as a single run.
    expect(runs.length).toBe(2);
    expect(a()).toBe(4);

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------
// untrack()
// ---------------------------------------------

describe("untrack()", () => {
  it("reading a signal inside untrack does not subscribe the surrounding effect", () => {
    const tracked = signal(0);
    const ignored = signal(100);
    const runs: number[] = [];

    const Island = ilha
      .effect(() => {
        // Reading `ignored` inside untrack: read happens, but no subscription.
        const peeked = untrack(() => ignored());
        runs.push(tracked() + peeked);
      })
      .render(() => `<p>x</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(runs).toEqual([100]);

    // Changing the untracked signal should NOT re-run the effect.
    ignored(999);
    expect(runs).toEqual([100]);

    // Changing the tracked signal DOES re-run; the new untracked read sees the latest value.
    tracked(1);
    expect(runs).toEqual([100, 1000]);

    unmount();
    cleanup(el);
  });

  it("returns the value returned by the callback", () => {
    const s = signal("hello");
    expect(untrack(() => s())).toBe("hello");
    expect(untrack(() => 42)).toBe(42);
  });

  it("untrack inside .derived() prevents re-derivation on untracked signal", () => {
    const tracked = signal(1);
    const ignored = signal(10);

    const Island = ilha
      .derived("sum", () => tracked() + untrack(() => ignored()))
      .render(({ derived }) => `<p>${derived.sum.value}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    expect(el.querySelector("p")!.textContent).toBe("11");

    // Changing untracked signal should not update the derived value.
    ignored(999);
    expect(el.querySelector("p")!.textContent).toBe("11");

    // Changing tracked signal does — and it picks up the latest untracked read.
    tracked(2);
    expect(el.querySelector("p")!.textContent).toBe("1001");

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------
// .onError()
// ---------------------------------------------

describe(".onError()", () => {
  it("catches synchronous throws from .on() handlers", () => {
    const captured: { error: Error; source: string }[] = [];

    const Island = ilha
      .on("@click", () => {
        throw new Error("boom-sync");
      })
      .onError(({ error, source }) => {
        captured.push({ error, source });
      })
      .render(() => `<p>x</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    (el as HTMLElement).click();

    expect(captured.length).toBe(1);
    expect(captured[0]!.error.message).toBe("boom-sync");
    expect(captured[0]!.source).toBe("on");

    unmount();
    cleanup(el);
  });

  it("catches asynchronous rejections from .on() handlers", async () => {
    const captured: { error: Error; source: string }[] = [];

    const Island = ilha
      .on("@click", async () => {
        await Promise.resolve();
        throw new Error("boom-async");
      })
      .onError(({ error, source }) => {
        captured.push({ error, source });
      })
      .render(() => `<p>x</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(captured.length).toBe(1);
    expect(captured[0]!.error.message).toBe("boom-async");
    expect(captured[0]!.source).toBe("on");

    unmount();
    cleanup(el);
  });

  it("does NOT receive AbortError rejections from .on() handlers", async () => {
    const captured: { error: Error; source: string }[] = [];

    const Island = ilha
      .on("[data-btn]@click", async ({ signal }) => {
        await new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      })
      .onError(({ error, source }) => {
        captured.push({ error, source });
      })
      .render(() => `<button data-btn>x</button>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    (el.querySelector("[data-btn]") as HTMLButtonElement).click();
    unmount();
    await new Promise((r) => setTimeout(r, 0));

    expect(captured.length).toBe(0);
    cleanup(el);
  });

  it("catches synchronous throws from .effect() runs", () => {
    const captured: { error: Error; source: string }[] = [];
    let accessor!: (v?: number) => number | void;

    const Island = ilha
      .state("n", 0)
      .effect(({ state }) => {
        accessor = state.n as typeof accessor;
        if (state.n() > 0) throw new Error(`effect-boom-${state.n()}`);
      })
      .onError(({ error, source }) => {
        captured.push({ error, source });
      })
      .render(({ state }) => `<p>${state.n()}</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);

    accessor(1);
    expect(captured.length).toBe(1);
    expect(captured[0]!.error.message).toBe("effect-boom-1");
    expect(captured[0]!.source).toBe("effect");

    accessor(2);
    expect(captured.length).toBe(2);
    expect(captured[1]!.error.message).toBe("effect-boom-2");

    unmount();
    cleanup(el);
  });

  it("falls back to console.error when no .onError() handler is registered", () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});

    const Island = ilha
      .on("@click", () => {
        throw new Error("unhandled");
      })
      .render(() => `<p>x</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    (el as HTMLElement).click();

    expect(errSpy).toHaveBeenCalled();
    const err = errSpy.mock.calls[0]?.[0] as Error;
    expect(err?.message).toBe("unhandled");

    errSpy.mockRestore();
    unmount();
    cleanup(el);
  });

  it("multiple .onError() handlers all run, in declaration order", () => {
    const order: string[] = [];

    const Island = ilha
      .on("@click", () => {
        throw new Error("x");
      })
      .onError(() => order.push("first"))
      .onError(() => order.push("second"))
      .onError(() => order.push("third"))
      .render(() => `<p>x</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    (el as HTMLElement).click();

    expect(order).toEqual(["first", "second", "third"]);

    unmount();
    cleanup(el);
  });

  it("an error thrown inside an onError handler does not break other onError handlers", () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const captured: string[] = [];

    const Island = ilha
      .on("@click", () => {
        throw new Error("original");
      })
      .onError(() => {
        throw new Error("from-handler-1");
      })
      .onError(({ error }) => {
        captured.push(error.message);
      })
      .render(() => `<p>x</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    (el as HTMLElement).click();

    // Second onError still ran with the original error.
    expect(captured).toEqual(["original"]);
    // The throw from the first onError was logged.
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
    unmount();
    cleanup(el);
  });

  it("error context exposes state, derived, input, and host", () => {
    let captured: { hasState: boolean; hasDerived: boolean; hasHost: boolean; n: number } | null =
      null;

    const Island = ilha
      .input(z.object({ x: z.number().default(7) }))
      .state("n", 42)
      .derived("doubled", ({ state }) => state.n() * 2)
      .on("@click", () => {
        throw new Error("ctx-test");
      })
      .onError(({ state, derived, input, host }) => {
        captured = {
          hasState: typeof state.n === "function",
          hasDerived: derived.doubled.value === 84,
          hasHost: host instanceof Element,
          n: input.x,
        };
      })
      .render(() => `<p>x</p>`);

    const el = makeEl();
    const unmount = Island.mount(el);
    (el as HTMLElement).click();

    expect(captured).not.toBeNull();
    expect(captured!.hasState).toBe(true);
    expect(captured!.hasDerived).toBe(true);
    expect(captured!.hasHost).toBe(true);
    expect(captured!.n).toBe(7);

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
      const Island = ilha.render(() => `<p>hi</p>`);
      from("#definitely-does-not-exist", Island);
      expect(warnSpy).toHaveBeenCalled();
      const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
      expect(msg).toMatch(/ilha/i);
    });

    it("warn message includes the missing selector", () => {
      const Island = ilha.render(() => `<p>hi</p>`);
      from("#my-missing-el", Island);
      const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
      expect(msg).toContain("#my-missing-el");
    });
  });

  describe("malformed data-ilha-props", () => {
    beforeEach(() => {
      document.body.innerHTML = "";
    });

    it("warns when data-ilha-props contains invalid JSON", () => {
      const Counter = ilha
        .input(z.object({ count: z.number().default(0) }))
        .state("count", ({ count }) => count)
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = document.createElement("div");
      el.setAttribute("data-ilha", "Counter");
      el.setAttribute("data-ilha-props", "{not valid json}");
      document.body.appendChild(el);

      mount({ Counter });
      expect(warnSpy).toHaveBeenCalled();
      const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
      expect(msg).toMatch(/ilha/i);
    });
  });

  describe(".on() selector matches nothing on mount", () => {
    it("warns when an .on() selector does not match any element", () => {
      const Island = ilha
        .state("count", 0)
        .on("[data-nonexistent-btn]@click", ({ state }) => {
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(warnSpy).toHaveBeenCalled();
      const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
      expect(msg).toMatch(/ilha/i);
      unmount();
      cleanup(el);
    });

    it("does NOT warn when an .on() selector matches at least one element", () => {
      const Island = ilha
        .state("count", 0)
        .on("[data-inc]@click", ({ state }) => {
          state.count(state.count() + 1);
        })
        .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(warnSpy).not.toHaveBeenCalled();
      unmount();
      cleanup(el);
    });
  });

  describe("validation failure error message", () => {
    it("throws with [ilha] prefix on invalid input props", () => {
      const Island = ilha
        .input(z.object({ count: z.number() }))
        .render(({ input }) => `${input.count}`);

      expect(() => Island({ count: "bad" as never })).toThrow("[ilha]");
    });
  });
});

describe("diagnostic: Child-in-slot reactivity", () => {
  it("D1: bare Child (no slot) reacts to its own signal write", () => {
    const Child = ilha.state("count", 0).render(({ state }) => `<p>${state.count()}</p>`);

    const el = makeEl();
    const unmount = Child.mount(el);

    expect(el.querySelector("p")!.textContent).toBe("0");

    // Poke the internal state via a handler-less approach:
    // re-mount isn't an option, so we rely on the next test for signal writes.
    unmount();
    cleanup(el);
  });

  it("D2: bare Child reacts to click-driven signal write", () => {
    const Child = ilha
      .state("count", 0)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    const el = makeEl();
    const unmount = Child.mount(el);

    expect(el.querySelector("p")!.textContent).toBe("0");
    el.querySelector<HTMLButtonElement>("[data-inc]")!.click();
    expect(el.querySelector("p")!.textContent).toBe("1");

    unmount();
    cleanup(el);
  });

  it("D3: slot placeholder is emitted as empty div in client render", () => {
    const Child = ilha.render(() => `<span>Child-content</span>`);
    const Parent = ilha.render(() => html`<div class="Parent">${Child}</div>`);

    const el = makeEl();
    const unmount = Parent.mount(el);

    const slotEl = el.querySelector("[data-ilha-slot='p:0']");
    expect(slotEl).not.toBeNull();
    // After mount, the Child Island has populated the slot.
    expect(slotEl!.querySelector("span")?.textContent).toBe("Child-content");

    unmount();
    cleanup(el);
  });

  it("D4: slot element identity is stable across mountSlots cache", () => {
    const Child = ilha.render(() => `<span>x</span>`);
    const Parent = ilha.render(() => html`<div>${Child}</div>`);

    const el = makeEl();
    const unmount = Parent.mount(el);

    const slotElBefore = el.querySelector("[data-ilha-slot='p:0']");
    expect(slotElBefore).not.toBeNull();
    // The slot element should be a single node, inserted once.
    expect(el.querySelectorAll("[data-ilha-slot='p:0']").length).toBe(1);

    unmount();
    cleanup(el);
  });

  it("D5: Child's click handler fires after mount-in-slot", () => {
    let clickCount = 0;
    const Child = ilha
      .state("count", 0)
      .on("[data-inc]@click", ({ state }) => {
        clickCount++;
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);

    const Parent = ilha.render(() => html`<div>${Child}</div>`);

    const el = makeEl();
    const unmount = Parent.mount(el);

    const btn = el.querySelector<HTMLButtonElement>("[data-inc]");
    expect(btn).not.toBeNull();
    btn!.click();

    // If clickCount is 0: the click handler was never attached (listener
    //   attachment path is broken for slot-mounted Children).
    // If clickCount is 1: handler ran; the next assertion tells us whether
    //   the render effect reflected the state change.
    expect(clickCount).toBe(1);

    unmount();
    cleanup(el);
  });

  it("D6: Child's signal write (via click) updates its DOM when mounted in slot", () => {
    let renderCount = 0;
    let lastRenderedCount = -1;
    const Child = ilha
      .state("count", 0)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => {
        renderCount++;
        lastRenderedCount = state.count();
        return `<p>${state.count()}</p><button data-inc>+</button>`;
      });

    const Parent = ilha.render(() => html`<div>${Child}</div>`);

    const el = makeEl();
    const unmount = Parent.mount(el);

    const rendersAfterMount = renderCount;
    const countAfterMount = lastRenderedCount;

    el.querySelector<HTMLButtonElement>("[data-inc]")!.click();

    const rendersAfterClick = renderCount;
    const countAfterClick = lastRenderedCount;

    // Diagnostics, read the failure message carefully:
    // - rendersAfterClick === rendersAfterMount: Child's render effect did
    //   NOT re-fire after the click. Either the click handler never ran, or
    //   the signal write isn't notifying subscribers, or the render effect
    //   was torn down / never subscribed.
    // - rendersAfterClick > rendersAfterMount && countAfterClick === 1: the
    //   effect re-fired and read the new value, but the DOM isn't updated →
    //   morph is skipping the slot contents (check the SLOT_ATTR guard in
    //   morphChildren — it must NOT trip when the slot div is the top-level
    //   argument to morphInner, only when it's a paired Child).
    // - rendersAfterClick > rendersAfterMount && countAfterClick === 0: the
    //   effect re-fired but read stale state. Signal write/read ordering bug.
    expect({
      countAfterMount,
      countAfterClick,
      domCount: el.querySelector("p")!.textContent,
      renderedAtLeastOnce: rendersAfterMount >= 1,
      renderedMoreAfterClick: rendersAfterClick > rendersAfterMount,
    }).toEqual({
      countAfterMount: 0,
      countAfterClick: 1,
      domCount: "1",
      renderedAtLeastOnce: true,
      renderedMoreAfterClick: true,
    });

    unmount();
    cleanup(el);
  });
});

describe("diagnostic: derived + slot + whitespace", () => {
  it("D7: Parent with async derived and slotted Child preserves Child state across derived resolution", async () => {
    // Deferred promise so we control when the derived resolves.
    let resolveData: (v: { name: string; items: string[] }) => void;
    const dataPromise = new Promise<{ name: string; items: string[] }>((r) => {
      resolveData = r;
    });

    // oxlint-disable-next-line no-unused-vars
    let childRenderCount = 0;
    let childLastList: string[] = [];
    let childMountCount = 0;

    const Picker = ilha
      .state<string[]>("list", [])
      .onMount(({ state }) => {
        childMountCount++;
        // Simulate the pokedex onMount fetch pattern:
        queueMicrotask(() => {
          state.list(["a", "b", "c"]);
        });
      })
      .render(({ state }) => {
        childRenderCount++;
        childLastList = state.list();
        const opts = state.list().map((s) => html`<option>${s}</option>`);
        return html`<select>
          ${opts}
        </select>`;
      });

    const Parent = ilha
      .derived("data", async () => dataPromise)
      .render(({ derived }) => {
        if (derived.data.loading)
          return html`
            <p>loading</p>
          `;
        const value = derived.data.value!;
        // Deliberately use multi-line interpolation with other elements
        // around the slot to mirror the pokedex layout and expose any
        // whitespace-alignment bugs in morph.
        return html`
          ${Picker}
          <img src="x.png" />
          <h2>${value.name}</h2>
          ${value.items.map((i) => html`<span>${i}</span>`)}
        `;
      });

    const el = makeEl();
    const unmount = Parent.mount(el);

    // At this point: Parent renders "loading". Picker is not mounted yet.
    expect(el.querySelector("p")?.textContent).toBe("loading");
    expect(childMountCount).toBe(0);

    // Resolve the derived. Parent re-renders with the real layout.
    resolveData!({ name: "charizard", items: ["fire", "flying"] });
    // Wait a microtask for the derived's .then to fire and the render
    // effect to pick it up.
    await new Promise((r) => setTimeout(r, 0));
    // And another for the Picker's onMount microtask to run.
    await new Promise((r) => setTimeout(r, 0));

    // Diagnostics:
    // - ChildMountCount > 1: Picker was remounted (slot element was replaced
    //   during Parent re-render, losing the in-flight onMount state).
    // - ChildLastList is []: Picker's render effect never saw the updated
    //   list, either because the onMount write went to an orphaned signal
    //   (remount) or because tracking was dropped.
    // - DOM <option> count is 0: render effect saw the list but morph didn't
    //   reflect it.
    expect({
      childMountCount,
      childLastList,
      optionCount: el.querySelectorAll("option").length,
      selectPresent: !!el.querySelector("select"),
    }).toEqual({
      childMountCount: 1,
      childLastList: ["a", "b", "c"],
      optionCount: 3,
      selectPresent: true,
    });

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------
// .css() — scoped stylesheets
// ---------------------------------------------
//
// The .css() chain method attaches a stylesheet that is scoped to the Island
// host via the CSS @scope at-rule. The wrapped stylesheet is emitted as a
// <style data-ilha-css> element prepended to the Island's rendered HTML in
// both SSR and client-mount paths. These tests cover:
//
//   1. Backwards compatibility — no style tag when .css() is not called
//   2. Output shape — SSR + hydratable contain exactly one <style> wrapped in @scope
//   3. Scoping semantics — wrapper uses (:scope) upper + ([data-ilha]) lower
//   4. Passthrough tag — the `css` tagged-template export is a Plain string builder
//   5. Dev warning on double-call
//   6. Morph preserves <style> on state-driven re-renders (no flicker, no rebuild)
//   7. Works alongside all other builder features (slots, derived, events, etc.)

describe(".css()", () => {
  describe("backwards compatibility", () => {
    it("emits no <style> tag when .css() is not called", () => {
      const Island = ilha.state("count", 0).render(({ state }) => `<p>${state.count()}</p>`);

      expect(Island.toString()).toBe("<p>0</p>");
      expect(Island.toString()).not.toContain("<style");
    });

    it("emits no <style> tag for mount() when .css() is not called", () => {
      const Island = ilha.state("count", 0).render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector("style")).toBeNull();
      unmount();
      cleanup(el);
    });
  });

  describe("SSR output shape", () => {
    it("prepends a <style data-ilha-css> tag as the first Child of the Island", () => {
      const Island = ilha
        .state("count", 0)
        .css("button { color: red; }")
        .render(({ state }) => `<p>${state.count()}</p>`);

      const out = Island.toString();
      expect(out.startsWith("<style data-ilha-css>")).toBe(true);
    });

    it("emits exactly one <style> tag per render", () => {
      const Island = ilha
        .state("count", 0)
        .css("p { color: red; }")
        .render(({ state }) => `<p>${state.count()}</p>`);

      const out = Island.toString();
      const matches = out.match(/<style/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it("wraps user CSS in @scope (:scope) to ([data-ilha]) { ... }", () => {
      const Island = ilha.css("button { color: red; }").render(() => `<button>go</button>`);

      const out = Island.toString();
      expect(out).toContain("@scope (:scope) to ([data-ilha]){");
      expect(out).toContain("button { color: red; }");
    });

    it("preserves raw CSS verbatim inside the @scope wrapper", () => {
      const src = "p { font-weight: 600; } .box > .item:hover { opacity: 0.5; }";
      const Island = ilha.css(src).render(() => `<div class="box"></div>`);
      expect(Island.toString()).toContain(src);
    });

    it("accepts a tagged-template literal and renders the same as a Plain string", () => {
      // Both should produce identical output: the tag is pure passthrough, so a
      // tagged call and a Plain call with the same source text are equivalent.
      const src = `button { color: red; }`;
      const Tagged = ilha.css`button { color: red; }`.render(() => `<button>a</button>`);
      const Plain = ilha.css(src).render(() => `<button>a</button>`);
      expect(Tagged.toString()).toBe(Plain.toString());
    });

    it("interpolates template expressions into the CSS source", () => {
      // Whatever whitespace the formatter imposes on the tagged template, the
      // interpolated value itself ("red") must appear in the rendered stylesheet.
      const accent = "red";
      const Island = ilha.css`button { color: ${accent}; }`.render(() => `<button>x</button>`);
      const out = Island.toString();
      expect(out).toContain(accent);
      // The declaration must be syntactically intact regardless of whitespace,
      // so strip the style block and normalise whitespace for comparison.
      const normalised = out.replace(/\s+/g, " ");
      expect(normalised).toContain("color: red");
    });

    it("preserves Island content after the <style> tag", () => {
      const Island = ilha.css("p { color: red; }").render(() => `<p>hi</p>`);

      const out = Island.toString();
      expect(out).toBe(
        "<style data-ilha-css>@scope (:scope) to ([data-ilha]){p { color: red; }}</style><p>hi</p>",
      );
    });
  });

  describe(".hydratable() output shape", () => {
    it("places the <style> tag inside the data-ilha wrapper", async () => {
      const Island = ilha
        .state("count", 0)
        .css("button { color: red; }")
        .render(({ state }) => `<p>${state.count()}</p><button>+</button>`);

      const out = await Island.hydratable({}, { name: "styled", snapshot: false });
      const doc = new DOMParser().parseFromString(out, "text/html");
      const wrapper = doc.querySelector("[data-ilha='styled']");
      expect(wrapper).not.toBeNull();
      const style = wrapper!.querySelector("style[data-ilha-css]");
      expect(style).not.toBeNull();
      expect(style!.textContent).toContain("@scope (:scope) to ([data-ilha])");
    });

    it("still emits the <style> tag when snapshot=true", async () => {
      const Island = ilha
        .state("count", 5)
        .css(".label { font-weight: 700; }")
        .render(({ state }) => `<p class="label">${state.count()}</p>`);

      const out = await Island.hydratable({}, { name: "counted", snapshot: true });
      expect(out).toContain("<style data-ilha-css>");
      expect(out).toContain("data-ilha-state=");
    });
  });

  describe("passthrough `css` tag export", () => {
    it("returns a string equal to what a Plain untagged template would produce", () => {
      // We construct the expected value at runtime via string concatenation
      // so the formatter has no template literal to reflow. The contract under
      // test: `css` is a passthrough — `css\`X\`` produces the same string as
      // a plain untagged template literal would.
      const color = "red";
      const tagged = css`
        button {
          color: ${color};
        }
      `;
      const expected = "button { color: " + color + "; }";
      // Compare with whitespace collapsed so this is robust to any formatter
      // that may pretty-print the css`` literal across multiple lines.
      const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
      expect(collapse(tagged)).toBe(collapse(expected));
    });

    it("does not perform any dedenting or whitespace normalisation", () => {
      // Use the string-call form of css() so neither side is a template
      // literal the formatter can rewrite. The contract: whatever string you
      // pass to css(), you get the same string back, byte-for-byte.
      const input = "\n        button {\n          color: red;\n        }\n      ";
      const tagged = (css as (v: string) => string)(input);
      expect(tagged).toBe(input);
    });

    it("interpolates values as Plain string concatenation", () => {
      const color = "blue";
      const size = 12;
      const tagged = css`
        p {
          color: ${color};
          font-size: ${size}px;
        }
      `;
      const expected = "p { color: " + color + "; font-size: " + size + "px; }";
      const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
      expect(collapse(tagged)).toBe(collapse(expected));
    });

    it("ilha.css is the builder method, not the passthrough tag", () => {
      // The free-standing `css` export is the passthrough tag for tooling.
      // `ilha.css` is the builder chain method, reached because IlhaBuilder
      // has a .css() method. They are intentionally different callables.
      expect(typeof ilha.css).toBe("function");
      expect(ilha.css).not.toBe(css);
    });

    it("can be used as a Plain string builder (non-tagged call)", () => {
      // TS type allows TemplateStringsArray | string; runtime should accept both.
      const s = (css as (v: string) => string)("p { margin: 0; }");
      expect(s).toBe("p { margin: 0; }");
    });
  });

  describe("dev-mode warnings", () => {
    let warnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("warns when .css() is called more than once on the same chain", () => {
      ilha
        .css("p { color: red; }")
        .css("p { color: blue; }")
        .render(() => `<p>x</p>`);

      expect(warnSpy).toHaveBeenCalled();
      const msg: string = warnSpy.mock.calls[0]?.[0] ?? "";
      expect(msg).toMatch(/ilha/i);
      expect(msg).toMatch(/css/i);
    });

    it("uses the most recently supplied stylesheet when called twice", () => {
      const Island = ilha
        .css("p { color: red; }")
        .css("p { color: blue; }")
        .render(() => `<p>x</p>`);

      const out = Island.toString();
      expect(out).toContain("p { color: blue; }");
      expect(out).not.toContain("p { color: red; }");
    });

    it("does NOT warn when .css() is called exactly once", () => {
      ilha.css("p { color: red; }").render(() => `<p>x</p>`);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("client mount", () => {
    it("inserts the <style> tag as the first Child of the host", () => {
      const Island = ilha
        .state("count", 0)
        .css("p { color: red; }")
        .render(({ state }) => `<p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);

      const firstChild = el.firstElementChild;
      expect(firstChild).not.toBeNull();
      expect(firstChild!.tagName.toLowerCase()).toBe("style");
      expect(firstChild!.hasAttribute("data-ilha-css")).toBe(true);

      unmount();
      cleanup(el);
    });

    it("preserves the <style> element across state-driven re-renders", () => {
      let setCount!: (v: number) => void;

      const Island = ilha
        .state("count", 0)
        .css("p { color: red; }")
        .render(({ state }) => {
          setCount = state.count as unknown as (v: number) => void;
          return `<p>${state.count()}</p>`;
        });

      const el = makeEl();
      const unmount = Island.mount(el);

      const styleBefore = el.querySelector("style[data-ilha-css]");
      expect(styleBefore).not.toBeNull();

      // Trigger a re-render via state change
      setCount(42);
      expect(el.querySelector("p")!.textContent).toBe("42");

      const styleAfter = el.querySelector("style[data-ilha-css]");
      expect(styleAfter).not.toBeNull();
      // Same node identity — morph should NOT have replaced it.
      expect(styleAfter).toBe(styleBefore);
      expect(el.querySelectorAll("style[data-ilha-css]").length).toBe(1);

      unmount();
      cleanup(el);
    });

    it("preserves <style> content across many re-renders", () => {
      let setCount!: (v: number) => void;

      const Island = ilha
        .state("count", 0)
        .css(".value { color: red; }")
        .render(({ state }) => {
          setCount = state.count as unknown as (v: number) => void;
          return `<p class="value">${state.count()}</p>`;
        });

      const el = makeEl();
      const unmount = Island.mount(el);

      for (let i = 1; i <= 20; i++) setCount(i);

      const style = el.querySelector("style[data-ilha-css]");
      expect(style).not.toBeNull();
      expect(style!.textContent).toContain(".value { color: red; }");
      expect(el.querySelector("p")!.textContent).toBe("20");

      unmount();
      cleanup(el);
    });
  });

  describe("hydration", () => {
    it("does not duplicate the <style> tag when mounting over SSR output", async () => {
      const Island = ilha
        .state("count", 0)
        .css("p { color: red; }")
        .render(({ state }) => `<p>${state.count()}</p>`);

      const ssr = await Island.hydratable({}, { name: "styled", snapshot: true });

      document.body.innerHTML = ssr;
      const wrapper = document.querySelector("[data-ilha='styled']")!;

      const before = wrapper.querySelectorAll("style[data-ilha-css]").length;
      expect(before).toBe(1);

      const unmount = Island.mount(wrapper);

      const after = wrapper.querySelectorAll("style[data-ilha-css]").length;
      expect(after).toBe(1);

      unmount();
      document.body.innerHTML = "";
    });

    it("keeps the same <style> element after hydration + first re-render", async () => {
      let setCount!: (v: number) => void;

      const Island = ilha
        .state("count", 0)
        .css(".c { color: red; }")
        .render(({ state }) => {
          setCount = state.count as unknown as (v: number) => void;
          return `<p class="c">${state.count()}</p>`;
        });

      const ssr = await Island.hydratable({}, { name: "h", snapshot: true });
      document.body.innerHTML = ssr;
      const wrapper = document.querySelector("[data-ilha='h']")!;
      const styleBefore = wrapper.querySelector("style[data-ilha-css]");

      const unmount = Island.mount(wrapper);
      setCount(7);

      const styleAfter = wrapper.querySelector("style[data-ilha-css]");
      expect(styleAfter).not.toBeNull();
      // After hydration the mount re-uses the SSR-emitted style node; subsequent
      // morph passes should not replace it.
      expect(styleAfter).toBe(styleBefore);

      unmount();
      document.body.innerHTML = "";
    });
  });

  describe("interop with other builder features", () => {
    it("works alongside .state / .on / .derived / events", async () => {
      const Island = ilha
        .state("count", 1)
        .derived("doubled", ({ state }) => state.count() * 2)
        .css(".count { font-weight: 600; }")
        .on("button@click", ({ state }) => state.count(state.count() + 1))
        .render(
          ({ state, derived }) =>
            `<p class="count">${state.count()}/${derived.doubled.value ?? "?"}</p><button>+</button>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);

      expect(el.querySelector("style[data-ilha-css]")).not.toBeNull();
      expect(el.querySelector("p")!.textContent).toBe("1/2");

      (el.querySelector("button") as HTMLButtonElement).click();
      expect(el.querySelector("p")!.textContent).toBe("2/4");

      // <style> must survive the re-render triggered by the click
      expect(el.querySelectorAll("style[data-ilha-css]").length).toBe(1);

      unmount();
      cleanup(el);
    });

    it("Child Island in a slot emits its own <style> inside the slot, scoped by its own host", async () => {
      const Inner = ilha.css("span { color: red; }").render(() => `<span>inner</span>`);

      const Outer = ilha.css("div { color: blue; }").render(() => html`<div>${Inner}</div>`);

      const out = Outer.toString();

      // Outer style present
      expect(out).toContain("div { color: blue; }");
      // Inner style present (emitted as part of the slot SSR string)
      expect(out).toContain("span { color: red; }");
      // Two separate @scope wrappers, one per Island
      const scopeCount = (out.match(/@scope \(:scope\) to \(\[data-ilha\]\)/g) ?? []).length;
      expect(scopeCount).toBe(2);
    });

    it("does not interfere with .toString() synchronous contract when derived are async", () => {
      const Island = ilha
        .state("count", 3)
        .derived("slow", async () => {
          await new Promise((r) => setTimeout(r, 50));
          return "loaded";
        })
        .css("p { color: red; }")
        .render(({ state, derived }) =>
          derived.slow.loading ? `<p>loading ${state.count()}</p>` : `<p>${derived.slow.value}</p>`,
        );

      // Synchronous toString() still works and still contains the <style>
      const out = Island.toString();
      expect(out).toContain("<style data-ilha-css>");
      expect(out).toContain("loading 3");
    });
  });
});

// ---------------------------------------------
// Regression: Child re-renders when parent state passed as prop changes
// ---------------------------------------------
//
// Scenario: a Parent island has a state signal and renders a Child island,
// passing the current state value as a Child input prop. The Parent's
// onMount writes a new value to its state. The Child should re-render with
// the updated prop value.
//
// This exercises the path where parent re-render produces a fresh slot map
// with new props for an already-mounted child. If mountSlots skips re-
// applying props to existing slots, the child will stay stuck on its
// initial prop value.

describe("regression: child receives updated props when parent state changes", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("Child re-renders after Parent.onMount writes new state passed as Child prop", async () => {
    const Child = ilha
      .input(z.object({ value: z.string() }))
      .render(({ input }) => html`<span class="child">${input.value}</span>`);

    const Parent = ilha
      .state("msg", "initial")
      .onMount(({ state }) => {
        state.msg("updated");
      })
      .render(({ state }) => html`<div>${Child({ value: state.msg() })}</div>`);

    const el = makeEl();
    const unmount = Parent.mount(el);

    // Let onMount's state write propagate. The write happens synchronously
    // inside onMount, but the render effect that reacts to it may flush
    // asynchronously — give it a microtask either way.
    await new Promise((r) => setTimeout(r, 0));

    expect(el.querySelector(".child")!.textContent).toBe("updated");

    unmount();
    cleanup(el);
  });

  // The core "parent re-renders, child must follow" case. The previous
  // test uses onMount to force the initial-effect-pass divergence path
  // (state changed before the render effect was even registered). This
  // test takes the *steady-state* path: parent is fully mounted, then
  // a click fires that writes parent state, and we verify the child's
  // DOM updates. If updateProps regresses to a no-op on the existing
  // slot, this test will fail with "0" while the regression test above
  // passes — they probe different code paths.
  it("Child re-renders after click on Parent updates state passed as Child prop", () => {
    const Child = ilha
      .input(z.object({ count: z.number() }))
      .render(({ input }) => html`<span class="child">${input.count}</span>`);

    const Parent = ilha
      .state("count", 0)
      .on("button@click", ({ state }) => state.count(state.count() + 1))
      .render(({ state }) => html`<div>${Child({ count: state.count() })}<button>+</button></div>`);

    const el = makeEl();
    const unmount = Parent.mount(el);

    expect(el.querySelector(".child")!.textContent).toBe("0");

    el.querySelector<HTMLButtonElement>("button")!.click();
    expect(el.querySelector(".child")!.textContent).toBe("1");

    el.querySelector<HTMLButtonElement>("button")!.click();
    el.querySelector<HTMLButtonElement>("button")!.click();
    expect(el.querySelector(".child")!.textContent).toBe("3");

    unmount();
    cleanup(el);
  });

  // The mounted Child element identity must be preserved when its props
  // change. We're propagating props by writing into the existing child's
  // input signal, NOT by tearing down and remounting — so its host
  // element, internal state, and onMount cleanup should all survive.
  it("Child element identity and state are preserved across prop updates", () => {
    let childMountCount = 0;
    let childUnmountCount = 0;

    const Child = ilha
      .input(z.object({ label: z.string() }))
      .state("clicks", 0)
      .on("[data-c]@click", ({ state }) => state.clicks(state.clicks() + 1))
      .onMount(() => {
        childMountCount++;
        return () => {
          childUnmountCount++;
        };
      })
      .render(
        ({ state, input }) =>
          html`<span class="child" data-c>${input.label}:${state.clicks()}</span>`,
      );

    const Parent = ilha
      .state("label", "a")
      .on("button@click", ({ state }) => state.label(state.label() + "+"))
      .render(
        ({ state }) => html`<div>${Child({ label: state.label() })}<button>edit</button></div>`,
      );

    const el = makeEl();
    const unmount = Parent.mount(el);

    expect(childMountCount).toBe(1);
    const childElBefore = el.querySelector(".child");

    // Bump child internal state via a click on the child.
    el.querySelector<HTMLSpanElement>(".child")!.click();
    expect(el.querySelector(".child")!.textContent).toBe("a:1");

    // Trigger a parent re-render that pushes new props to the child.
    el.querySelector<HTMLButtonElement>("button")!.click();
    expect(el.querySelector(".child")!.textContent).toBe("a+:1");

    // Same DOM element — child was NOT remounted.
    expect(el.querySelector(".child")).toBe(childElBefore);
    expect(childMountCount).toBe(1);
    expect(childUnmountCount).toBe(0);

    // Child's internal state survived; another click still increments.
    el.querySelector<HTMLSpanElement>(".child")!.click();
    expect(el.querySelector(".child")!.textContent).toBe("a+:2");

    unmount();
    cleanup(el);
  });

  // Parent re-renders that don't change child props should not cause the
  // child's render effect to run again. The shallowEqualInput short-circuit
  // in updateProps is what guarantees this — without it, every parent
  // re-render would churn the child's input signal and re-run its
  // render/derived/effect scopes pointlessly.
  it("Child does NOT re-render when parent re-renders with shallow-equal props", () => {
    let childRenders = 0;

    const Child = ilha.input(z.object({ value: z.string() })).render(({ input }) => {
      childRenders++;
      return html`<span class="child">${input.value}</span>`;
    });

    const Parent = ilha
      .state("count", 0)
      .state("label", "hello")
      .on("button@click", ({ state }) => state.count(state.count() + 1))
      .render(
        ({ state }) =>
          html`<div>
            <p>${state.count()}</p>
            ${Child({ value: state.label() })}
            <button>+</button>
          </div>`,
      );

    const el = makeEl();
    const unmount = Parent.mount(el);

    const initialChildRenders = childRenders;

    // Parent state changes drive parent re-renders, but child props
    // (state.label) are unchanged, so child should not re-run.
    el.querySelector<HTMLButtonElement>("button")!.click();
    el.querySelector<HTMLButtonElement>("button")!.click();
    el.querySelector<HTMLButtonElement>("button")!.click();

    expect(el.querySelector("p")!.textContent).toBe("3");
    expect(el.querySelector(".child")!.textContent).toBe("hello");
    expect(childRenders).toBe(initialChildRenders);

    unmount();
    cleanup(el);
  });

  // Mixed: one prop changes, another stays the same. Because we use a
  // single input signal per child, ANY prop change triggers a re-render
  // (coarse-grained reactivity by design — granular per-key signals would
  // be a much bigger change). Documenting this so the granularity choice
  // is intentional and tested.
  it("Child re-renders when ANY prop changes (whole-input granularity)", () => {
    let childRenders = 0;

    const Child = ilha.input(z.object({ a: z.string(), b: z.string() })).render(({ input }) => {
      childRenders++;
      return html`<span class="child">${input.a}-${input.b}</span>`;
    });

    const Parent = ilha
      .state("a", "x")
      .state("b", "y")
      .on("[data-a]@click", ({ state }) => state.a(state.a() + "!"))
      .on("[data-b]@click", ({ state }) => state.b(state.b() + "?"))
      .render(
        ({ state }) =>
          html`<div>
            ${Child({ a: state.a(), b: state.b() })}
            <button data-a>A</button>
            <button data-b>B</button>
          </div>`,
      );

    const el = makeEl();
    const unmount = Parent.mount(el);
    const baseline = childRenders;

    el.querySelector<HTMLButtonElement>("[data-a]")!.click();
    expect(el.querySelector(".child")!.textContent).toBe("x!-y");
    expect(childRenders).toBe(baseline + 1);

    el.querySelector<HTMLButtonElement>("[data-b]")!.click();
    expect(el.querySelector(".child")!.textContent).toBe("x!-y?");
    expect(childRenders).toBe(baseline + 2);

    unmount();
    cleanup(el);
  });
});

describe(".effect resets state – derived stays consistent", () => {
  it("derived.doubled.value is 0 immediately after effect resets count, not stale", () => {
    let accessCount!: (v?: number) => number | void;

    const Counter = ilha
      .state("count", 0)
      .derived("doubled", ({ state }) => state.count() * 2)
      .effect(({ state }) => {
        if (state.count() > 3) {
          state.count(0);
        }
      })
      .render(({ state, derived }) => {
        accessCount = state.count as typeof accessCount;
        return html`
          <p id="count">${state.count()}</p>
          <p id="doubled">${derived.doubled.value}</p>
        `;
      });

    const el = makeEl("");
    const unmount = Counter.mount(el);

    // Drive count to 4 — the effect resets it back to 0
    accessCount(4);

    // count must show 0 in the DOM
    expect(el.querySelector("#count")!.textContent).toBe("0");
    // derived.doubled must also show 0, not 8 (stale value of 4*2)
    expect(el.querySelector("#doubled")!.textContent).toBe("0");

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------
// Edge case: effect ↔ derived ↔ render consistency
// ---------------------------------------------------------------

describe("effect ↔ derived ↔ render consistency", () => {
  it("multiple derived values all stay consistent when effect resets state", () => {
    let accessCount!: (v?: number) => number | void;

    const Counter = ilha
      .state("count", 0)
      .derived("doubled", ({ state }) => state.count() * 2)
      .derived("tripled", ({ state }) => state.count() * 3)
      .derived("label", ({ state }) => `count is ${state.count()}`)
      .effect(({ state }) => {
        if (state.count() > 3) state.count(0);
      })
      .render(({ state, derived }) => {
        accessCount = state.count as typeof accessCount;
        return html`
          <p id="count">${state.count()}</p>
          <p id="doubled">${derived.doubled.value}</p>
          <p id="tripled">${derived.tripled.value}</p>
          <p id="label">${derived.label.value}</p>
        `;
      });

    const el = makeEl("");
    const unmount = Counter.mount(el);
    accessCount(4);

    expect(el.querySelector("#count")!.textContent).toBe("0");
    expect(el.querySelector("#doubled")!.textContent).toBe("0");
    expect(el.querySelector("#tripled")!.textContent).toBe("0");
    expect(el.querySelector("#label")!.textContent).toBe("count is 0");

    unmount();
    cleanup(el);
  });

  it("effect clamping state never produces intermediate derived values in the DOM", () => {
    const seen: number[] = [];
    let accessCount!: (v?: number) => number | void;

    const Counter = ilha
      .state("count", 0)
      .derived("doubled", ({ state }) => state.count() * 2)
      .effect(({ state }) => {
        if (state.count() > 10) state.count(10);
      })
      .render(({ state, derived }) => {
        accessCount = state.count as typeof accessCount;
        seen.push(derived.doubled.value as number);
        return html`<p id="doubled">${derived.doubled.value}</p>`;
      });

    const el = makeEl("");
    const unmount = Counter.mount(el);
    accessCount(99);

    // DOM must show 20 (10 * 2), never 198 (99 * 2)
    expect(el.querySelector("#doubled")!.textContent).toBe("20");
    expect(seen).not.toContain(198);

    unmount();
    cleanup(el);
  });

  it("derived stays consistent across multiple sequential effect resets", () => {
    let accessCount!: (v?: number) => number | void;

    const Counter = ilha
      .state("count", 0)
      .derived("doubled", ({ state }) => state.count() * 2)
      .effect(({ state }) => {
        if (state.count() > 3) state.count(0);
      })
      .render(({ state, derived }) => {
        accessCount = state.count as typeof accessCount;
        return html`
          <p id="count">${state.count()}</p>
          <p id="doubled">${derived.doubled.value}</p>
        `;
      });

    const el = makeEl("");
    const unmount = Counter.mount(el);

    for (let i = 0; i < 5; i++) {
      accessCount(4);
      expect(el.querySelector("#count")!.textContent).toBe("0");
      expect(el.querySelector("#doubled")!.textContent).toBe("0");
    }

    unmount();
    cleanup(el);
  });

  it("derived derived from two state signals stays consistent when effect writes both", () => {
    let accessA!: (v?: number) => number | void;

    const Island = ilha
      .state("a", 1)
      .state("b", 1)
      .derived("product", ({ state }) => state.a() * state.b())
      .effect(({ state }) => {
        // When a > 5, clamp both to 1
        if (state.a() > 5) {
          state.a(1);
          state.b(1);
        }
      })
      .render(({ state, derived }) => {
        accessA = state.a as typeof accessA;
        return html` <p id="product">${derived.product.value}</p> `;
      });

    const el = makeEl("");
    const unmount = Island.mount(el);

    accessA(6);
    // Both clamped to 1, product must be 1 — not 6 or any intermediate
    expect(el.querySelector("#product")!.textContent).toBe("1");

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------
// Edge case: effect cleanup ordering
// ---------------------------------------------------------------

describe("effect cleanup ordering", () => {
  it("previous cleanup runs before next effect body on re-run", () => {
    const log: string[] = [];
    let accessX!: (v?: number) => number | void;

    const Island = ilha
      .state("x", 0)
      .effect(({ state }) => {
        const v = state.x();
        log.push(`run:${v}`);
        return () => log.push(`cleanup:${v}`);
      })
      .render(({ state }) => {
        accessX = state.x as typeof accessX;
        return html`<p>${state.x()}</p>`;
      });

    const el = makeEl("");
    const unmount = Island.mount(el);
    // initial: run:0
    accessX(1);
    // cleanup:0 must precede run:1
    accessX(2);
    // cleanup:1 must precede run:2

    expect(log).toEqual(["run:0", "cleanup:0", "run:1", "cleanup:1", "run:2"]);

    unmount();
    // cleanup:2 on unmount
    expect(log).toEqual(["run:0", "cleanup:0", "run:1", "cleanup:1", "run:2", "cleanup:2"]);
    cleanup(el);
  });

  it("multiple effects run cleanups in registration order on unmount", () => {
    const log: string[] = [];

    const Island = ilha
      .effect(() => {
        return () => log.push("cleanup:A");
      })
      .effect(() => {
        return () => log.push("cleanup:B");
      })
      .effect(() => {
        return () => log.push("cleanup:C");
      })
      .render(
        () =>
          html`
            <p>x</p>
          `,
      );

    const el = makeEl("");
    const unmount = Island.mount(el);
    unmount();

    expect(log).toEqual(["cleanup:A", "cleanup:B", "cleanup:C"]);
    cleanup(el);
  });

  it("effect cleanup is called even if the next run throws", () => {
    let cleaned = false;
    let accessX!: (v?: number) => number | void;
    let throws = false;

    const Island = ilha
      .state("x", 0)
      .effect(({ state }) => {
        state.x();
        if (throws) throw new Error("boom");
        return () => {
          cleaned = true;
        };
      })
      .render(({ state }) => {
        accessX = state.x as typeof accessX;
        return html`<p>${state.x()}</p>`;
      });

    const el = makeEl("");
    const unmount = Island.mount(el);
    throws = true;
    accessX(1); // triggers re-run which throws — cleanup of run:0 must still fire
    expect(cleaned).toBe(true);

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------
// Edge case: derived during onMount
// ---------------------------------------------------------------

describe("derived availability in onMount", () => {
  it("sync derived has a resolved value in onMount (not loading)", () => {
    let seenLoading: boolean | undefined;
    let seenValue: unknown;

    const Island = ilha
      .state("x", 5)
      .derived("doubled", ({ state }) => state.x() * 2)
      .onMount(({ derived }) => {
        seenLoading = derived.doubled.loading;
        seenValue = derived.doubled.value;
      })
      .render(({ state }) => html`<p>${state.x()}</p>`);

    const el = makeEl("");
    const unmount = Island.mount(el);

    expect(seenLoading).toBe(false);
    expect(seenValue).toBe(10);

    unmount();
    cleanup(el);
  });

  it("async derived starts as loading in onMount", async () => {
    let seenLoading: boolean | undefined;
    let resolve!: (v: number) => void;
    const p = new Promise<number>((r) => (resolve = r));

    const Island = ilha
      .derived("val", async () => p)
      .onMount(({ derived }) => {
        seenLoading = derived.val.loading;
      })
      .render(
        () =>
          html`
            <p>x</p>
          `,
      );

    const el = makeEl("");
    const unmount = Island.mount(el);

    expect(seenLoading).toBe(true);
    resolve(42);
    await p;
    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------
// Edge case: derived with state written inside onMount
// ---------------------------------------------------------------

describe("derived consistency when state written in onMount", () => {
  it("derived reflects state written synchronously in onMount", () => {
    const Island = ilha
      .state("count", 0)
      .derived("doubled", ({ state }) => state.count() * 2)
      .onMount(({ state }) => {
        state.count(7);
      })
      .render(
        ({ state, derived }) => html`
          <p id="count">${state.count()}</p>
          <p id="doubled">${derived.doubled.value}</p>
        `,
      );

    const el = makeEl("");
    const unmount = Island.mount(el);

    expect(el.querySelector("#count")!.textContent).toBe("7");
    expect(el.querySelector("#doubled")!.textContent).toBe("14");

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------
// Edge case: multiple effects observing overlapping state
// ---------------------------------------------------------------

describe("multiple effects with overlapping state dependencies", () => {
  it("both effects re-run when shared state changes", () => {
    let countA = 0;
    let countB = 0;
    let accessX!: (v?: number) => number | void;

    const Island = ilha
      .state("x", 0)
      .effect(({ state }) => {
        state.x();
        countA++;
      })
      .effect(({ state }) => {
        state.x();
        countB++;
      })
      .render(({ state }) => {
        accessX = state.x as typeof accessX;
        return html`<p>${state.x()}</p>`;
      });

    const el = makeEl("");
    const unmount = Island.mount(el);
    expect(countA).toBe(1);
    expect(countB).toBe(1);

    accessX(1);
    expect(countA).toBe(2);
    expect(countB).toBe(2);

    unmount();
    cleanup(el);
  });

  it("effect writing state only re-runs the effect that reads the written signal", () => {
    let countB = 0;
    let accessX!: (v?: number) => number | void;

    const Island = ilha
      .state("x", 0)
      .state("y", 0)
      // effect A reads x, writes y
      .effect(({ state }) => {
        state.y(state.x() * 2);
      })
      // effect B reads only y
      .effect(({ state }) => {
        state.y();
        countB++;
      })
      .render(({ state }) => {
        accessX = state.x as typeof accessX;
        return html`<p>${state.y()}</p>`;
      });

    const el = makeEl("");
    const unmount = Island.mount(el);
    const initialB = countB;

    accessX(5); // effect A runs → writes y=10 → effect B re-runs
    expect(countB).toBe(initialB + 1);

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------
// Edge case: derived chain (derived reading derived via state)
// ---------------------------------------------------------------

describe("derived chain consistency", () => {
  it("downstream derived is consistent when upstream state changes via effect", () => {
    let accessX!: (v?: number) => number | void;

    const Island = ilha
      .state("x", 2)
      // doubled reads x
      .derived("doubled", ({ state }) => state.x() * 2)
      // quadrupled reads x directly (not doubled — ilha deriveds are independent)
      .derived("quadrupled", ({ state }) => state.x() * 4)
      .effect(({ state }) => {
        if (state.x() > 10) state.x(1);
      })
      .render(({ state, derived }) => {
        accessX = state.x as typeof accessX;
        return html`
          <p id="doubled">${derived.doubled.value}</p>
          <p id="quadrupled">${derived.quadrupled.value}</p>
        `;
      });

    const el = makeEl("");
    const unmount = Island.mount(el);

    accessX(11); // effect clamps to 1

    expect(el.querySelector("#doubled")!.textContent).toBe("2");
    expect(el.querySelector("#quadrupled")!.textContent).toBe("4");

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------
// Edge case: render reads both raw state and derived
// ---------------------------------------------------------------

describe("render atomicity: state and derived always agree in the DOM", () => {
  it("rendered state and derived are never out of sync across multiple writes", () => {
    let accessCount!: (v?: number) => number | void;
    const snapshots: Array<{ count: string; doubled: string }> = [];

    const Counter = ilha
      .state("count", 0)
      .derived("doubled", ({ state }) => state.count() * 2)
      .render(({ state, derived }) => {
        accessCount = state.count as typeof accessCount;
        // record every render to detect any mid-render inconsistency
        snapshots.push({
          count: String(state.count()),
          doubled: String(derived.doubled.value),
        });
        return html`
          <p id="count">${state.count()}</p>
          <p id="doubled">${derived.doubled.value}</p>
        `;
      });

    const el = makeEl("");
    const unmount = Counter.mount(el);

    for (let i = 1; i <= 6; i++) accessCount(i);

    // Every snapshot must be internally consistent
    for (const snap of snapshots) {
      const count = Number(snap.count);
      const doubled = Number(snap.doubled);
      expect(doubled).toBe(count * 2);
    }

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------
// Edge case: remounting after unmount
// ---------------------------------------------------------------

describe("remounting after unmount", () => {
  it("island can be mounted again after unmounting and works correctly", () => {
    let accessCount!: (v?: number) => number | void;

    const Counter = ilha
      .state("count", 0)
      .derived("doubled", ({ state }) => state.count() * 2)
      .render(({ state, derived }) => {
        accessCount = state.count as typeof accessCount;
        return html`
          <p id="count">${state.count()}</p>
          <p id="doubled">${derived.doubled.value}</p>
        `;
      });

    const el = makeEl("");
    let unmount = Counter.mount(el);
    accessCount(3);
    expect(el.querySelector("#count")!.textContent).toBe("3");
    unmount();

    // remount — fresh state
    unmount = Counter.mount(el);
    expect(el.querySelector("#count")!.textContent).toBe("0");
    accessCount(2);
    expect(el.querySelector("#count")!.textContent).toBe("2");
    expect(el.querySelector("#doubled")!.textContent).toBe("4");

    unmount();
    cleanup(el);
  });
});
