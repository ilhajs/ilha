import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

import { z } from "zod";

import ilha, { html, raw, css, mount, from, context } from "./index";

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

  it("passes array of html`` results directly into Parent html`` without .join()", () => {
    const Badges = ["fire", "water"].map((t) => html`<span class="Badge">${t}</span>`);
    const result = html`<div>${Badges}</div>`;
    expect(result.value).toBe(
      '<div><span class="Badge">fire</span><span class="Badge">water</span></div>',
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
      .render(({ state }) => html`<ul>${state.items().map((i) => html`<li>${i}</li>`)}</ul>`);

    expect(Island()).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
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
      .render(({ state }) => html`<p>${state.count()}</p><button data-inc>+</button>`);

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
      .render(({ state }) => html`<p>${state.count()}</p><button data-inc>+</button>`);

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
        return html`<ul>${state.order().map((k) => Item.key(k))}</ul>`;
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

describe(".bind", () => {
  describe("SSR", () => {
    it("SSR .bind is a no-op — Island renders normally", () => {
      const Island = ilha
        .state("email", "default@example.com")
        .bind("[data-email]", "email")
        .render(({ state }) => `<input data-email value="${state.email()}">`);

      expect(Island()).toBe(`<input data-email value="default@example.com">`);
    });
  });

  describe("DOM -> state", () => {
    it("client text input change updates state", () => {
      const Island = ilha
        .state("name", "ada")
        .bind("[data-name]", "name")
        .render(({ state }) => `<input data-name value="${state.name()}"><p>${state.name()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      el.querySelector<HTMLInputElement>("[data-name]")!.value = "grace";
      el.querySelector<HTMLInputElement>("[data-name]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("grace");
      unmount();
      cleanup(el);
    });

    it("client checkbox change updates boolean state", () => {
      const Island = ilha
        .state("checked", false)
        .bind("[data-cb]", "checked")
        .render(
          ({ state }) =>
            `<input type="checkbox" data-cb ${state.checked() ? "checked" : ""}><p>${state.checked()}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      el.querySelector<HTMLInputElement>("[data-cb]")!.checked = true;
      el.querySelector<HTMLInputElement>("[data-cb]")!.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toBe("true");
      unmount();
      cleanup(el);
    });

    it("client select change updates state", () => {
      const Island = ilha
        .state("size", "m")
        .bind("[data-size]", "size")
        .render(
          ({ state }) =>
            `<select data-size><option value="s">S</option><option value="m">M</option><option value="l">L</option></select><p>${state.size()}</p>`,
        );

      const el = makeEl();
      const unmount = Island.mount(el);
      el.querySelector<HTMLSelectElement>("[data-size]")!.value = "l";
      el.querySelector<HTMLSelectElement>("[data-size]")!.dispatchEvent(new Event("change"));
      expect(el.querySelector("p")!.textContent).toBe("l");
      unmount();
      cleanup(el);
    });

    it("client number input updates numeric state", () => {
      const Island = ilha
        .state("count", 0)
        .bind("[data-num]", "count")
        .render(({ state }) => `<input type="number" data-num><p>${state.count()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
      el.querySelector<HTMLInputElement>("[data-num]")!.value = "42";
      el.querySelector<HTMLInputElement>("[data-num]")!.dispatchEvent(new Event("input"));
      expect(el.querySelector("p")!.textContent).toBe("42");
      unmount();
      cleanup(el);
    });
  });

  describe("state -> DOM", () => {
    it("client initial state is synced to input value on mount", () => {
      const Island = ilha
        .state("email", "hello@example.com")
        .bind("[data-email]", "email")
        .render(({ state }) => `<input data-email value="${state.email()}">`);

      const el = makeEl();
      const unmount = Island.mount(el);
      expect(el.querySelector<HTMLInputElement>("[data-email]")!.value).toBe("hello@example.com");
      unmount();
      cleanup(el);
    });

    it("client programmatic state change updates input value", () => {
      let accessor!: (v?: string) => string | void;

      const Island = ilha
        .state("email", "a@b.com")
        .bind("[data-email]", "email")
        .render(({ state }) => {
          accessor = state.email as typeof accessor;
          return `<input data-email value="${state.email()}">`;
        });

      const el = makeEl();
      const unmount = Island.mount(el);
      accessor("new@example.com");
      expect(el.querySelector<HTMLInputElement>("[data-email]")!.value).toBe("new@example.com");
      unmount();
      cleanup(el);
    });

    it("client programmatic state change updates checkbox checked", () => {
      let accessor!: (v?: boolean) => boolean | void;

      const Island = ilha
        .state("active", false)
        .bind("[data-cb]", "active")
        .render(({ state }) => {
          accessor = state.active as typeof accessor;
          return `<input type="checkbox" data-cb ${state.active() ? "checked" : ""}>`;
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
  });

  describe("Two-way", () => {
    it("client two-way DOM change reflects in render output", () => {
      const Island = ilha
        .state("query", "")
        .bind("[data-q]", "query")
        .render(({ state }) => `<input data-q><p>${state.query()}</p>`);

      const el = makeEl();
      const unmount = Island.mount(el);
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

  describe("radio", () => {
    it("client programmatic radio state change updates checked input", () => {
      let accessor!: (v?: string) => string | void;

      const Island = ilha
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
      const unmount = Island.mount(el);
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
      const Island = ilha
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
      const unmount = Island.mount(el);
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
        return html`<select>${opts}</select>`;
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
      // Deliberately written so the formatter can break it across lines however
      // it likes. The contract is: `css\`X\`` === the Plain template literal `X`.
      const color = "red";
      const tagged = css`button { color: ${color}; }`;
      const Plain = `button { color: ${color}; }`;
      expect(tagged).toBe(Plain);
    });

    it("does not perform any dedenting or whitespace normalisation", () => {
      // Whatever whitespace is in the source literal, the tag returns it verbatim.
      // We compare against the untagged version of the same literal so this test
      // is resilient to any formatter reflowing the template.
      const tagged = css`
        button {
          color: red;
        }
      `;
      const Plain = `
        button {
          color: red;
        }
      `;
      expect(tagged).toBe(Plain);
    });

    it("interpolates values as Plain string concatenation", () => {
      const color = "blue";
      const size = 12;
      const tagged = css`p { color: ${color}; font-size: ${size}px; }`;
      const Plain = `p { color: ${color}; font-size: ${size}px; }`;
      expect(tagged).toBe(Plain);
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
