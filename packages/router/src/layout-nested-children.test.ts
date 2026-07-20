import { afterEach, describe, expect, it } from "bun:test";

import ilha, { html, ISLAND_MOUNT_HANDLES, mount as ilhaMount, raw } from "ilha";
import { jsx, jsxs } from "ilha/jsx-runtime";

import { defineLayout, wrapLayout } from "./index";

const RAW = Symbol.for("ilha.raw");

function makeEl(inner = ""): Element {
  const el = document.createElement("div");
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

function flushEffects() {
  return new Promise<void>((r) => queueMicrotask(() => queueMicrotask(r)));
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

function slotPropsFromSsr(ssr: string, slotId: string): Record<string, unknown> | null {
  const re = new RegExp(
    `data-ilha-slot="${slotId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"[^>]*data-ilha-props='([^']*)'`,
  );
  const m = ssr.match(re);
  if (!m) return null;
  const json = m[1]!
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return JSON.parse(json) as Record<string, unknown>;
}

describe("wrapLayout nested island children", () => {
  let el: Element | undefined;

  afterEach(() => {
    if (el) {
      el.remove();
      el = undefined;
    }
    document.body.innerHTML = "";
  });

  it("hydratable + mount paints compound children and keeps callbacks", async () => {
    const setPageCalls: number[] = [];

    const Pagination = ilha
      .input<{
        page: number;
        setPage?: (n: number) => void;
        children?: unknown;
      }>()
      .on("[data-next]@click", ({ input }) => {
        input.setPage?.(input.page + 1);
      })
      .render(({ input }) => {
        return html`<div data-slot="pagination" data-page=${String(input.page)}>
          ${paintChildren(input.children)}<button type="button" data-next>next</button>
        </div>`;
      });

    const Page = ilha.render(() => html`<p data-page-body>page</p>`);

    const Layout = defineLayout((Children) =>
      ilha.input<{ page: number }>().render(({ input }) =>
        jsxs("div", {
          class: "flex",
          children: [
            jsx("footer", {
              children: jsx(Pagination as never, {
                key: "grid-pagination",
                page: input.page,
                setPage: (p: number) => {
                  setPageCalls.push(p);
                },
                children: [
                  jsx("span", { "data-info": true, children: `info ${input.page}` }),
                  jsx("div", { class: "grow" }),
                ],
              }),
            }),
            jsx(Children as never, {}),
          ],
        }),
      ),
    );

    const Wrapped = wrapLayout(Layout, Page);
    const ssr = await Wrapped.hydratable({ page: 1 }, { name: "page", snapshot: true });

    expect(ssr).toContain('data-ilha-slot="k:grid-pagination"');
    expect(ssr).toContain('data-slot="pagination"');
    expect(ssr).toContain("data-info");
    expect(slotPropsFromSsr(ssr, "k:grid-pagination")).toEqual({ page: 1 });

    el = makeEl(`<div data-router-view>${ssr}</div>`);
    const { unmount } = ilhaMount({ page: Wrapped }, { root: el });
    await flushEffects();

    const slot = el.querySelector('[data-ilha-slot="k:grid-pagination"]');
    expect(slot).not.toBeNull();
    expect(slot!.innerHTML).not.toBe("");
    expect(el.querySelector("[data-info]")?.textContent).toContain("info");
    expect(el.querySelector("[data-slot='pagination']")).not.toBeNull();

    el.querySelector<HTMLButtonElement>("[data-next]")!.click();
    await flushEffects();
    expect(setPageCalls).toEqual([2]);

    unmount();
  });

  it("layout input update keeps nested children painted and callbacks live", async () => {
    const setPageCalls: number[] = [];

    const Pagination = ilha
      .input<{
        page: number;
        totalCount: number;
        setPage?: (n: number) => void;
        children?: unknown;
      }>()
      .on("[data-next]@click", ({ input }) => {
        input.setPage?.(input.page + 1);
      })
      .render(({ input }) => {
        return html`<div
          data-slot="pagination"
          data-page=${String(input.page)}
          data-total=${String(input.totalCount)}
        >
          ${paintChildren(input.children)}<button type="button" data-next>next</button>
        </div>`;
      });

    const Page = ilha.render(() => html`<p data-page-body>page</p>`);

    const Layout = defineLayout((Children) =>
      ilha.input<{ page: number; totalCount: number }>().render(({ input }) =>
        jsxs("div", {
          class: "flex",
          children: [
            jsx("footer", {
              children: jsx(Pagination as never, {
                key: "grid-pagination",
                page: input.page,
                totalCount: input.totalCount,
                setPage: (p: number) => {
                  setPageCalls.push(p);
                },
                children: [
                  jsx("span", {
                    "data-info": true,
                    children: `info ${input.page}/${input.totalCount}`,
                  }),
                ],
              }),
            }),
            jsx(Children as never, {}),
          ],
        }),
      ),
    );

    const Wrapped = wrapLayout(Layout, Page);
    const ssr = await Wrapped.hydratable(
      { page: 1, totalCount: 100 },
      { name: "page", snapshot: true },
    );

    el = makeEl(`<div data-router-view>${ssr}</div>`);
    const { unmount } = ilhaMount({ page: Wrapped }, { root: el });
    await flushEffects();

    expect(el.querySelector("[data-info]")?.textContent).toContain("info 1/100");

    const host = el.querySelector("[data-ilha]")!;
    const handle = ISLAND_MOUNT_HANDLES.get(host);
    expect(handle).toBeTruthy();
    handle!.updateProps({ page: 2, totalCount: 200 });
    await flushEffects();

    expect(el.querySelector("[data-ilha-slot='k:grid-pagination']")!.innerHTML).not.toBe("");
    expect(el.querySelector("[data-info]")?.textContent).toContain("info 2/200");
    expect(el.querySelector("[data-slot='pagination']")?.getAttribute("data-page")).toBe("2");

    el.querySelector<HTMLButtonElement>("[data-next]")!.click();
    await flushEffects();
    expect(setPageCalls).toEqual([3]);

    unmount();
  });
});

describe("stress: wrapLayout nesting + serialization", () => {
  let el: Element | undefined;

  afterEach(() => {
    if (el) {
      el.remove();
      el = undefined;
    }
    document.body.innerHTML = "";
  });

  it("nested wrapLayout (outer→inner→page) keeps layout-level compound islands", async () => {
    const clicks: string[] = [];

    const Tool = ilha
      .input<{ name: string; onGo?: () => void; children?: unknown }>()
      .on("[data-go]@click", ({ input }) => input.onGo?.())
      .render(
        ({ input }) =>
          html`<div data-tool=${input.name}>
            ${paintChildren(input.children)}
            <button type="button" data-go>${input.name}</button>
          </div>`,
      );

    const Page = ilha.render(() => html`<p data-page>page</p>`);

    const Inner = defineLayout((Children) =>
      ilha.render(() =>
        jsxs("div", {
          "data-inner-layout": true,
          children: [
            jsx(Tool as never, {
              key: "inner-tool",
              name: "inner",
              onGo: () => clicks.push("inner"),
              children: [jsx("span", { "data-inner-child": true, children: "inner-child" })],
            }),
            jsx(Children as never, {}),
          ],
        }),
      ),
    );

    const Outer = defineLayout((Children) =>
      ilha.render(() =>
        jsxs("div", {
          "data-outer-layout": true,
          children: [
            jsx(Tool as never, {
              key: "outer-tool",
              name: "outer",
              onGo: () => clicks.push("outer"),
              children: [jsx("span", { "data-outer-child": true, children: "outer-child" })],
            }),
            jsx(Children as never, {}),
          ],
        }),
      ),
    );

    const Wrapped = wrapLayout(Outer, wrapLayout(Inner, Page));
    const ssr = await Wrapped.hydratable({}, { name: "page", snapshot: true });

    expect(ssr).toContain('data-ilha-slot="k:outer-tool"');
    expect(ssr).toContain('data-ilha-slot="k:inner-tool"');
    expect(ssr).toContain("data-outer-child");
    expect(ssr).toContain("data-inner-child");
    expect(slotPropsFromSsr(ssr, "k:outer-tool")).toEqual({ name: "outer" });
    expect(slotPropsFromSsr(ssr, "k:inner-tool")).toEqual({ name: "inner" });

    el = makeEl(`<div data-router-view>${ssr}</div>`);
    const { unmount } = ilhaMount({ page: Wrapped }, { root: el });
    await flushEffects();

    expect(el.querySelector("[data-outer-child]")?.textContent).toBe("outer-child");
    expect(el.querySelector("[data-inner-child]")?.textContent).toBe("inner-child");
    expect(el.querySelector("[data-page]")?.textContent).toBe("page");

    el.querySelector<HTMLButtonElement>("[data-tool=outer] [data-go]")!.click();
    el.querySelector<HTMLButtonElement>("[data-tool=inner] [data-go]")!.click();
    expect(clicks).toEqual(["outer", "inner"]);

    unmount();
  });

  it("many layout child islands + page slot: all paint and callbacks survive updateProps", async () => {
    const hits: number[] = [];

    const Chip = ilha
      .input<{ id: number; onHit?: (id: number) => void; children?: unknown }>()
      .on("[data-hit]@click", ({ input }) => input.onHit?.(input.id))
      .render(
        ({ input }) =>
          html`<button type="button" data-hit data-chip=${String(input.id)}>
            ${paintChildren(input.children)}
          </button>`,
      );

    const Page = ilha
      .input<{ marker: string }>()
      .render(({ input }) => html`<p data-page-marker>${input.marker}</p>`);

    const Layout = defineLayout((Children) =>
      ilha.input<{ marker: string; tick: number }>().render(({ input }) => {
        const chips = Array.from({ length: 12 }, (_, id) =>
          jsx(Chip as never, {
            key: `chip-${id}`,
            id,
            onHit: (n: number) => hits.push(n),
            children: [
              jsx("span", {
                "data-chip-label": true,
                children: `c${id}@${input.tick}`,
              }),
            ],
          }),
        );
        return jsxs("div", {
          "data-layout": true,
          children: [jsx("nav", { "data-nav": true, children: chips }), jsx(Children as never, {})],
        });
      }),
    );

    const Wrapped = wrapLayout(Layout, Page);
    const ssr = await Wrapped.hydratable(
      { marker: "m1", tick: 1 },
      { name: "page", snapshot: true },
    );

    // No children blobs in any chip slot props
    expect(ssr.match(/"children"/g)).toBeNull();
    expect(ssr.match(/data-ilha-slot="k:chip-\d+"/g)?.length).toBe(12);

    el = makeEl(`<div data-router-view>${ssr}</div>`);
    const { unmount } = ilhaMount({ page: Wrapped }, { root: el });
    await flushEffects();

    expect(el.querySelectorAll("[data-chip]").length).toBe(12);
    expect(el.querySelector("[data-page-marker]")?.textContent).toBe("m1");
    expect(
      [...el.querySelectorAll("[data-chip-label]")].every((n) =>
        (n.textContent ?? "").endsWith("@1"),
      ),
    ).toBe(true);

    el.querySelector<HTMLButtonElement>("[data-chip='3']")!.click();
    el.querySelector<HTMLButtonElement>("[data-chip='11']")!.click();
    expect(hits).toEqual([3, 11]);

    const host = el.querySelector("[data-ilha]")!;
    ISLAND_MOUNT_HANDLES.get(host)!.updateProps({ marker: "m2", tick: 2 });
    await flushEffects();

    expect(el.querySelector("[data-page-marker]")?.textContent).toBe("m2");
    expect(el.querySelectorAll("[data-chip]").length).toBe(12);
    expect(
      [...el.querySelectorAll("[data-chip-label]")].every((n) =>
        (n.textContent ?? "").endsWith("@2"),
      ),
    ).toBe(true);
    // Still interactive after update
    el.querySelector<HTMLButtonElement>("[data-chip='0']")!.click();
    expect(hits).toEqual([3, 11, 0]);

    unmount();
  });

  it("rapid layout updateProps churn never empties nested compound slots", async () => {
    const Pagination = ilha
      .input<{
        page: number;
        total: number;
        setPage?: (n: number) => void;
        children?: unknown;
      }>()
      .on("[data-next]@click", ({ input }) => input.setPage?.(input.page + 1))
      .render(
        ({ input }) =>
          html`<div data-pag data-page=${String(input.page)} data-total=${String(input.total)}>
            ${paintChildren(input.children)}
            <button type="button" data-next>n</button>
          </div>`,
      );

    const calls: number[] = [];
    const Page = ilha.render(() => html`<p data-page>p</p>`);
    const Layout = defineLayout((Children) =>
      ilha.input<{ page: number; total: number }>().render(({ input }) =>
        jsxs("div", {
          children: [
            jsx(Pagination as never, {
              key: "pag",
              page: input.page,
              total: input.total,
              setPage: (n: number) => calls.push(n),
              children: [
                jsx("span", {
                  "data-info": true,
                  children: `${input.page}/${input.total}`,
                }),
                jsx("span", {
                  "data-fat": true,
                  children: "x".repeat(500),
                }),
              ],
            }),
            jsx(Children as never, {}),
          ],
        }),
      ),
    );

    const Wrapped = wrapLayout(Layout, Page);
    const ssr = await Wrapped.hydratable({ page: 1, total: 10 }, { name: "page", snapshot: true });
    el = makeEl(`<div data-router-view>${ssr}</div>`);
    const { unmount } = ilhaMount({ page: Wrapped }, { root: el });
    await flushEffects();

    const host = el.querySelector("[data-ilha]")!;
    const handle = ISLAND_MOUNT_HANDLES.get(host)!;

    for (let page = 2; page <= 30; page++) {
      handle.updateProps({ page, total: page * 10 });
      await flushEffects();
      const slot = el!.querySelector('[data-ilha-slot="k:pag"]');
      expect(slot?.innerHTML.length ?? 0).toBeGreaterThan(0);
      expect(el!.querySelector("[data-info]")?.textContent).toBe(`${page}/${page * 10}`);
      expect(el!.querySelector("[data-pag]")?.getAttribute("data-page")).toBe(String(page));
      expect(el!.querySelector("[data-fat]")?.textContent?.length).toBe(500);
    }

    el.querySelector<HTMLButtonElement>("[data-next]")!.click();
    expect(calls).toEqual([31]);

    unmount();
  });

  it("layout with both positional and keyed nested islands + page", async () => {
    const Pos = ilha
      .input<{ label: string; children?: unknown }>()
      .render(
        ({ input }) =>
          html`<aside data-pos>${input.label}:${paintChildren(input.children)}</aside>`,
      );
    const Keyed = ilha
      .input<{ label: string; children?: unknown }>()
      .render(
        ({ input }) =>
          html`<header data-keyed>${input.label}:${paintChildren(input.children)}</header>`,
      );

    const Page = ilha.render(() => html`<main data-main>main</main>`);
    const Layout = defineLayout((Children) =>
      ilha.render(() =>
        jsxs("div", {
          children: [
            jsx(Pos as never, {
              label: "p",
              children: [jsx("span", { "data-pos-child": true, children: "pc" })],
            }),
            jsx(Keyed as never, {
              key: "hdr",
              label: "k",
              children: [jsx("span", { "data-key-child": true, children: "kc" })],
            }),
            jsx(Children as never, {}),
          ],
        }),
      ),
    );

    const Wrapped = wrapLayout(Layout, Page);
    const ssr = await Wrapped.hydratable({}, { name: "page", snapshot: true });
    expect(ssr).toContain('data-ilha-slot="p:0"');
    expect(ssr).toContain('data-ilha-slot="k:hdr"');
    expect(ssr).toContain('data-ilha-slot="k:page"');
    expect(slotPropsFromSsr(ssr, "p:0")).toEqual({ label: "p" });
    expect(slotPropsFromSsr(ssr, "k:hdr")).toEqual({ label: "k" });

    el = makeEl(`<div data-router-view>${ssr}</div>`);
    const { unmount } = ilhaMount({ page: Wrapped }, { root: el });
    await flushEffects();

    expect(el.querySelector("[data-pos-child]")?.textContent).toBe("pc");
    expect(el.querySelector("[data-key-child]")?.textContent).toBe("kc");
    expect(el.querySelector("[data-main]")?.textContent).toBe("main");

    unmount();
  });
});
