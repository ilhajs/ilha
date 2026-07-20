import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import ilha, { html, mount, raw, signal, type Island } from "./index";
import { jsx, jsxs } from "./jsx-runtime";

const RAW = Symbol.for("ilha.raw");

function makeEl(inner = ""): Element {
  const el = document.createElement("div");
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

function cleanup(el: Element): void {
  el.remove();
}

function flush(): Promise<void> {
  return new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
}

function parseSlotPropsAttr(html: string, slotId: string): Record<string, unknown> | null {
  const re = new RegExp(
    `data-ilha-slot="${slotId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*data-ilha-props='([^']*)'`,
  );
  const m = html.match(re);
  if (!m) return null;
  const json = m[1]!
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return JSON.parse(json) as Record<string, unknown>;
}

function paintChildren(kids: unknown): unknown {
  if (!Array.isArray(kids)) {
    if (kids && typeof kids === "object" && "value" in (kids as object)) {
      return raw(String((kids as { value: string }).value));
    }
    return kids ?? "";
  }
  return kids.map((k) => {
    if (k && typeof k === "object" && RAW in k) return raw((k as { value: string }).value);
    if (k && typeof k === "object" && "value" in (k as object)) {
      return raw(String((k as { value: string }).value));
    }
    return k;
  });
}

// ---------------------------------------------------------------------------
// Serialization contract
// ---------------------------------------------------------------------------

describe("stress: slot props serialization", () => {
  it("omits functions, symbols, and children from data-ilha-props", () => {
    const sym = Symbol("x");
    const Child = ilha
      .input<{
        page: number;
        label: string;
        setPage?: (n: number) => void;
        meta?: { nested: boolean };
        children?: unknown;
        [key: symbol]: unknown;
      }>()
      .render(
        ({ input }) =>
          html`<div data-child data-page=${String(input.page)}>
            ${paintChildren(input.children)}
          </div>`,
      );

    const Parent = ilha.render(
      () =>
        html`<section>
          ${Child({
            page: 7,
            label: "hi",
            setPage: () => {},
            meta: { nested: true },
            children: [
              { [RAW]: true, value: "<b data-bold>x</b>" },
              { [RAW]: true, value: "<i data-italic>y</i>" },
            ],
            [sym]: "nope",
          } as never)}
        </section>`,
    );

    const out = String(Parent());
    expect(out).toContain('data-ilha-slot="p:0"');
    expect(out).toContain("data-bold");
    expect(out).toContain("data-italic");

    const props = parseSlotPropsAttr(out, "p:0");
    expect(props).not.toBeNull();
    expect(props).toEqual({ page: 7, label: "hi", meta: { nested: true } });
    expect("children" in props!).toBe(false);
    expect("setPage" in props!).toBe(false);
  });

  it("omits children even when they are huge HTML strings", () => {
    const huge = `<div data-huge>${"Z".repeat(20_000)}</div>`;
    const Child = ilha
      .input<{ n: number; children?: unknown }>()
      .render(
        ({ input }) =>
          html`<div data-root data-n=${String(input.n)}>${paintChildren(input.children)}</div>`,
      );

    const Parent = ilha.render(
      () =>
        html`<div>
          ${Child.key("big")({
            n: 1,
            children: [{ [RAW]: true, value: huge }],
          })}
        </div>`,
    );

    const out = String(Parent());
    expect(out).toContain("data-huge");
    expect(out.length).toBeGreaterThan(20_000);

    const props = parseSlotPropsAttr(out, "k:big");
    expect(props).toEqual({ n: 1 });
    // Attr itself must stay small relative to children HTML
    const attr = out.match(/data-ilha-props='([^']*)'/)?.[1] ?? "";
    expect(attr.length).toBeLessThan(200);
  });

  it("revives legacy {value} children when mounting from attr only", () => {
    const Child = ilha
      .input<{ page: number; children?: unknown }>()
      .render(
        ({ input }) =>
          html`<div data-from-attr data-page=${String(input.page)}>
            ${paintChildren(input.children)}
          </div>`,
      );

    const el = makeEl();
    el.setAttribute(
      "data-ilha-props",
      JSON.stringify({
        page: 4,
        children: [{ value: "<span data-legacy>revived</span>" }],
      }),
    );
    const unmount = Child.mount(el);
    expect(el.querySelector("[data-legacy]")?.textContent).toBe("revived");
    expect(el.querySelector("[data-from-attr]")?.getAttribute("data-page")).toBe("4");
    unmount();
    cleanup(el);
  });

  it("revives tagged __ilha raw markers from attr props", () => {
    const Child = ilha
      .input<{ children?: unknown }>()
      .render(({ input }) => html`<div data-tag>${paintChildren(input.children)}</div>`);

    const el = makeEl();
    el.setAttribute(
      "data-ilha-props",
      JSON.stringify({
        children: [{ __ilha: "raw", value: "<em data-tagged>ok</em>" }],
      }),
    );
    const unmount = Child.mount(el);
    expect(el.querySelector("[data-tagged]")?.textContent).toBe("ok");
    unmount();
    cleanup(el);
  });

  it("special characters in scalar props survive attr round-trip", () => {
    const Child = ilha
      .input(z.object({ title: z.string(), note: z.string() }))
      .render(
        ({ input }) =>
          html`<p data-child>
            <span data-title>${input.title}</span><span data-note>${input.note}</span>
          </p>`,
      );

    const tricky = `O'Brien & "quotes" <not-a-tag> &amp; 中文`;
    const Parent = ilha.render(() => html`<div>${Child({ title: tricky, note: tricky })}</div>`);
    const ssr = String(Parent());
    const props = parseSlotPropsAttr(ssr, "p:0");
    expect(props?.title).toBe(tricky);
    expect(props?.note).toBe(tricky);

    const el = makeEl();
    const unmount = Parent.mount(el);
    // Text content is escaped on write and decoded by the DOM.
    expect(el.querySelector("[data-title]")?.textContent).toBe(tricky);
    expect(el.querySelector("[data-note]")?.textContent).toBe(tricky);
    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// Deep / wide nesting
// ---------------------------------------------------------------------------

describe("stress: deep and wide island nesting", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("5-level deep chain mounts, paints, and keeps leaf callbacks", async () => {
    const clicks: string[] = [];

    function makeLevel(name: string, next?: Island<any, any>): Island<any, any> {
      return ilha
        .input<{ label: string; onPing?: () => void; children?: unknown }>()
        .on(`[data-ping=${name}]@click`, ({ input }) => input.onPing?.())
        .render(({ input }) => {
          const body = next
            ? next({
                label: `${input.label}>${name}`,
                onPing: input.onPing,
                children: input.children,
              })
            : paintChildren(input.children);
          return html`<div data-level=${name}>
            <button type="button" data-ping=${name}>${name}</button>
            ${body}
          </div>`;
        });
    }

    const L5 = makeLevel("L5");
    const L4 = makeLevel("L4", L5);
    const L3 = makeLevel("L3", L4);
    const L2 = makeLevel("L2", L3);
    const L1 = makeLevel("L1", L2);

    const Root = ilha.render(
      () =>
        html`<main>
          ${L1({
            label: "root",
            onPing: () => clicks.push("ping"),
            children: [{ [RAW]: true, value: "<span data-leaf>leaf</span>" }],
          })}
        </main>`,
    );

    const el = makeEl();
    const unmount = Root.mount(el);
    await flush();

    expect(el.querySelectorAll("[data-level]").length).toBe(5);
    expect(el.querySelector("[data-leaf]")?.textContent).toBe("leaf");
    // Outer-most ping button
    el.querySelector<HTMLButtonElement>("[data-ping=L1]")!.click();
    expect(clicks).toEqual(["ping"]);

    unmount();
    cleanup(el);
  });

  it("wide fan-out: 40 keyed siblings with unique children and callbacks", async () => {
    const hits: number[] = [];

    const Item = ilha
      .input<{ id: number; onHit?: (id: number) => void; children?: unknown }>()
      .on("[data-hit]@click", ({ input }) => input.onHit?.(input.id))
      .render(
        ({ input }) =>
          html`<li data-item=${String(input.id)}>
            <button type="button" data-hit data-id=${String(input.id)}>go</button>
            ${paintChildren(input.children)}
          </li>`,
      );

    const List = ilha.render(() => {
      const items = Array.from({ length: 40 }, (_, id) =>
        Item.key(`i${id}`)({
          id,
          onHit: (n) => hits.push(n),
          children: [{ [RAW]: true, value: `<span data-label="${id}">item-${id}</span>` }],
        }),
      );
      return html`<ul>
        ${items}
      </ul>`;
    });

    const el = makeEl();
    const unmount = List.mount(el);
    await flush();

    expect(el.querySelectorAll("[data-item]").length).toBe(40);
    expect(el.querySelector('[data-label="39"]')?.textContent).toBe("item-39");

    // Spot-check several callbacks
    for (const id of [0, 7, 19, 39]) {
      el.querySelector<HTMLButtonElement>(`[data-hit][data-id="${id}"]`)!.click();
    }
    expect(hits).toEqual([0, 7, 19, 39]);

    // Attrs must not bloat with children
    const ssr = String(List());
    expect(ssr.match(/"children"/g)).toBeNull();

    unmount();
    cleanup(el);
  });

  it("mixed keyed + positional slots under one parent stay independent", async () => {
    const A = ilha
      .input<{ name: string; children?: unknown }>()
      .render(
        ({ input }) => html`<div data-a>${input.name}:${paintChildren(input.children)}</div>`,
      );
    const B = ilha
      .input<{ name: string }>()
      .render(({ input }) => html`<div data-b>${input.name}</div>`);

    const Parent = ilha.render(
      () =>
        html`<section>
          ${A.key("featured")({
            name: "A",
            children: [{ [RAW]: true, value: "<em data-child-a>ca</em>" }],
          })}
          ${B({ name: "B0" })} ${B({ name: "B1" })}
        </section>`,
    );

    const el = makeEl();
    const unmount = Parent.mount(el);
    await flush();

    expect(el.querySelector("[data-ilha-slot='k:featured']")).not.toBeNull();
    expect(el.querySelector("[data-ilha-slot='p:0']")).not.toBeNull();
    expect(el.querySelector("[data-ilha-slot='p:1']")).not.toBeNull();
    expect(el.querySelector("[data-child-a]")?.textContent).toBe("ca");
    expect(el.querySelector("[data-b]")?.textContent).toBe("B0");

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// Parent re-render / prop churn
// ---------------------------------------------------------------------------

describe("stress: parent re-render prop churn", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("rapid parent updates keep children painted and latest callback", async () => {
    const calls: number[] = [];

    const Child = ilha
      .input<{ page: number; setPage?: (n: number) => void; children?: unknown }>()
      .on("[data-go]@click", ({ input }) => input.setPage?.(input.page + 10))
      .render(
        ({ input }) =>
          html`<div data-child data-page=${String(input.page)}>
            ${paintChildren(input.children)}
            <button type="button" data-go>go</button>
          </div>`,
      );

    let setPage!: (n: number) => void;
    const Parent = ilha.state("page", 1).render(({ state }) => {
      setPage = state.page as unknown as typeof setPage;
      const page = state.page();
      return html`<div>
        ${Child.key("pag")({
          page,
          setPage: (n) => {
            calls.push(n);
            state.page(n);
          },
          children: [
            {
              [RAW]: true,
              value: `<span data-info>page-${page}</span>`,
            },
          ],
        })}
      </div>`;
    });

    const el = makeEl();
    const unmount = Parent.mount(el);
    await flush();

    for (let i = 2; i <= 25; i++) {
      setPage(i);
      await flush();
      expect(el.querySelector("[data-info]")?.textContent).toBe(`page-${i}`);
      expect(el.querySelector("[data-child]")?.getAttribute("data-page")).toBe(String(i));
      expect(el.querySelector("[data-ilha-slot='k:pag']")!.innerHTML.length).toBeGreaterThan(0);
    }

    el.querySelector<HTMLButtonElement>("[data-go]")!.click();
    await flush();
    expect(calls.at(-1)).toBe(35);
    expect(el.querySelector("[data-info]")?.textContent).toBe("page-35");

    unmount();
    cleanup(el);
  });

  it("onMount state write + first-effect path keeps nested compound children", async () => {
    const Child = ilha
      .input<{ n: number; children?: unknown }>()
      .render(
        ({ input }) =>
          html`<div data-root data-n=${String(input.n)}>${paintChildren(input.children)}</div>`,
      );

    const Parent = ilha
      .state("n", 1)
      .onMount(({ state }) => {
        state.n(2);
      })
      .render(({ state }) => {
        const n = state.n();
        return html`<footer>
          ${Child.key("x")({
            n,
            children: [
              { [RAW]: true, value: `<span data-info>n=${n}</span>` },
              { [RAW]: true, value: `<button type="button" data-btn>b</button>` },
            ],
          })}
        </footer>`;
      });

    const el = makeEl();
    const unmount = Parent.mount(el);
    await flush();

    expect(el.querySelector("[data-info]")?.textContent).toBe("n=2");
    expect(el.querySelector("[data-btn]")).not.toBeNull();
    expect(el.querySelector("[data-root]")?.getAttribute("data-n")).toBe("2");

    unmount();
    cleanup(el);
  });

  it("conditional swap of sibling islands does not leave empty slots", async () => {
    const Left = ilha
      .input<{ children?: unknown }>()
      .render(({ input }) => html`<div data-left>${paintChildren(input.children)}</div>`);
    const Right = ilha
      .input<{ children?: unknown }>()
      .render(({ input }) => html`<div data-right>${paintChildren(input.children)}</div>`);

    let setSide!: (s: string) => void;
    const Parent = ilha.state("side", "left").render(({ state }) => {
      setSide = state.side as unknown as typeof setSide;
      const side = state.side();
      const island = side === "left" ? Left : Right;
      return html`<div>
        ${island.key("slot")({
          children: [{ [RAW]: true, value: `<span data-body>${side}</span>` }],
        })}
      </div>`;
    });

    const el = makeEl();
    const unmount = Parent.mount(el);
    await flush();
    expect(el.querySelector("[data-left]")).not.toBeNull();
    expect(el.querySelector("[data-body]")?.textContent).toBe("left");

    setSide("right");
    await flush();
    expect(el.querySelector("[data-right]")).not.toBeNull();
    expect(el.querySelector("[data-left]")).toBeNull();
    expect(el.querySelector("[data-body]")?.textContent).toBe("right");
    expect(el.querySelector("[data-ilha-slot='k:slot']")!.innerHTML).not.toBe("");

    setSide("left");
    await flush();
    expect(el.querySelector("[data-left]")).not.toBeNull();
    expect(el.querySelector("[data-body]")?.textContent).toBe("left");

    unmount();
    cleanup(el);
  });

  it("external signal driven list shrink/grow preserves remaining child content", async () => {
    const count = signal(5);

    const Cell = ilha
      .input<{ id: number; children?: unknown }>()
      .render(
        ({ input }) =>
          html`<li data-cell=${String(input.id)}>${paintChildren(input.children)}</li>`,
      );

    const List = ilha.render(() => {
      const n = count();
      return html`<ul>
        ${Array.from({ length: n }, (_, id) =>
          Cell.key(`c${id}`)({
            id,
            children: [{ [RAW]: true, value: `<span data-c="${id}">c${id}</span>` }],
          }),
        )}
      </ul>`;
    });

    const el = makeEl();
    const unmount = List.mount(el);
    await flush();
    expect(el.querySelectorAll("[data-cell]").length).toBe(5);

    count(2);
    await flush();
    expect(el.querySelectorAll("[data-cell]").length).toBe(2);
    expect(el.querySelector('[data-c="0"]')?.textContent).toBe("c0");
    expect(el.querySelector('[data-c="1"]')?.textContent).toBe("c1");

    count(8);
    await flush();
    expect(el.querySelectorAll("[data-cell]").length).toBe(8);
    expect(el.querySelector('[data-c="7"]')?.textContent).toBe("c7");

    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// Hydration / SSR ↔ client
// ---------------------------------------------------------------------------

describe("stress: hydration with nested compound children", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("hydratable snapshot + mount wires nested island with children and callbacks", async () => {
    const calls: number[] = [];

    const Child = ilha
      .input<{ page: number; setPage?: (n: number) => void; children?: unknown }>()
      .on("[data-next]@click", ({ input }) => input.setPage?.(input.page + 1))
      .render(
        ({ input }) =>
          html`<div data-slot="pag" data-page=${String(input.page)}>
            ${paintChildren(input.children)}
            <button type="button" data-next>next</button>
          </div>`,
      );

    const Page = ilha.render(
      () =>
        html`<div>
          ${Child.key("grid")({
            page: 2,
            setPage: (n) => calls.push(n),
            children: [
              { [RAW]: true, value: "<span data-info>info</span>" },
              { [RAW]: true, value: "<span data-extra>extra</span>" },
            ],
          })}
        </div>`,
    );

    const ssr = await Page.hydratable({}, { name: "page", snapshot: true });
    expect(ssr).toContain('data-ilha-slot="k:grid"');
    expect(ssr).toContain("data-info");
    expect(parseSlotPropsAttr(ssr, "k:grid")).toEqual({ page: 2 });

    const root = makeEl(`<div data-router-view>${ssr}</div>`);
    const { unmount } = mount({ page: Page }, { root });
    await flush();

    expect(root.querySelector("[data-info]")?.textContent).toBe("info");
    expect(root.querySelector("[data-extra]")?.textContent).toBe("extra");
    root.querySelector<HTMLButtonElement>("[data-next]")!.click();
    expect(calls).toEqual([3]);

    unmount();
    cleanup(root);
  });

  it("JSX compound children under nested islands hydrate and stay interactive", async () => {
    const calls: string[] = [];

    const Inner = ilha
      .input<{ id: string; onAct?: () => void; children?: unknown }>()
      .on("[data-act]@click", ({ input }) => input.onAct?.())
      .render(({ input }) =>
        jsxs("div", {
          "data-inner": input.id,
          children: [
            paintChildren(input.children),
            jsx("button", { "data-act": true, type: "button", children: "act" }),
          ],
        }),
      );

    const Outer = ilha.render(() =>
      jsxs("section", {
        children: [
          jsx(Inner as never, {
            key: "one",
            id: "one",
            onAct: () => calls.push("one"),
            children: [jsx("span", { "data-label": true, children: "label-one" })],
          }),
          jsx(Inner as never, {
            key: "two",
            id: "two",
            onAct: () => calls.push("two"),
            children: [jsx("span", { "data-label": true, children: "label-two" })],
          }),
        ],
      }),
    );

    const ssr = await Outer.hydratable({}, { name: "outer", snapshot: true });
    const root = makeEl(ssr);
    const host = root.querySelector("[data-ilha]") ?? root;
    const unmount = Outer.mount(host as Element);
    await flush();

    const labels = [...root.querySelectorAll("[data-label]")].map((n) => n.textContent);
    expect(labels).toEqual(["label-one", "label-two"]);

    root.querySelector<HTMLButtonElement>("[data-inner=one] [data-act]")!.click();
    root.querySelector<HTMLButtonElement>("[data-inner=two] [data-act]")!.click();
    expect(calls).toEqual(["one", "two"]);

    unmount();
    cleanup(root);
  });
});
