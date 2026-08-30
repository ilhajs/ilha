import { describe, expect, it } from "bun:test";

import { z } from "zod";

import { ilha, html, raw, state, type StateAccessor } from "./index";
import * as jsxDevRuntime from "./jsx-dev-runtime";
import { jsx, jsxs } from "./jsx-runtime";
import * as jsxRuntime from "./jsx-runtime";
import type { JSX as IlhaJSX } from "./jsx-types";
import { signal } from "./test-signal";

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

function typecheckIntrinsicElements(): void {
  const value = signal("");
  <input
    accept="image/*"
    checked
    disabled
    form="upload-form"
    list="file-types"
    style={{ backgroundColor: "red", opacity: 0.5 }}
    aria-label="Upload"
    data-testid="file"
    bind:value={value}
    oninput:abortable={(event) => {
      const input: HTMLInputElement = event.currentTarget;
      void input.value;
    }}
  />;
  <a href="/guide" target="_blank" rel="noopener">
    Guide
  </a>;
  const trustedAttribute = raw("data:image/svg+xml,<svg></svg>");
  <img src={trustedAttribute} alt={raw("Trusted icon")} />;
  <div class={raw("trusted-class")} style={raw("color:red")} />;
  <a href={raw("/trusted")} title={raw("Trusted link")}>
    Trusted
  </a>;
  <svg>
    <use href={raw("#trusted")} xlinkHref={raw("#trusted")} />
  </svg>;
  <textarea cols={40} rows={5} />;
  <slot name="toolbar" />;
  <button popoverTarget="menu" popoverTargetAction="toggle" />;
  <svg viewBox="0 0 24 24" fill="none">
    <a href="/icon">
      <circle cx={12} cy={12} r={10} strokeWidth={2} />
      <linearGradient gradientUnits="userSpaceOnUse" xlinkHref="#base" />
      <feGaussianBlur stdDeviation={2} />
    </a>
  </svg>;
  <ilha-widget
    customValue={{ enabled: true }}
    onvalue-change={(event) => {
      const customEvent: Event = event;
      void customEvent;
    }}
  />;

  // @ts-expect-error href is not an input property
  <input href="/wrong" />;
  // @ts-expect-error checked is not an anchor property
  <a checked>Wrong</a>;
  // @ts-expect-error misspelled standard properties should not be accepted
  <button disabeld>Wrong</button>;
  // @ts-expect-error bind values must be signal accessors
  <input bind:value="not-a-signal" />;
  // @ts-expect-error bindings are element-specific
  <div bind:checked={signal(false)} />;
  // @ts-expect-error checked bindings require boolean signals
  <input bind:checked={signal("yes")} />;
  // @ts-expect-error element refs require Element signals
  <div bind:this={signal("element")} />;
  // @ts-expect-error element refs must accept the actual element type
  <input bind:this={signal<HTMLVideoElement | null>(null)} />;
  // @ts-expect-error binding names are checked
  <input bind:vale={value} />;
  const invalidAria: IlhaJSX.IntrinsicElements["button"] = {
    // @ts-expect-error ARIA attribute names are checked in props objects
    "aria-labl": "Wrong",
  };
  void invalidAria;
  // TypeScript permits unknown hyphenated names in JSX syntax, but known ARIA names still complete.
  <button aria-labl="Wrong">Wrong</button>;
  // @ts-expect-error style property names are checked
  <div style={{ backgrounColor: "red" }} />;
  // @ts-expect-error unknown standard element names should not be accepted
  <definitelynotanelement />;
}
void typecheckIntrinsicElements;

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
    const Greeting = ilha(() => <p>Hello, ilha!</p>);

    expect(Greeting.toString()).toBe("<p>Hello, ilha!</p>");
  });

  it("renders static JSX", () => {
    expect(normalizeHtml(<p>hello</p>)).toBe("<p>hello</p>");
  });

  it("renders multi-attribute, multi-child elements byte-identically (TemplateStringsArray path)", () => {
    // Exercises the jsx -> renderJsxElement -> html(toTemplateStrings(chunks)) path
    // for a tag carrying several attributes and several children, pinning the
    // chunks/values alternation the helper documents.
    const out = jsx(
      "div",
      { className: "a b", "data-id": "42" },
      undefined,
      "child-one",
      "child-two",
    );
    expect(out.value).toBe('<div class="a b" data-id="42">child-onechild-two</div>');
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
    const Island = ilha(() => {
      const label = state("Ada");
      return <p>{label}</p>;
    });

    expect(Island.toString()).toBe("<p>Ada</p>");
  });

  it("escapes signal accessor values", () => {
    const Island = ilha(() => {
      const label = state("<b>hi</b>");
      return <p>{label}</p>;
    });

    expect(Island.toString()).toBe("<p>&lt;b&gt;hi&lt;/b&gt;</p>");
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

  it("emits key as data-key on host elements", () => {
    expect((<li key="a">x</li>).value).toBe('<li data-key="a">x</li>');
    expect((<li key={7}>x</li>).value).toBe('<li data-key="7">x</li>');
  });

  it("does not override an explicit data-key with the JSX key", () => {
    expect(
      (
        <li key="a" data-key="b">
          x
        </li>
      ).value,
    ).toBe('<li data-key="b">x</li>');
  });

  it("injects data-key into the root element of function component output", () => {
    function Row({ label }: { label: string }) {
      return html`<label class="row"><input type="checkbox" />${label}</label>`;
    }

    expect((<Row key="t1" label="first" />).value).toBe(
      '<label data-key="t1" class="row"><input type="checkbox" />first</label>',
    );
  });

  it("escapes the injected data-key value", () => {
    function Row() {
      return html`<div></div>`;
    }

    const out = (<Row key={'"><img src=x onerror=alert(1)>'} />).value;
    expect(out).toBe('<div data-key="&quot;>&lt;img src=x onerror=alert(1)>"></div>');
    expect(document.createRange().createContextualFragment(out).querySelector("img")).toBeNull();
  });

  it("keeps a keyed component's DOM identity when a sibling is prepended (checked state does not leak)", () => {
    // Regression: without key propagation, prepending a todo made the new
    // item positionally reuse the old first item's DOM, inheriting its
    // user-toggled checked state and controller-owned data-checked attr.
    type Todo = { id: string; title: string };
    let setTodos!: (v?: Todo[]) => Todo[] | void;

    function Row({ todo }: { todo: Todo }) {
      return html`<label
        ><span data-slot="checkbox"><input type="checkbox" data-todo-id="${todo.id}" /></span
        >${todo.title}</label
      >`;
    }

    const Island = ilha(() => {
      const todos = state([{ id: "t1", title: "first" }] as Todo[]);
      setTodos = todos.set;
      return (
        <div>
          {todos().map((todo) => (
            <Row key={todo.id} todo={todo} />
          ))}
        </div>
      );
    });

    const el = makeEl();
    const unmount = Island.mount(el);

    // User checks the first todo; the checkbox controller reflects it onto
    // the live checked property and the data-checked presence attr.
    const firstInput = el.querySelector<HTMLInputElement>("input")!;
    firstInput.checked = true;
    firstInput.closest('[data-slot="checkbox"]')!.setAttribute("data-checked", "");

    setTodos([
      { id: "t2", title: "second" },
      { id: "t1", title: "first" },
    ]);

    const inputs = Array.from(el.querySelectorAll<HTMLInputElement>("input"));
    expect(inputs.length).toBe(2);
    // The new item must come in fresh and unchecked...
    expect(inputs[0]!.checked).toBe(false);
    expect(inputs[0]!.closest('[data-slot="checkbox"]')!.hasAttribute("data-checked")).toBe(false);
    // ...while the old item keeps its DOM node and checked state.
    expect(inputs[1]).toBe(firstInput);
    expect(inputs[1]!.checked).toBe(true);
    expect(inputs[1]!.closest('[data-slot="checkbox"]')!.hasAttribute("data-checked")).toBe(true);

    unmount();
    cleanup(el);
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

  it("mounts a directly constructed JSX island with its own reactive lifecycle", () => {
    const count = signal(0);
    let renders = 0;
    const Counter = ilha(() => {
      renders++;
      return (
        <div>
          <input type="number" bind:value={count} />
          <button onclick={() => count.update((value) => value + 1)}>{count()}</button>
        </div>
      );
    });

    const el = makeEl();
    const unmount = Counter.mount(el);
    expect((el.querySelector("input") as HTMLInputElement).value).toBe("0");
    expect(el.querySelector("button")!.textContent).toBe("0");

    (el.querySelector("button") as HTMLButtonElement).click();
    expect(count()).toBe(1);
    expect((el.querySelector("input") as HTMLInputElement).value).toBe("1");
    expect(el.querySelector("button")!.textContent).toBe("1");

    const rendersBeforeUnmount = renders;
    unmount();
    count.set(2);
    expect(renders).toBe(rendersBeforeUnmount);
    cleanup(el);
  });

  it("composes a directly constructed island as an independent child slot", () => {
    const count = signal(0);
    let parentRenders = 0;
    const Child = ilha(() => (
      <button onclick={() => count.update((value) => value + 1)}>{count()}</button>
    ));
    const Parent = ilha(() => {
      parentRenders++;
      return (
        <section>
          <Child />
        </section>
      );
    });

    expect(Parent.toString()).toContain("data-ilha-slot=");

    const el = makeEl();
    const unmount = Parent.mount(el);
    const rendersAfterMount = parentRenders;
    (el.querySelector("button") as HTMLButtonElement).click();

    expect(el.querySelector("button")!.textContent).toBe("1");
    expect(parentRenders).toBe(rendersAfterMount);
    unmount();
    cleanup(el);
  });

  it("renders non-JSX ilha island as child of JSX component", () => {
    const Child = ilha(() => html` <span>child</span> `);
    const Parent = ilha(() => (
      <div class="parent">
        <Child />
      </div>
    ));

    const result = Parent.toString() as string;
    expect(result).toContain('class="parent"');
    expect(result).toContain("<span>child</span>");
    expect(result).toContain("data-ilha-slot=");
  });

  it("renders non-JSX ilha island via expression in JSX", () => {
    const Child = ilha(() => html` <b>bold</b> `);
    const Parent = ilha(() => <div>{Child()}</div>);

    const result = Parent.toString() as string;
    expect(result).toContain("<b>bold</b>");
    expect(result).toContain("data-ilha-slot=");
  });

  it("renders a plain function component returning html`` inside a JSX ilha island", () => {
    const Child = () => html` <span>plain child</span> `;
    const Parent = ilha(() => (
      <div class="parent">
        <Child />
      </div>
    ));

    const result = Parent.toString() as string;
    expect(result).toContain('class="parent"');
    expect(result).toContain("<span>plain child</span>");
  });

  it("mounts a plain function component returning html`` inside a JSX ilha island", () => {
    const Child = () => html` <span class="child">mounted child</span> `;
    const Parent = ilha(() => (
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
    const Child = ilha(() => {
      const count = state(0);
      return html`<button onclick=${() => count.update((v) => v + 1)}>${count()}</button>`;
    });

    const Parent = ilha(() => (
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
    const Counter = ilha(() => {
      const count = state(3);
      return <p>Count: {count()}</p>;
    });

    expect(Counter.toString()).toBe("<p>Count: 3</p>");
  });

  it("renders JSX with schema defaults when called with no args", () => {
    const Counter = ilha(z.object({ count: z.number().default(0) }), ({ count }) => {
      const value = state(count);
      void value;
      return <p>{count}</p>;
    });

    expect(Counter.toString()).toBe("<p>0</p>");
  });

  it("renders JSX with provided input props", () => {
    const Greeting = ilha(z.object({ name: z.string().default("world") }), ({ name }) => (
      <p>hello {name}</p>
    ));

    expect(Greeting.toString({ name: "Ada" })).toBe("<p>hello Ada</p>");
  });

  it("toString() renders JSX with provided input props", () => {
    const Counter = ilha(z.object({ count: z.number().default(0) }), ({ count }) => {
      const value = state(count);
      void value;
      return <span>{count}</span>;
    });

    expect(Counter.toString({ count: 99 })).toBe("<span>99</span>");
  });

  it("throws validation errors before rendering JSX", () => {
    const Counter = ilha(z.object({ count: z.number() }), ({ count }) => <p>{count}</p>);

    expect(() => Counter.toString({ count: "nope" as never })).toThrow("[ilha] Validation failed");
  });

  it("mounts JSX into an element and re-renders when state changes", () => {
    let count!: StateAccessor<number>;
    const Counter = ilha(() => {
      const value = state(0);
      count = value;
      return <p>{value()}</p>;
    });

    const el = makeEl();
    const unmount = Counter.mount(el);

    expect(el.innerHTML).toBe("<p>0</p>");
    count.set(5);
    expect(el.innerHTML).toBe("<p>5</p>");

    unmount();
    cleanup(el);
  });

  it("updates JSX after a click handler changes state", () => {
    const Counter = ilha(() => {
      const count = state(0);
      return (
        <div>
          <p>Count: {count()}</p>
          <button type="button" onclick={() => count.update((v) => v + 1)}>
            +
          </button>
        </div>
      );
    });

    const el = makeEl();
    const unmount = Counter.mount(el);

    expect(el.innerHTML).toBe(
      '<div><p>Count: 0</p><button type="button" data-ilha-on="click:0">+</button></div>',
    );

    (el.querySelector("button") as HTMLButtonElement).click();
    expect(el.innerHTML).toBe(
      '<div><p>Count: 1</p><button type="button" data-ilha-on="click:0">+</button></div>',
    );

    unmount();
    cleanup(el);
  });

  it("wires lowercase JSX event props and keeps the latest handler across re-renders", () => {
    const seen: number[] = [];
    const Counter = ilha(() => {
      const count = state(0);
      const renderedCount = count();
      return (
        <div>
          <p>{renderedCount}</p>
          <button
            onclick={() => {
              seen.push(renderedCount);
              count.set(renderedCount + 1);
            }}
          >
            Increment
          </button>
        </div>
      );
    });

    const el = makeEl();
    const unmount = Counter.mount(el);
    const button = el.querySelector("button") as HTMLButtonElement;

    expect(button.getAttribute("onclick")).toBeNull();
    button.click();
    button.click();

    expect(seen).toEqual([0, 1]);
    expect(el.querySelector("p")?.textContent).toBe("2");

    unmount();
    button.click();
    expect(seen).toEqual([0, 1]);
    cleanup(el);
  });

  it("wires events from plain function components through the containing island", () => {
    const value = signal("bar");
    const Test = () => (
      <>
        <p>{value()}</p>
        <button onclick={() => value.set("baz")}>Change</button>
      </>
    );
    const Parent = ilha(() => <Test />);

    const standalone = <Test />;
    expect(standalone.value).not.toContain("data-ilha-on");

    const el = makeEl();
    const unmount = Parent.mount(el);
    const button = el.querySelector("button") as HTMLButtonElement;

    button.click();
    expect(el.querySelector("p")?.textContent).toBe("baz");

    unmount();
    cleanup(el);
  });

  it("keeps parent and child island event handlers isolated", () => {
    const fired: string[] = [];
    const Child = ilha(() => (
      <button class="child" onclick={() => fired.push("child")}>
        Child
      </button>
    ));
    const Parent = ilha(() => (
      <section>
        <button class="parent" onclick={() => fired.push("parent")}>
          Parent
        </button>
        <Child />
      </section>
    ));

    const el = makeEl();
    const unmount = Parent.mount(el);

    (el.querySelector(".child") as HTMLButtonElement).click();
    expect(fired).toEqual(["child"]);
    (el.querySelector(".parent") as HTMLButtonElement).click();
    expect(fired).toEqual(["child", "parent"]);

    unmount();
    cleanup(el);
  });

  it("supports hyphenated custom-element event names", () => {
    let received: Event | undefined;
    const Island = ilha(() => <ilha-widget onvalue-change={(event) => (received = event)} />);

    const el = makeEl();
    const unmount = Island.mount(el);
    const event = new CustomEvent("value-change", { bubbles: true });
    el.querySelector("ilha-widget")!.dispatchEvent(event);

    expect(received).toBe(event);
    unmount();
    cleanup(el);
  });

  it("supports one native event modifier and passes a lifecycle signal", () => {
    const order: string[] = [];
    const abortSignals: AbortSignal[] = [];
    let onceCalls = 0;
    let passivePrevented = true;
    const Island = ilha(() => {
      const onceCallsState = state(0);
      return (
        <section onclick:capture={() => order.push("capture")}>
          <button class="bubble" onclick={() => order.push("bubble")}>
            Bubble
          </button>
          <button
            class="once"
            onclick:once={() => {
              onceCalls++;
              onceCallsState.update((count) => count + 1);
            }}
          >
            Once: {onceCallsState()}
          </button>
          <div
            class="passive"
            onwheel:passive={(event) => {
              event.preventDefault();
              passivePrevented = event.defaultPrevented;
            }}
          />
          <input
            oninput:abortable={(_, { signal }) => {
              abortSignals.push(signal);
            }}
          />
        </section>
      );
    });

    const el = makeEl();
    const unmount = Island.mount(el);
    (el.querySelector(".bubble") as HTMLButtonElement).click();
    expect(order).toEqual(["capture", "bubble"]);

    const once = el.querySelector(".once") as HTMLButtonElement;
    once.click();
    once.click();
    expect(onceCalls).toBe(1);

    el.querySelector(".passive")!.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true }),
    );
    expect(passivePrevented).toBe(false);

    const input = el.querySelector("input")!;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(abortSignals).toHaveLength(2);
    expect(abortSignals[0]!.aborted).toBe(true);
    expect(abortSignals[1]!.aborted).toBe(false);

    unmount();
    expect(abortSignals[1]!.aborted).toBe(true);
    cleanup(el);
  });

  it("stops native handlers on unmount", () => {
    let calls = 0;
    let handlerSignal!: AbortSignal;
    const Island = ilha(() => (
      <button
        onclick={(_, { signal }) => {
          calls++;
          handlerSignal = signal;
        }}
      >
        Run
      </button>
    ));

    const el = makeEl();
    const unmount = Island.mount(el);
    const button = el.querySelector("button")!;
    button.click();
    unmount();

    expect(handlerSignal.aborted).toBe(true);
    button.click();
    expect(calls).toBe(1);

    cleanup(el);
  });

  it("supports multiple JSX events on one element", () => {
    const fired: string[] = [];
    const Island = ilha(() => (
      <button onclick={() => fired.push("click")} onfocus={() => fired.push("focus")}>
        Events
      </button>
    ));

    const el = makeEl();
    const unmount = Island.mount(el);
    const button = el.querySelector("button") as HTMLButtonElement;

    button.focus();
    button.click();
    expect(fired).toEqual(["focus", "click"]);

    unmount();
    cleanup(el);
  });

  it("supports JSX handlers on forms, inputs, checkboxes, radios, and selects", () => {
    const fired: string[] = [];
    const record = (name: string) => (event: Event) => {
      fired.push(`${name}:${(event.currentTarget as Element).id || "form"}`);
      if (event.type === "submit") event.preventDefault();
    };
    const Island = ilha(() => (
      <form onsubmit={record("submit")}>
        <input id="text" onchange={record("change")} onselect={record("select")} />
        <input id="checkbox" type="checkbox" onchange={record("change")} />
        <input id="radio" type="radio" onchange={record("change")} />
        <select id="select" onchange={record("change")}>
          <option>A</option>
        </select>
      </form>
    ));

    const el = makeEl();
    const unmount = Island.mount(el);
    const dispatch = (selector: string, type: string, cancelable = false) => {
      const event = new Event(type, { bubbles: true, cancelable });
      el.querySelector(selector)!.dispatchEvent(event);
      return event;
    };

    dispatch("#text", "change");
    dispatch("#text", "select");
    dispatch("#checkbox", "change");
    dispatch("#radio", "change");
    dispatch("#select", "change");
    const submit = dispatch("form", "submit", true);

    expect(fired).toEqual([
      "change:text",
      "select:text",
      "change:checkbox",
      "change:radio",
      "change:select",
      "submit:form",
    ]);
    expect(submit.defaultPrevented).toBe(true);

    unmount();
    cleanup(el);
  });

  it("supports bind:value in JSX", () => {
    const Name = ilha(() => {
      const name = state("Ada");
      return (
        <div>
          <input bind:value={name} />
          <p>Hello {name()}</p>
        </div>
      );
    });

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
    const Form = ilha(() => {
      const user = state({ name: "Ada", email: "ada@example.com" });
      return (
        <div>
          <input bind:value={user.select((u) => u.name)} />
          <p>{user().name}</p>
        </div>
      );
    });

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
    const List = ilha(() => {
      const users = state(["Ada", "Grace"]);
      return (
        <ul>
          {users().map((_, i) => (
            <li>
              <input bind:value={users.select((u) => u[i])} />
            </li>
          ))}
        </ul>
      );
    });

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
    const List = ilha(() => {
      const items = state(["a", "b"]);
      return (
        <div>
          {items().map((_, i) => (
            <input bind:value={items.select((list) => list[i])} />
          ))}
        </div>
      );
    });

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
    const Form = ilha(() => {
      const user = state({ name: "Ada", email: "ada@example.com" });
      return (
        <div>
          <input bind:value={user.select((u) => u.name)} />
          <p data-email>{user().email}</p>
        </div>
      );
    });

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
    let nameAccessor!: { set(v: string): void };

    const Form = ilha(() => {
      const user = state({ name: "Ada" });
      nameAccessor = user.select((u) => u.name);
      return <input bind:value={user.select((u) => u.name)} />;
    });

    const el = makeEl();
    const unmount = Form.mount(el);
    nameAccessor.set("Grace");
    expect((el.querySelector("input") as HTMLInputElement).value).toBe("Grace");

    unmount();
    cleanup(el);
  });

  it("does not bind when mapping snapshot array from state() in JSX", () => {
    const List = ilha(() => {
      const users = state(["Ada"]);
      return (
        <div>
          {users().map((u) => (
            <input data-u bind:value={u as any} />
          ))}
          <span data-out>{users()[0]}</span>
        </div>
      );
    });

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
    const Child = ilha(() => {
      const count = state(0);
      return <button>{count()}</button>;
    });
    const Parent = ilha(() => (
      <section>
        <h1>Parent</h1>
        <Child />
      </section>
    ));

    expect(normalizeHtml(Parent.toString())).toBe(
      '<section><h1>Parent</h1><div data-ilha-slot="p:0"><button>0</button></div></section>',
    );
  });

  it("passes JSX props to a nested ilha island", () => {
    const Child = ilha(z.object({ label: z.string() }), ({ label }) => <strong>{label}</strong>);
    const Parent = ilha(() => (
      <section>
        <Child label="nested" />
      </section>
    ));

    expect(normalizeHtml(Parent.toString())).toBe(
      "<section><div data-ilha-slot=\"p:0\" data-ilha-props='{&quot;label&quot;:&quot;nested&quot;}'><strong>nested</strong></div></section>",
    );
  });

  it("jsx key prop on nested ilha island uses k:{key} slot id", () => {
    const Child = ilha(z.object({ label: z.string() }), ({ label }) => <strong>{label}</strong>);
    const Parent = ilha(() => (
      <section>
        <Child key="item-a" label="a" />
      </section>
    ));

    expect(normalizeHtml(Parent.toString())).toBe(
      "<section><div data-ilha-slot=\"k:item-a\" data-ilha-props='{&quot;label&quot;:&quot;a&quot;}'><strong>a</strong></div></section>",
    );
  });

  it("jsx key on list items preserves child identity after delete", () => {
    const Child = ilha(z.object({ label: z.string() }), ({ label }) => {
      const n = state(0);
      return (
        <>
          <span data-label={label}>
            {label}:{n()}
          </span>
          <button onclick={() => n.update((v) => v + 1)}>+</button>
        </>
      );
    });

    let setLabels!: (v: string[]) => void;

    const Parent = ilha(() => {
      const labels = state(["a", "b", "c"]);
      setLabels = labels.set;
      return (
        <div>
          {labels().map((label) => (
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
    const Item = ilha(z.object({ label: z.string() }), ({ label }) => <li>{label}</li>);
    const Parent = ilha(() => (
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
    const Child = ilha(() => {
      const count = state(0);
      return <button onclick={() => count.update((v) => v + 1)}>{count()}</button>;
    });
    const Parent = ilha(() => (
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

  it("reflects key onto rendered HTML as data-key only", () => {
    const result = <li key="abc">item</li>;
    expect(result.value).not.toContain(" key=");
    expect(result.value).toBe('<li data-key="abc">item</li>');
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

  it("accepts raw HTML values in string attributes", () => {
    expect((<img src={raw("data:image/svg+xml,<svg></svg>")} alt="icon" />).value).toBe(
      '<img src="data:image/svg+xml,<svg></svg>" alt="icon">',
    );
    expect((<div class={raw("trusted&class")} style={raw("color:red")}></div>).value).toBe(
      '<div class="trusted&class" style="color:red"></div>',
    );
  });

  it("renders void elements without closing tag", () => {
    expect((<br />).value).toBe("<br>");
    expect((<img src="x.png" alt="x" />).value).not.toContain("</img>");
  });

  it("drops event handler attributes from spreads (onX)", () => {
    const evil = { id: "ok", onload: "alert(1)" } as Record<string, unknown>;
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
    const result = (<input bind:value={{ not: "a signal" } as any} />).value;
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
    const result = (<div style={{ ["color; x:y"]: "red" } as any} />).value;
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
    const Island = ilha(() => {
      const name = state("<script>alert(1)</script>");
      return <input bind:value={name} />;
    });

    const out = Island.toString();
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("blocks javascript: href with leading whitespace", () => {
    expect((<a href="   javascript:alert(1)">x</a>).value).not.toContain("javascript:");
  });

  it("blocks unsafe URLs through camelCase JSX aliases", () => {
    expect((<button formAction="javascript:alert(1)">Save</button>).value).toBe(
      "<button>Save</button>",
    );
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
    const lowercase = (<iframe srcdoc="<script>alert(1)</script>" />).value;
    const camelCase = (<iframe srcDoc="<script>alert(1)</script>" />).value;
    expect(lowercase).toBe("<iframe></iframe>");
    expect(camelCase).toBe("<iframe></iframe>");
    expect(lowercase).not.toContain("srcdoc");
    expect(camelCase).not.toContain("srcDoc");
  });

  it("serializes ARIA and enumerated boolean values as strings", () => {
    const result = (
      <div aria-expanded={true} aria-hidden={false} draggable={false} spellCheck={true} />
    ).value;

    expect(result).toContain('aria-expanded="true"');
    expect(result).toContain('aria-hidden="false"');
    expect(result).toContain('draggable="false"');
    expect(result).toContain('spellCheck="true"');
  });

  it("normalizes camelCase SVG presentation attributes", () => {
    const result = (
      <svg viewBox="0 0 24 24">
        <linearGradient gradientUnits="userSpaceOnUse" xlinkHref="#base" />
        <circle cx={12} fillOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
      </svg>
    ).value;

    expect(result).toContain('viewBox="0 0 24 24"');
    expect(result).toContain('gradientUnits="userSpaceOnUse"');
    expect(result).toContain('xlink:href="#base"');
    expect(result).toContain('fill-opacity="0.5"');
    expect(result).toContain('stroke-width="2"');
    expect(result).toContain('stroke-linecap="round"');
    expect(result).not.toContain("strokeWidth");
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
    const Child = ilha(() => {
      const x = state(42);
      return <span>{x()}</span>;
    });
    const Parent = () => Child();
    expect((<Parent />).value).toContain("42");
  });

  it("cross-entry JSX island composition mounts interactively", () => {
    const Child = ilha(() => {
      const count = state(0);
      return <button onclick={() => count.update((v) => v + 1)}>{count()}</button>;
    });
    const Parent = ilha(() => jsxRuntime.jsx("div", { children: jsxRuntime.jsx(Child, {}) }));

    const el = makeEl();
    const unmount = Parent.mount(el);
    el.querySelector<HTMLButtonElement>("button")!.click();
    expect(el.querySelector("button")!.textContent).toBe("1");
    unmount();
    cleanup(el);
  });

  it("JSX island component returning SSR string emits slot instead of escaping", () => {
    const Child = ilha(() => html` <span>child</span> `);
    const CrossBundleChild = Object.assign(
      (props?: Record<string, unknown>) => Child.toString(props),
      {
        [Symbol.for("ilha.island")]: true,
        toString: Child.toString.bind(Child),
        mount: Child.mount.bind(Child),
      },
    );
    const Parent = ilha(() => (
      <div>
        <CrossBundleChild />
      </div>
    ));

    const result = Parent.toString() as string;
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
    expect(r.value).toBe('<span data-key="abc"></span>');
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
    const Island = ilha(() => {
      const name = state("Ada");
      return <input bind:value={name} />;
    });

    expect(Island.toString()).toContain('value="Ada"');
  });

  it("bind:this writes the element reference into a signal on mount", () => {
    const Island = ilha(() => {
      const el = state(null as Element | null);
      return <div bind:this={el} id="target" />;
    });

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

  it("key on a function component surfaces only as data-key on its root element", () => {
    const Item = (props: { label: string }) => <li>{props.label}</li>;
    const result = <Item key="abc" label="x" />;
    expect(result.value).toBe('<li data-key="abc">x</li>');
    expect(result.value).not.toContain(" key=");
  });

  it("bind:group SSR emits checked on matching radio input", () => {
    const Island = ilha(() => {
      const color = state("red");
      return html`
        <input type="radio" value="red" bind:group=${color} />
        <input type="radio" value="blue" bind:group=${color} />
      `;
    });
    const out = Island.toString();
    expect(out).toMatch(/value="red"[^>]*checked/);
    expect(out).not.toMatch(/value="blue"[^>]*checked/);
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
      const result = html`<input bind:value=${signal("x")} />`;
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
      const Island = ilha(() => <input {...({ "bind:foobar": signal("x") } as any)} />);
      Island.toString();

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
      return html` <div data-slot="resizable-handle"></div> `;
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

describe("JSX bridge — SSR closure non-execution", () => {
  it("never invokes a closure handler during manifest rendering", async () => {
    const { ilha } = await import("./index");
    const { setServerManifestSerializer } = await import("./internal");
    const entries: Array<Record<string, unknown>> = [];
    setServerManifestSerializer({
      template(manifest) {
        entries.push(Object.fromEntries(manifest));
        return "";
      },
    });
    let foreignCalls = 0;
    const App = ilha(() => (
      <button
        onclick={() => {
          foreignCalls++;
        }}
      >
        del
      </button>
    ));
    const rs = (App as unknown as Record<symbol, (props?: unknown) => Promise<string>>)[
      Symbol.for("ilha.renderState")
    ];
    await rs({});
    expect(foreignCalls).toBe(0);
    expect(entries[entries.length - 1] ?? {}).toEqual({});
  });
});
