import { describe, expect, it } from "bun:test";

import { z } from "zod";

import ilha, { html, raw } from "./index";
import * as jsxDevRuntime from "./jsx-dev-runtime";
import { jsx, jsxs } from "./jsx-runtime";
import * as jsxRuntime from "./jsx-runtime";

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

describe("ilha JSX runtime", () => {
  it("subpath runtime exports JSX helpers", () => {
    expect(typeof jsxRuntime.jsx).toBe("function");
    expect(typeof jsxRuntime.jsxs).toBe("function");
    expect(typeof jsxRuntime.jsxDEV).toBe("function");
    expect(typeof jsxRuntime.Fragment).toBe("function");
    expect(typeof jsxDevRuntime.jsxDEV).toBe("function");
    expect(typeof jsxDevRuntime.Fragment).toBe("function");
  });

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

  it("renders non-JSX ilha island as child of JSX component", () => {
    const Child = ilha.render(
      () =>
        html`
          <span>child</span>
        `,
    );
    const Parent = ilha.render(() => (
      <div class="parent">
        <Child />
      </div>
    ));

    const result = Parent() as string;
    expect(result).toContain('class="parent"');
    expect(result).toContain("<span>child</span>");
    expect(result).toContain("data-ilha-slot=");
  });

  it("renders non-JSX ilha island via expression in JSX", () => {
    const Child = ilha.render(
      () =>
        html`
          <b>bold</b>
        `,
    );
    const Parent = ilha.render(() => <div>{Child()}</div>);

    const result = Parent() as string;
    expect(result).toContain("<b>bold</b>");
    expect(result).toContain("data-ilha-slot=");
  });

  it("renders a plain function component returning html`` inside a JSX ilha island", () => {
    const Child = () =>
      html`
        <span>plain child</span>
      `;
    const Parent = ilha.render(() => (
      <div class="parent">
        <Child />
      </div>
    ));

    const result = Parent() as string;
    expect(result).toContain('class="parent"');
    expect(result).toContain("<span>plain child</span>");
  });

  it("mounts a plain function component returning html`` inside a JSX ilha island", () => {
    const Child = () =>
      html`
        <span class="child">mounted child</span>
      `;
    const Parent = ilha.render(() => (
      <div class="parent">
        <Child />
      </div>
    ));

    const el = makeEl();
    const unmount = Parent.mount(el);

    expect(el.querySelector(".parent")).not.toBeNull();
    expect(el.querySelector(".child")?.textContent).toBe("mounted child");

    unmount();
    cleanup(el);
  });

  it("mounts a non-JSX ilha island inside a JSX parent and keeps it reactive", () => {
    const Child = ilha
      .state("count", 0)
      .on("button@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => html`<button>${state.count()}</button>`);

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

  it("supports bind:value on nested object property in JSX", () => {
    const Form = ilha
      .state("user", { name: "Ada", email: "ada@example.com" })
      .render(({ state }) => (
        <div>
          <input bind:value={state.user.select((u) => u.name)} />
          <p>{state.user().name}</p>
        </div>
      ));

    const el = makeEl();
    const unmount = Form.mount(el);
    const input = el.querySelector("input") as HTMLInputElement;

    expect(input.value).toBe("Ada");
    expect(el.querySelector("p")!.textContent).toBe("Ada");

    input.value = "Grace";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(el.querySelector("p")!.textContent).toBe("Grace");

    unmount();
    cleanup(el);
  });

  it("supports bind:value on array items via select in JSX", () => {
    const List = ilha.state("users", ["Ada", "Grace"]).render(({ state }) => (
      <ul>
        {state.users().map((_, i) => (
          <li>
            <input bind:value={state.users.select((u) => u[i])} />
          </li>
        ))}
      </ul>
    ));

    const el = makeEl();
    const unmount = List.mount(el);
    const inputs = el.querySelectorAll("input");

    expect(inputs.length).toBe(2);
    expect((inputs[0] as HTMLInputElement).value).toBe("Ada");
    expect((inputs[1] as HTMLInputElement).value).toBe("Grace");

    (inputs[0] as HTMLInputElement).value = "Alan";
    (inputs[0] as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true }));

    expect((inputs[0] as HTMLInputElement).value).toBe("Alan");
    expect((inputs[1] as HTMLInputElement).value).toBe("Grace");

    unmount();
    cleanup(el);
  });

  it("supports bind:value on array index in JSX", () => {
    const List = ilha.state("items", ["a", "b"]).render(({ state }) => (
      <div>
        {state.items().map((_, i) => (
          <input bind:value={state.items.select((items) => items[i])} />
        ))}
      </div>
    ));

    const el = makeEl();
    const unmount = List.mount(el);
    const inputs = el.querySelectorAll("input");

    expect((inputs[0] as HTMLInputElement).value).toBe("a");

    (inputs[0] as HTMLInputElement).value = "z";
    (inputs[0] as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true }));

    expect((inputs[0] as HTMLInputElement).value).toBe("z");
    expect((inputs[1] as HTMLInputElement).value).toBe("b");

    unmount();
    cleanup(el);
  });

  it("nested bind:value preserves sibling keys in JSX", () => {
    const Form = ilha
      .state("user", { name: "Ada", email: "ada@example.com" })
      .render(({ state }) => (
        <div>
          <input bind:value={state.user.select((u) => u.name)} />
          <p data-email>{state.user().email}</p>
        </div>
      ));

    const el = makeEl();
    const unmount = Form.mount(el);
    const input = el.querySelector("input") as HTMLInputElement;

    input.value = "Grace";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(el.querySelector("[data-email]")!.textContent).toBe("ada@example.com");

    unmount();
    cleanup(el);
  });

  it("programmatic nested write updates bound input in JSX", () => {
    let nameAccessor!: (v?: string) => string | void;

    const Form = ilha.state("user", { name: "Ada" }).render(({ state }) => {
      nameAccessor = state.user.select((u) => u.name) as typeof nameAccessor;
      return <input bind:value={state.user.select((u) => u.name)} />;
    });

    const el = makeEl();
    const unmount = Form.mount(el);
    nameAccessor("Grace");
    expect((el.querySelector("input") as HTMLInputElement).value).toBe("Grace");

    unmount();
    cleanup(el);
  });

  it("does not bind when mapping snapshot array from state() in JSX", () => {
    const List = ilha.state("users", ["Ada"]).render(({ state }) => (
      <div>
        {state.users().map((u) => (
          <input data-u bind:value={u} />
        ))}
        <span data-out>{state.users()[0]}</span>
      </div>
    ));

    const el = makeEl();
    const unmount = List.mount(el);
    const input = el.querySelector("[data-u]") as HTMLInputElement;
    expect(input.getAttribute("data-ilha-bind")).toBeNull();

    input.value = "Grace";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(el.querySelector("[data-out]")!.textContent).toBe("Ada");

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

  it("jsx key prop on nested ilha island uses k:{key} slot id", () => {
    const Child = ilha
      .input(z.object({ label: z.string() }))
      .render(({ input }) => <strong>{input.label}</strong>);
    const Parent = ilha.render(() => (
      <section>
        <Child key="item-a" label="a" />
      </section>
    ));

    expect(normalizeHtml(Parent.toString())).toBe(
      "<section><div data-ilha-slot=\"k:item-a\" data-ilha-props='{&quot;label&quot;:&quot;a&quot;}'><strong>a</strong></div></section>",
    );
  });

  it("jsx key on list items preserves child identity after delete", () => {
    const Child = ilha
      .input(z.object({ label: z.string() }))
      .state("n", 0)
      .on("button@click", ({ state }) => state.n(state.n() + 1))
      .render(({ input, state }) => (
        <>
          <span data-label={input.label}>
            {input.label}:{state.n()}
          </span>
          <button>+</button>
        </>
      ));

    let setLabels!: (v: string[]) => void;

    const Parent = ilha.state<string[]>("labels", ["a", "b", "c"]).render(({ state }) => {
      setLabels = state.labels as unknown as typeof setLabels;
      return (
        <div>
          {state.labels().map((label) => (
            <Child key={label} label={label} />
          ))}
        </div>
      );
    });

    const el = makeEl();
    const unmount = Parent.mount(el);

    const slot = (label: string) =>
      el.querySelector(`[data-ilha-slot="k:${label}"]`) as HTMLElement;

    slot("b").querySelector("button")!.click();
    expect(slot("b").querySelector("[data-label]")!.textContent).toBe("b:1");

    setLabels(["a", "c"]);

    expect(el.querySelector("[data-ilha-slot='k:b']")).toBeNull();
    expect(slot("a").querySelector("[data-label]")!.textContent).toBe("a:0");
    expect(slot("c").querySelector("[data-label]")!.textContent).toBe("c:0");

    unmount();
    cleanup(el);
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

  it("strips key prop from rendered HTML", () => {
    const result = <li key="abc">item</li>;
    expect(result.value).not.toContain("key=");
    expect(result.value).toBe("<li>item</li>");
  });

  it("explicit children prop is overridden by JSX children", () => {
    const result = jsx("p", { children: "from prop" }, ["from slot"]);
    expect(result.value).toBe("<p>from slot</p>");
  });

  it("renders boolean true attribute without value", () => {
    expect((<input disabled={true} />).value).toContain("disabled");
    expect((<input disabled={true} />).value).not.toContain('disabled="');
  });

  it("omits boolean false attribute", () => {
    expect((<input disabled={false} />).value).not.toContain("disabled");
  });

  it("maps className to class in output HTML", () => {
    expect((<div className="foo" />).value).toContain('class="foo"');
    expect((<div className="foo" />).value).not.toContain("className=");
  });

  it("maps htmlFor to for on label", () => {
    expect((<label htmlFor="email" />).value).toContain('for="email"');
    expect((<label htmlFor="email" />).value).not.toContain("htmlFor=");
  });

  it("serializes style object to CSS string", () => {
    expect((<div style={{ color: "red", fontSize: "14px" }} />).value).toContain(
      'style="color:red;font-size:14px"',
    );
  });

  it("passes string style through unchanged", () => {
    expect((<div style="color:red" />).value).toContain('style="color:red"');
  });

  it("Fragment produces no wrapper element", () => {
    const result = (
      <>
        <span>a</span>
        <span>b</span>
      </>
    );
    expect(result.value).toBe("<span>a</span><span>b</span>");
    expect(result.value).not.toMatch(/^<div/);
  });

  it("Fragment with a single child produces no wrapper", () => {
    expect((<p>only</p>).value).toBe("<p>only</p>");
  });

  it("nested Fragments flatten without wrappers", () => {
    const result = (
      <>
        <>
          <span>x</span>
        </>
      </>
    );
    expect(result.value).toBe("<span>x</span>");
  });

  it("renders 0 as text", () => {
    expect((<p>{0}</p>).value).toBe("<p>0</p>");
  });

  it("does not render false as a child", () => {
    expect((<p>{false}</p>).value).toBe("<p></p>");
  });

  it("does not render true as a child", () => {
    expect((<p>{true}</p>).value).toBe("<p></p>");
  });

  it("renders void elements without closing tag", () => {
    expect((<br />).value).toBe("<br>");
    expect((<img src="x.png" alt="x" />).value).not.toContain("</img>");
  });

  it("drops event handler attributes from spreads (onX)", () => {
    const evil = { id: "ok", onload: "alert(1)" };
    expect((<div {...evil} />).value).not.toContain("onload");
    expect((<div {...evil} />).value).toContain('id="ok"');
  });

  it("function component returning null renders empty string", () => {
    const Empty = () => null;
    expect((<Empty />).value ?? "").toBe("");
  });

  it("function component returning undefined renders empty string", () => {
    const Undef = () => undefined;
    expect((<Undef />).value ?? "").toBe("");
  });

  it("blocks javascript: href", () => {
    expect((<a href="javascript:alert(1)">x</a>).value).not.toContain("javascript:");
    expect((<a href="javascript:alert(1)">x</a>).value).toBe("<a>x</a>");
  });

  it("allows https: href", () => {
    expect((<a href="https://example.com">x</a>).value).toContain('href="https://example.com"');
  });

  it("blocks data:text/html src", () => {
    expect((<iframe src="data:text/html,<script>x</script>" />).value).not.toContain("data:text");
  });

  it("bind: with non-signal value is rejected", () => {
    const result = (<input bind:value={{ not: "a signal" }} />).value;
    expect(result).not.toContain("[object Object]");
    expect(result).toBe("<input>");
  });

  it("ignores __proto__ as an attribute name from spreads", () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true}}');
    expect((<div {...evil} />).value).not.toContain("__proto__");
  });

  it("ignores constructor as an attribute name", () => {
    expect((<div constructor="x" />).value).not.toContain("constructor=");
  });

  it("style value cannot break out of style attribute", () => {
    const result = (<div style={{ color: '"bad; }body{display:none' }} />).value;
    expect(result).not.toContain('"bad');
    expect(result).not.toContain("}body");
  });

  it("style property name with invalid characters is dropped", () => {
    const result = (<div style={{ ["color; x:y"]: "red" }} />).value;
    expect(result).not.toContain("color; x:y");
  });

  it("void element silently ignores children", () => {
    expect((<br>{"text"}</br>).value).toBe("<br>");
  });

  it("children prop is used when no JSX children", () => {
    const result = (<p children="from-prop" />).value;
    expect(result).toBe("<p>from-prop</p>");
  });

  it("Fragment with mixed children types", () => {
    const result = (
      <>
        {0}
        {false}
        {"ok"}
      </>
    ).value;
    expect(result).toBe("0ok");
  });

  it("bind:value escapes XSS in SSR output", () => {
    const Island = ilha
      .state("name", "<script>alert(1)</script>")
      .render(({ state }) => <input bind:value={state.name} />);

    const out = Island();
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("blocks javascript: href with leading whitespace", () => {
    expect((<a href="   javascript:alert(1)">x</a>).value).not.toContain("javascript:");
  });

  it("blocks newline-prefixed javascript: href", () => {
    expect((<a href={"\njavascript:alert(1)"}>x</a>).value).not.toContain("javascript:");
  });

  it("blocks javascript: href with embedded control characters", () => {
    // HTML parsers strip tab/newline/CR inside URLs before resolving the scheme.
    expect((<a href={"java\tscript:alert(1)"}>x</a>).value).toBe("<a>x</a>");
    expect((<a href={"java\nscript:alert(1)"}>x</a>).value).toBe("<a>x</a>");
    expect((<a href={"j\rava\tscript:alert(1)"}>x</a>).value).toBe("<a>x</a>");
    expect((<a href={" javascript:alert(1)"}>x</a>).value).toBe("<a>x</a>");
  });

  it("blocks control-char data:text/html src", () => {
    expect((<iframe src={"data:text\n/html,<script>alert(1)</script>"} />).value).toBe(
      "<iframe></iframe>",
    );
  });

  it("drops srcdoc attributes entirely", () => {
    const out = (<iframe srcdoc="<script>alert(1)</script>" />).value;
    expect(out).toBe("<iframe></iframe>");
    expect(out).not.toContain("srcdoc");
  });

  it("className as array joins truthy entries", () => {
    expect((<div className={["foo", false, "bar"]} />).value).toContain('class="foo bar"');
  });

  it("className as object uses enabled keys", () => {
    expect((<div className={{ active: true, disabled: false }} />).value).toContain(
      'class="active"',
    );
    expect((<div className={{ active: true, disabled: false }} />).value).not.toContain("disabled");
  });

  it("style value strips CSS expression() injection", () => {
    const result = (<div style={{ color: "expression(alert(1))" }} />).value;
    expect(result).not.toContain("expression(");
    expect(result).not.toContain("(");
  });

  it("function component returning an IslandCall renders correctly", () => {
    const Child = ilha.state("x", 42).render(({ state }) => <span>{state.x()}</span>);
    const Parent = () => Child();
    expect((<Parent />).value).toContain("42");
  });

  it("cross-entry JSX island composition mounts interactively", () => {
    const Child = ilha
      .state("count", 0)
      .on("button@click", ({ state }) => state.count(state.count() + 1))
      .render(({ state }) => <button>{state.count()}</button>);
    const Parent = ilha.render(() =>
      jsxRuntime.jsx("div", { children: jsxRuntime.jsx(Child, {}) }),
    );

    const el = makeEl();
    const unmount = Parent.mount(el);
    el.querySelector<HTMLButtonElement>("button")!.click();
    expect(el.querySelector("button")!.textContent).toBe("1");
    unmount();
    cleanup(el);
  });

  it("JSX island component returning SSR string emits slot instead of escaping", () => {
    const Child = ilha.render(
      () =>
        html`
          <span>child</span>
        `,
    );
    const CrossBundleChild = Object.assign(
      (props?: Record<string, unknown>) => Child.toString(props),
      {
        [Symbol.for("ilha.island")]: true,
        toString: Child.toString.bind(Child),
        mount: Child.mount.bind(Child),
      },
    );
    const Parent = ilha.render(() => (
      <div>
        <CrossBundleChild />
      </div>
    ));

    const result = Parent() as string;
    expect(result).not.toContain("&lt;span");
    expect(result).toContain("data-ilha-slot=");
    expect(result).toContain("<span>child</span>");
  });

  it("key prop is not passed to function components", () => {
    let received: Record<string, unknown> = {};
    const C = (props: Record<string, unknown>) => {
      received = { ...props };
      return <span />;
    };
    const r = <C key="abc" id="x" />;
    expect(r.value).toBe("<span></span>");
    expect(received).not.toHaveProperty("key");
    expect(received).toHaveProperty("id", "x");
  });

  it("empty Fragment renders empty string", () => {
    expect((<></>).value).toBe("");
  });

  it("allows safe data: image URIs", () => {
    expect((<img src="data:image/png;base64,abc" />).value).toContain("data:image/png");
  });

  it("blocks data:image/svg+xml that could contain script", () => {
    expect(
      (<img src="data:image/svg+xml,<svg><script>alert(1)</script></svg>" />).value,
    ).not.toContain("data:image/svg");
  });

  it("jsxs produces the same output as jsx with multiple children", () => {
    const viaJsx = jsx("div", {
      children: [jsx("span", { children: "a" }), jsx("span", { children: "b" })],
    });
    const viaJsxs = jsxs("div", {
      children: [jsx("span", { children: "a" }), jsx("span", { children: "b" })],
    });
    expect(viaJsx.value).toBe(viaJsxs.value);
    expect(viaJsxs.value).toBe("<div><span>a</span><span>b</span></div>");
  });

  it("supports CSS custom properties in style object", () => {
    const result = (<div style={{ "--accent": "#f00", color: "red" }} />).value;
    expect(result).toContain("--accent:#f00");
    expect(result).toContain("color:red");
  });

  it("preserves valid CSS functions like calc() and rgb() in style values", () => {
    const result = (<div style={{ width: "calc(100% - 20px)", color: "rgb(255,0,0)" }} />).value;
    expect(result).toContain("width:calc(100% - 20px)");
    expect(result).toContain("color:rgb(255,0,0)");
  });

  it("blocks javascript: in style values", () => {
    const result = (<div style={{ background: "javascript:alert(1)" }} />).value;
    expect(result).not.toContain("javascript:");
  });

  it("bind:value SSR emits current value as value attribute", () => {
    const Island = ilha
      .state("name", "Ada")
      .render(({ state }) => <input bind:value={state.name} />);

    expect(Island()).toContain('value="Ada"');
  });

  it("bind:this writes the element reference into a signal on mount", () => {
    const Island = ilha
      .state("el", null as Element | null)
      .render(({ state }) => <div bind:this={state.el} id="target" />);

    const host = makeEl();
    const unmount = Island.mount(host);
    const div = host.querySelector("#target") as HTMLDivElement;

    expect(div).toBeTruthy();
    unmount();
    cleanup(host);
  });

  it("serializeStyle rejects declarations whose value could smuggle extra declarations", () => {
    const result = (<div style={{ color: "red;background:url(evil)", padding: "4px" }} />).value;
    // The tainted declaration is dropped whole (not rewritten); safe ones stay.
    expect(result).not.toContain("background");
    expect(result).not.toContain("color");
    expect(result).toContain("padding:4px");
  });

  it("Fragment nested inside a JSX element flattens its children inline", () => {
    const result = (
      <ul>
        <>
          <li>a</li>
          <li>b</li>
        </>
      </ul>
    );
    expect(result.value).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  it("blocks tab-prefixed javascript: href", () => {
    expect((<a href={"\tjavascript:alert(1)"}>x</a>).value).not.toContain("javascript:");
  });

  it("key prop does not appear on rendered element from function component", () => {
    const Item = (props: { label: string }) => <li>{props.label}</li>;
    const result = <Item key="abc" label="x" />;
    expect(result.value).toBe("<li>x</li>");
    expect(result.value).not.toContain("key=");
  });

  it("bind:group SSR emits checked on matching radio input", () => {
    const Island = ilha.state("color", "red").render(
      ({ state }) => html`
        <input type="radio" value="red" bind:group=${state.color} />
        <input type="radio" value="blue" bind:group=${state.color} />
      `,
    );
    const out = Island();
    expect(out).toMatch(/value="red"[^>]*checked/);
    expect(out).not.toMatch(/value="blue"[^>]*checked/);
  });

  it("bind:valueAsDate SSR emits ISO date string as value", () => {
    const Island = ilha
      .state("date", new Date("2025-06-15"))
      .render(({ state }) => <input type="date" bind:valueAsDate={state.date} />);
    expect(Island()).toContain('value="2025-06-15"');
  });

  it("normalizeClass filters empty strings from array", () => {
    expect((<div className={["a", "", "b"]} />).value).toContain('class="a b"');
  });

  it("warns in DEV when bind: is used outside an island render context", () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(msg);

    try {
      // Force a fresh render context by calling html`` directly
      const result = html`<input bind:value=${ilha.signal("x")} />`;
      expect(result).toBeDefined();

      // Should have emitted at least one warning about missing context
      expect(warnings.some((w) => w.includes("bind") || w.includes("context"))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("warns in DEV for unknown bind: kind", () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(msg);

    try {
      const Island = ilha.render(() => <input bind:foobar={ilha.signal("x")} />);
      Island();

      expect(warnings.some((w) => w.includes("Unknown") || w.includes("foobar"))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("ilha JSX runtime — compound component children", () => {
  it("plain object children with custom toString are rendered as raw HTML inside parent", () => {
    const RENDER_PART = Symbol.for("ilha.renderPart");
    function Root(props: { children?: any }) {
      const kids: any[] = Array.isArray(props.children) ? props.children : [props.children];
      return html`<root>${kids}</root>`;
    }
    Root.Part = function Part(props: { label: string }) {
      const part: any = { [RENDER_PART]: true };
      Object.defineProperty(part, "toString", {
        value: () => `<part>${props.label}</part>`,
        enumerable: false,
      });
      return part;
    };

    const result = (
      <Root>
        <Root.Part label="A" />
        <Root.Part label="B" />
      </Root>
    );
    expect(result.value).toBe("<root><part>A</part><part>B</part></root>");
  });

  it("plain object children do not appear as escaped [object Object]", () => {
    const RENDER_PART = Symbol.for("ilha.renderPart");
    function Wrapper(props: { children?: any }) {
      const kids: any[] = Array.isArray(props.children) ? props.children : [props.children];
      return html`<wrap>${kids}</wrap>`;
    }
    (Wrapper as any).Slot = function Slot(_props: {}) {
      const part: any = { [RENDER_PART]: true };
      Object.defineProperty(part, "toString", {
        value: () => "<slot/>",
        enumerable: false,
      });
      return part;
    };
    const W = Wrapper as any;
    const result = (
      <W>
        <W.Slot />
      </W>
    );
    expect(result.value).not.toContain("[object Object]");
    expect(result.value).toBe("<wrap><slot/></wrap>");
  });

  it("Areia-like Resizable: panels and handle rendered inside root, not as siblings", () => {
    const PART = "__resizablePart";
    const RENDER_PART = Symbol.for("ilha.renderPart");
    function createPart(type: string, input: any) {
      const part: any = { [PART]: type, input, [RENDER_PART]: true };
      Object.defineProperty(part, "toString", {
        value: () => {
          const r = renderPart(part);
          return typeof r === "object" && r !== null && "value" in r ? (r as any).value : String(r);
        },
        enumerable: false,
      });
      return part;
    }
    function renderPart(part: any) {
      if (part[PART] === "panel")
        return html`<div data-slot="resizable-panel">${part.input.children ?? ""}</div>`;
      return html`
        <div data-slot="resizable-handle"></div>
      `;
    }
    function renderChildren(v: any): any {
      if (v == null) return "";
      if (Array.isArray(v)) return v.map(renderChildren);
      if (typeof v === "object" && PART in v) return renderPart(v);
      if (typeof v === "object" && "value" in v && typeof v.value === "string") return raw(v.value);
      return v;
    }
    function ResizablePanel(input: any) {
      return createPart("panel", input);
    }
    function ResizableHandle(input: any) {
      return createPart("handle", input);
    }
    function Resizable(input: any) {
      const kids = Array.isArray(input.children) ? input.children : [input.children];
      return html`<div data-slot="resizable">${renderChildren(kids)}</div>`;
    }
    (Resizable as any).Panel = ResizablePanel;
    (Resizable as any).Handle = ResizableHandle;
    const R = Resizable as any;

    const result = (
      <R>
        <R.Panel>content A</R.Panel>
        <R.Handle />
        <R.Panel>content B</R.Panel>
      </R>
    );

    expect(result.value).toContain('data-slot="resizable"');
    expect(result.value).toContain('data-slot="resizable-panel"');
    expect(result.value).toContain('data-slot="resizable-handle"');
    expect(result.value).not.toContain("[object Object]");
    // panels must be inside the root, not siblings
    const rootIdx = result.value.indexOf('data-slot="resizable"');
    const panelIdx = result.value.indexOf('data-slot="resizable-panel"');
    expect(panelIdx).toBeGreaterThan(rootIdx);
  });
});
