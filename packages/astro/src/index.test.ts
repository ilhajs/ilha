import { describe, expect, it } from "bun:test";

import ilha, { html } from "ilha";

import hydrate from "./client";
import ilhaIntegration, { getRenderer } from "./index";
import renderer from "./server";

const Counter = ilha
  .input<{ label: string }>()
  .state("count", 0)
  .on("button@click", ({ state }) => state.count(state.count() + 1))
  .render(({ input, state }) => html`<button>${input.label}:${state.count()}</button>`);

// Stand-in for a non-island component library export (e.g. Areia's `Button`):
// a plain function that returns ilha `RawHtml` via the `html` tag, with no
// `.mount()`/`.hydratable()` lifecycle.
const Button = ({ label }: { label: string }) => html`<button class="btn">${label}</button>`;

describe("@ilha/astro integration", () => {
  it("registers the ilha renderer via astro:config:setup", () => {
    let registered: unknown;
    const integration = ilhaIntegration();
    expect(integration.name).toBe("@ilha/astro");
    integration.hooks["astro:config:setup"]?.({
      addRenderer: (r: unknown) => {
        registered = r;
      },
    } as never);
    expect(registered).toEqual(getRenderer());
  });

  it("points the renderer at the client/server entrypoints", () => {
    const r = getRenderer();
    expect(r.clientEntrypoint).toBe("@ilha/astro/client.js");
    expect(r.serverEntrypoint).toBe("@ilha/astro/server.js");
  });
});

describe("@ilha/astro server renderer", () => {
  it("check() recognizes ilha islands and rejects everything else", async () => {
    expect(await renderer.check(Counter, {}, {})).toBe(true);
    expect(await renderer.check(() => {}, {}, {})).toBe(false);
    expect(await renderer.check({}, {}, {})).toBe(false);
    expect(await renderer.check(null, {}, {})).toBe(false);
  });

  it("renderToStaticMarkup() returns the SSR-wrapped island markup", async () => {
    const { html: markup } = await renderer.renderToStaticMarkup(Counter, { label: "Clicks" }, {}, {
      displayName: "Counter",
    } as never);
    expect(markup).toContain('data-ilha="Counter"');
    expect(markup).toContain("data-ilha-state=");
    expect(markup).toContain("Clicks:0");
  });

  it("check() recognizes plain function components (e.g. areia's Button) and renders them", async () => {
    expect(await renderer.check(Button, { label: "Save" }, {})).toBe(true);
  });

  it("renderToStaticMarkup() renders plain function components without a data-ilha wrapper", async () => {
    const { html: markup } = await renderer.renderToStaticMarkup(Button, { label: "Save" }, {}, {
      displayName: "Button",
    } as never);
    expect(markup).toBe('<button class="btn">Save</button>');
    expect(markup).not.toContain("data-ilha");
  });

  it("renderToStaticMarkup() passes slotted children through to plain function components", async () => {
    const WithChildren = ({ children }: { children?: unknown }) =>
      html`<div class="card">${children}</div>`;
    const { html: markup } = await renderer.renderToStaticMarkup(
      WithChildren,
      {},
      { default: "<p>hi</p>" },
      { displayName: "Card" } as never,
    );
    expect(markup).toBe('<div class="card"><p>hi</p></div>');
  });

  it("renderToStaticMarkup() throws a helpful error for components it cannot render", async () => {
    await expect(
      renderer.renderToStaticMarkup(() => undefined, {}, {}, { displayName: "Mystery" } as never),
    ).rejects.toThrow(/Mystery/);
  });
});

describe("@ilha/astro client hydration", () => {
  it("mounts the island found inside the astro-island element", async () => {
    const el = document.createElement("div");
    el.setAttribute("ssr", "");
    const { html: markup } = await renderer.renderToStaticMarkup(Counter, { label: "Clicks" }, {}, {
      displayName: "Counter",
    } as never);
    el.innerHTML = markup;
    document.body.appendChild(el);

    await hydrate(el)(Counter, {}, {}, { client: "load" });

    const button = el.querySelector("button")!;
    button.click();
    expect(button.textContent).toBe("Clicks:1");

    el.dispatchEvent(new Event("astro:unmount"));
    el.remove();
  });

  it("mounts client:only islands fresh in the browser", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    await hydrate(el)(Counter, { label: "Clicks" }, {}, { client: "only" });

    const button = el.querySelector("button")!;
    expect(button.textContent).toBe("Clicks:0");
    button.click();
    expect(button.textContent).toBe("Clicks:1");

    el.dispatchEvent(new Event("astro:unmount"));
    el.remove();
  });

  it("re-invokes static components without mutating SSR markup", async () => {
    const el = document.createElement("div");
    el.setAttribute("ssr", "");
    const { html: markup } = await renderer.renderToStaticMarkup(Button, { label: "Save" }, {}, {
      displayName: "Button",
    } as never);
    el.innerHTML = markup;
    document.body.appendChild(el);

    await expect(
      hydrate(el)(Button, { label: "Save" }, {}, { client: "load" }),
    ).resolves.toBeUndefined();
    expect(el.innerHTML).toBe(markup);

    el.remove();
  });

  it("re-invokes plain components so client auto-bind side effects run", async () => {
    // Mirrors Areia's ContextMenu / Tooltip pattern: SSR emits a marker
    // attribute, and calling the component on the client schedules a
    // microtask that binds controllers to those hosts.
    let calls = 0;
    const Widget = (input: Record<string, unknown> = {}) => {
      calls++;
      queueMicrotask(() => {
        for (const root of document.querySelectorAll("[data-areia-widget]")) {
          root.setAttribute("data-bound", "1");
        }
      });
      return html`<div data-areia-widget>${String(input.label ?? "")}</div>`;
    };

    const el = document.createElement("div");
    el.setAttribute("ssr", "");
    const { html: markup } = await renderer.renderToStaticMarkup(Widget, { label: "Hi" }, {}, {
      displayName: "Widget",
    } as never);
    el.innerHTML = markup;
    document.body.appendChild(el);

    const before = calls;
    await hydrate(el)(Widget, { label: "Hi" }, {}, { client: "load" });
    expect(calls).toBe(before + 1);

    await Promise.resolve();
    expect(el.querySelector("[data-areia-widget]")?.getAttribute("data-bound")).toBe("1");
    expect(el.innerHTML).toContain("data-areia-widget");

    el.remove();
  });
});
