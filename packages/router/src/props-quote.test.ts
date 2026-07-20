// Regression: data-ilha-props must survive props JSON containing a single
// quote (e.g. a SQL default of `'user'`) across the in-place layout update
// path (layoutUpdateProps → layout re-render → morph).

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

import ilha, { html } from "ilha";

import { router, navigate, loader, invalidate, wrapLayout } from "./index";

function makeEl(inner = ""): Element {
  const el = document.createElement("div");
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

function setLocation(path: string) {
  window.location.href = "http://localhost" + path;
}

const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

describe("data-ilha-props with single quotes in JSON", () => {
  let el: Element;
  let unmount: (() => void) | null = null;

  beforeEach(() => {
    setLocation("/");
    el = makeEl();
  });

  afterEach(() => {
    unmount?.();
    unmount = null;
    el.remove();
    setLocation("/");
  });

  it("survives layoutUpdateProps in-place update", async () => {
    const Page = ilha.render(({ input }: any) => `<p data-def>${input?.meta?.default ?? "-"}</p>`);
    const Wrapped = wrapLayout(
      (children: any) =>
        ilha.render(({ input }: any) => html`<section data-shell>${children(input)}</section>`),
      Page,
    );
    let n = 0;
    const load = mock(async () => ({ meta: { default: "'user'", n: ++n } }));
    unmount = router()
      .route(
        "/",
        ilha.render(() => `<p>home</p>`),
      )
      .route("/t", Wrapped, loader(load))
      .mount(el);

    navigate("/t");
    await flush();

    const hostBefore = el.querySelector("[data-ilha-slot='k:page']")!;
    expect(hostBefore).not.toBeNull();
    expect(JSON.parse(hostBefore.getAttribute("data-ilha-props")!)).toEqual({
      meta: { default: "'user'", n: 1 },
    });

    await invalidate();
    await flush();

    const host = el.querySelector("[data-ilha-slot='k:page']")!;
    const raw = host.getAttribute("data-ilha-props")!;
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual({ meta: { default: "'user'", n: 2 } });

    // No junk attributes parsed out of the JSON.
    const allowed = new Set(["data-ilha-slot", "data-ilha-props", "data-ilha-state"]);
    for (const { name } of host.attributes) {
      expect(allowed.has(name)).toBe(true);
    }
    // Page content updated.
    expect(el.querySelector("[data-def]")!.textContent).toBe("'user'");
  });
});

describe("data-ilha-props with single quotes — hydrate mode", () => {
  afterEach(() => setLocation("/"));

  it("SSR + hydrate + invalidate keeps props parseable", async () => {
    const Page = ilha.render(({ input }: any) => `<p data-def>${input?.meta?.default ?? "-"}</p>`);
    const Wrapped = wrapLayout(
      (children: any) =>
        ilha.render(({ input }: any) => html`<section data-shell>${children(input)}</section>`),
      Page,
    );
    let n = 0;
    const load = mock(async () => ({ meta: { default: "'user'", n: ++n } }));
    const reg = { page: Wrapped };
    const r = () => router().route("/t", Wrapped, loader(load));

    const ssrHtml = await r().renderHydratable("/t", reg);
    setLocation("/t");
    const el = makeEl(ssrHtml);
    const hydrated = ilha.mount(reg, { root: el });
    const unmount = r().mount(el, { hydrate: true, registry: reg });
    await flush();

    await invalidate();
    await flush();

    const host = el.querySelector("[data-ilha-slot='k:page']")!;
    const raw = host.getAttribute("data-ilha-props")!;
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw).meta.default).toBe("'user'");
    const allowed = new Set(["data-ilha-slot", "data-ilha-props", "data-ilha-state"]);
    for (const { name } of host.attributes) {
      expect(allowed.has(name)).toBe(true);
    }
    expect(el.querySelector("[data-def]")!.textContent).toBe("'user'");

    unmount();
    void hydrated.unmount();
    el.remove();
  });
});
