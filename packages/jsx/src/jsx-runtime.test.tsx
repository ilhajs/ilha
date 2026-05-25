import { describe, expect, it } from "bun:test";

import ilha, { html, raw } from "ilha";
import { z } from "zod";

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

function cleanup(el: Element): void {
  document.body.removeChild(el);
}

describe("@ilha/jsx runtime", () => {
  it("renders simple JSX in an ilha island", () => {
    const Greeting = ilha.render(() => <p>Hello, ilha!</p>);

    expect(Greeting()).toBe("<p>Hello, ilha!</p>");
  });

  it("renders static JSX", () => {
    expect(normalizeHtml(<p>hello</p>)).toBe("<p>hello</p>");
  });

  it("escapes interpolated strings", () => {
    const val = '<script>alert("xss")</script>';
    expect((<p>{val}</p>).value).toBe("<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>");
  });

  it("escapes interpolated numbers", () => {
    expect((<p>{42}</p>).value).toBe("<p>42</p>");
  });

  it("skips null and undefined children", () => {
    expect((<p>{[null, undefined]}</p>).value).toBe("<p></p>");
  });

  it("passes raw() through unescaped", () => {
    expect((<div>{raw("<b>bold</b>")}</div>).value).toBe("<div><b>bold</b></div>");
  });

  it("calls function children and escapes result", () => {
    const fn = () => "<em>hi</em>";
    expect((<p>{fn}</p>).value).toBe("<p>&lt;em&gt;hi&lt;/em&gt;</p>");
  });

  it("renders signal accessor values without calling them", () => {
    const Island = ilha.state("label", "Ada").render(({ state }) => <p>{state.label}</p>);

    expect(Island()).toBe("<p>Ada</p>");
  });

  it("escapes signal accessor values", () => {
    const Island = ilha.state("label", "<b>hi</b>").render(({ state }) => <p>{state.label}</p>);

    expect(Island()).toBe("<p>&lt;b&gt;hi&lt;/b&gt;</p>");
  });

  it("returns a RawHtml object, not a string", () => {
    const result = <p>test</p>;

    expect(typeof result).toBe("object");
    expect(normalizeHtml(result)).toBe("<p>test</p>");
  });

  it("passes an empty object to function components without props", () => {
    function Comp({ a }: { a?: string }) {
      return <p>{a ?? "fallback"}</p>;
    }

    expect((<Comp />).value).toBe("<p>fallback</p>");
  });

  it("does not treat arbitrary value-shaped objects as RawHtml", () => {
    expect((<p>{{ value: "<b>x</b>" }}</p>).value).toBe("<p>[object Object]</p>");
  });

  it("drops invalid attribute names from spread props", () => {
    const props = {
      id: "ok",
      "bad name": "x",
      'x="y" onclick="alert(1)': "x",
      "bind:bad-name": "x",
      "bind:value:extra": "x",
    };

    expect((<input {...props} />).value).toBe('<input id="ok">');
  });

  it("renders an array of strings as concatenated escaped HTML", () => {
    const items = ["foo", "bar", "baz"];

    expect(normalizeHtml(<ul>{items}</ul>)).toBe("<ul>foobarbaz</ul>");
  });

  it("escapes each string element in an array", () => {
    const items = ["<b>bold</b>", "<script>xss</script>"];

    expect(normalizeHtml(<ul>{items}</ul>)).toBe(
      "<ul>&lt;b&gt;bold&lt;/b&gt;&lt;script&gt;xss&lt;/script&gt;</ul>",
    );
  });

  it("renders an array of raw() items unescaped", () => {
    const items = [raw("<li>one</li>"), raw("<li>two</li>")];

    expect(normalizeHtml(<ul>{items}</ul>)).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("renders a mixed array of strings and raw() items correctly", () => {
    const items = ["<safe>", raw("<li>raw</li>")];

    expect(normalizeHtml(<ul>{items}</ul>)).toBe("<ul>&lt;safe&gt;<li>raw</li></ul>");
  });

  it("renders an empty array as empty string", () => {
    expect(normalizeHtml(<ul>{[]}</ul>)).toBe("<ul></ul>");
  });

  it("renders an array of numbers", () => {
    const items = [1, 2, 3];

    expect((<p>{items}</p>).value).toBe("<p>123</p>");
  });

  it("renders an array with null/undefined entries, skipping them", () => {
    const items = ["a", null, undefined, "b"];

    expect((<p>{items}</p>).value).toBe("<p>ab</p>");
  });

  it("renders an array of JSX results directly", () => {
    const fruits = ["apple", "banana", "cherry"];
    const result = (
      <ul>
        {fruits.map((f) => (
          <li>{f}</li>
        ))}
      </ul>
    );

    expect(normalizeHtml(result)).toBe("<ul><li>apple</li><li>banana</li><li>cherry</li></ul>");
  });

  it("renders an array produced by .map() with raw()", () => {
    const fruits = ["apple", "banana", "cherry"];
    const result = <ul>{fruits.map((f) => raw(`<li>${f}</li>`))}</ul>;

    expect(normalizeHtml(result)).toBe("<ul><li>apple</li><li>banana</li><li>cherry</li></ul>");
  });

  it("renders a mapped array of JSX with XSS-safe escaping per item", () => {
    const items = ["<script>", "safe"];
    const result = (
      <ul>
        {items.map((i) => (
          <li>{i}</li>
        ))}
      </ul>
    );

    expect(normalizeHtml(result)).toBe("<ul><li>&lt;script&gt;</li><li>safe</li></ul>");
  });

  it("renders nested arrays", () => {
    const rows = [[raw("<td>a</td>"), raw("<td>b</td>")]];

    expect(normalizeHtml(<tr>{rows}</tr>)).toBe("<tr><td>a</td><td>b</td></tr>");
  });

  it("passes array of JSX results directly without .join()", () => {
    const badges = ["fire", "water"].map((t) => <span class="Badge">{t}</span>);
    const result = <div>{badges}</div>;

    expect(result.value).toBe(
      '<div><span class="Badge">fire</span><span class="Badge">water</span></div>',
    );
  });

  it("does NOT produce commas when an array of JSX is interpolated", () => {
    const items = ["a", "b", "c"].map((x) => <li>{x}</li>);
    const result = <ul>{items}</ul>;

    expect(result.value).not.toContain(",");
    expect(normalizeHtml(result)).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
  });

  it("renders html`` results inside JSX", () => {
    const result = <div>{html`<span>${"safe"}</span>`}</div>;

    expect(result.value).toBe("<div><span>safe</span></div>");
  });

  it("renders state in JSX", () => {
    const Counter = ilha.state("count", 3).render(({ state }) => <p>Count: {state.count()}</p>);

    expect(Counter()).toBe("<p>Count: 3</p>");
  });

  it("renders JSX with schema defaults when called with no args", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => <p>{state.count()}</p>);

    expect(Counter()).toBe("<p>0</p>");
  });

  it("renders JSX with provided input props", () => {
    const Greeting = ilha
      .input(z.object({ name: z.string().default("world") }))
      .render(({ input }) => <p>hello {input.name}</p>);

    expect(Greeting({ name: "Ada" })).toBe("<p>hello Ada</p>");
  });

  it("toString() renders JSX with provided input props", () => {
    const Counter = ilha
      .input(z.object({ count: z.number().default(0) }))
      .state("count", ({ count }) => count)
      .render(({ state }) => <span>{state.count()}</span>);

    expect(Counter.toString({ count: 99 })).toBe("<span>99</span>");
  });

  it("throws validation errors before rendering JSX", () => {
    const Counter = ilha
      .input(z.object({ count: z.number() }))
      .render(({ input }) => <p>{input.count}</p>);

    expect(() => Counter({ count: "nope" as never })).toThrow("[ilha] Validation failed");
  });

  it("mounts JSX into an element and re-renders when state changes", () => {
    let count!: (value?: number) => number | void;
    const Counter = ilha.state("count", 0).render(({ state }) => {
      count = state.count as typeof count;
      return <p>{state.count()}</p>;
    });

    const el = makeEl();
    const unmount = Counter.mount(el);

    expect(el.innerHTML).toBe("<p>0</p>");
    count(5);
    expect(el.innerHTML).toBe("<p>5</p>");

    unmount();
    cleanup(el);
  });

  it("updates JSX after a click handler changes state", () => {
    const Counter = ilha
      .state("count", 0)
      .on("button@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => (
        <div>
          <p>Count: {state.count()}</p>
          <button type="button">+</button>
        </div>
      ));

    const el = makeEl();
    const unmount = Counter.mount(el);

    expect(el.innerHTML).toBe('<div><p>Count: 0</p><button type="button">+</button></div>');

    (el.querySelector("button") as HTMLButtonElement).click();
    expect(el.innerHTML).toBe('<div><p>Count: 1</p><button type="button">+</button></div>');

    unmount();
    cleanup(el);
  });

  it("supports bind:value in JSX", () => {
    const Name = ilha.state("name", "Ada").render(({ state }) => (
      <div>
        <input bind:value={state.name} />
        <p>Hello {state.name()}</p>
      </div>
    ));

    const el = makeEl();
    const unmount = Name.mount(el);
    const input = el.querySelector("input") as HTMLInputElement;

    expect(input.value).toBe("Ada");
    expect(el.querySelector("p")!.textContent).toBe("Hello Ada");

    input.value = "Grace";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(el.querySelector("p")!.textContent).toBe("Hello Grace");

    unmount();
    cleanup(el);
  });

  it("nests an ilha island inside another island via JSX", () => {
    const Child = ilha.state("count", 0).render(({ state }) => <button>{state.count()}</button>);
    const Parent = ilha.render(() => (
      <section>
        <h1>Parent</h1>
        <Child />
      </section>
    ));

    expect(normalizeHtml(Parent.toString())).toBe(
      "<section><h1>Parent</h1><div data-ilha-slot=\"p:0\" data-ilha-props='{}'><button>0</button></div></section>",
    );
  });

  it("passes JSX props to a nested ilha island", () => {
    const Child = ilha
      .input(z.object({ label: z.string() }))
      .render(({ input }) => <strong>{input.label}</strong>);
    const Parent = ilha.render(() => (
      <section>
        <Child label="nested" />
      </section>
    ));

    expect(normalizeHtml(Parent.toString())).toBe(
      "<section><div data-ilha-slot=\"p:0\" data-ilha-props='{&quot;label&quot;:&quot;nested&quot;}'><strong>nested</strong></div></section>",
    );
  });

  it("renders arrays of nested ilha islands without commas", () => {
    const Item = ilha
      .input(z.object({ label: z.string() }))
      .render(({ input }) => <li>{input.label}</li>);
    const Parent = ilha.render(() => (
      <ul>
        {["a", "b"].map((label) => (
          <Item label={label} />
        ))}
      </ul>
    ));

    const out = Parent.toString();
    expect(out).not.toContain(",");
    expect(normalizeHtml(out)).toBe(
      "<ul><div data-ilha-slot=\"p:0\" data-ilha-props='{&quot;label&quot;:&quot;a&quot;}'><li>a</li></div><div data-ilha-slot=\"p:1\" data-ilha-props='{&quot;label&quot;:&quot;b&quot;}'><li>b</li></div></ul>",
    );
  });

  it("keeps a nested JSX island reactive after parent mount", () => {
    const Child = ilha
      .state("count", 0)
      .on("button@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => <button>{state.count()}</button>);
    const Parent = ilha.render(() => (
      <section>
        <Child />
      </section>
    ));

    const el = makeEl();
    const unmount = Parent.mount(el);
    const button = el.querySelector("button") as HTMLButtonElement;

    expect(button.textContent).toBe("0");
    button.click();
    expect(button.textContent).toBe("1");

    unmount();
    cleanup(el);
  });
});
