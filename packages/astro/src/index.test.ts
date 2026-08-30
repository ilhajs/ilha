import { describe, expect, it, mock } from "bun:test";

// The integration registers extensionless entrypoints (@ilha/astro/client,
// @ilha/astro/server) — see package.json exports.
mock.module("virtual:@ilha/astro/options", () => ({
  default: (id: string) => id.includes("/ilha/"),
}));

import { effect, ilha, html, state } from "ilha";
import { __ilhaJsxSlot } from "ilha/internal";

import hydrate from "./client";
import ilhaIntegration, { getRenderer, getViteConfig } from "./index";
import renderer from "./server";

const Counter = ilha<{ label: string }>(({ label }) => {
  const count = state(0);
  return html`<button onclick=${() => count.update((v) => v + 1)}>${label}:${count()}</button>`;
});

// Stand-in for a non-island component library export (e.g. Areia's `Button`):
// a plain function that returns ilha `RawHtml` via the `html` tag, with no
// `.mount()`/`.hydratable()` lifecycle.
const Button = ({ label }: { label: string }) => html`<button class="btn">${label}</button>`;

describe("@ilha/astro integration", () => {
  it("registers the ilha renderer via astro:config:setup", () => {
    let registered: unknown;
    let viteConfig: unknown;
    const integration = ilhaIntegration();
    expect(integration.name).toBe("@ilha/astro");
    integration.hooks["astro:config:setup"]?.({
      addRenderer: (r: unknown) => {
        registered = r;
      },
      updateConfig: (config: { vite?: unknown }) => {
        viteConfig = config.vite;
      },
    } as never);
    expect(registered).toEqual(getRenderer());
    expect(viteConfig).toMatchObject({
      resolve: { dedupe: ["ilha"] },
      optimizeDeps: { exclude: ["ilha"] },
    });
  });

  it("passes include/exclude patterns to the renderer filter", () => {
    const plugin = getViteConfig({ include: ["**/ilha/**"], exclude: ["**/*.test.tsx"] })
      .plugins[0];
    const id = plugin.resolveId("virtual:@ilha/astro/options");
    expect(id).toBe("\0virtual:@ilha/astro/options");
    const module = plugin.load(id!);
    const filter = new Function(module!.replace("export default", "return"))() as (
      id: string,
    ) => boolean;
    expect(filter("/src/ilha/counter.tsx")).toBe(true);
    expect(filter("/src/ilha/counter.test.tsx")).toBe(false);
    expect(filter("/src/solid/counter.tsx")).toBe(false);
  });

  it("points the renderer at the client/server entrypoints", () => {
    const r = getRenderer();
    expect(r.clientEntrypoint).toBe("@ilha/astro/client");
    expect(r.serverEntrypoint).toBe("@ilha/astro/server");
  });
});

describe("@ilha/astro server renderer", () => {
  it("check() recognizes ilha islands and rejects everything else", async () => {
    expect(await renderer.check(Counter, {}, {})).toBe(true);
    expect(await renderer.check(() => {}, {}, {})).toBe(false);
    expect(await renderer.check({}, {}, {})).toBe(false);
    expect(await renderer.check(null, {}, {})).toBe(false);
  });

  it("check() ignores components outside the configured paths", async () => {
    expect(
      await renderer.check(Counter, {}, {}, { componentUrl: "/src/solid/counter.tsx" } as never),
    ).toBe(false);
    expect(
      await renderer.check(Counter, {}, {}, { componentUrl: "/src/ilha/counter.tsx" } as never),
    ).toBe(true);
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

  it("renderToStaticMarkup() keeps island markup hydratable when nested in a plain function", async () => {
    // Astro slot children: Counter was SSR'd as its own hydratable island, then
    // interpolated into Panel. Panel stays unwrapped (no nested data-ilha-slot).
    const Panel = ({ children }: { children?: unknown }) =>
      html`<section class="panel">${children}</section>`;
    const { html: islandMarkup } = await renderer.renderToStaticMarkup(
      Counter,
      { label: "Clicks" },
      {},
      { displayName: "Counter" } as never,
    );
    const { html: markup } = await renderer.renderToStaticMarkup(
      Panel,
      {},
      { default: islandMarkup },
      { displayName: "Panel" } as never,
    );
    expect(markup).toContain('class="panel"');
    expect(markup).toContain('data-ilha="Counter"');
    expect(markup).toContain("data-ilha-state=");
    expect(markup).toContain("Clicks:0");
    expect(markup).not.toContain('data-ilha="Panel"');
  });

  it("renderToStaticMarkup() wraps plain components that JSX-nest islands", async () => {
    // Mirrors Areia docs: plain KitchenSinkGrid returning <Dialog /> via JSX.
    // `__ilhaJsxSlot` is what the JSX runtime emits for nested islands.
    const Panel = () =>
      html`<section class="panel">
        ${__ilhaJsxSlot({
          island: Counter,
          props: { label: "Clicks" },
          key: undefined,
        })}
      </section>`;
    const { html: markup } = await renderer.renderToStaticMarkup(Panel, {}, {}, {
      displayName: "Panel",
    } as never);
    expect(markup).toContain('data-ilha="Panel"');
    expect(markup).toContain("data-ilha-slot=");
    expect(markup).toContain("Clicks:0");
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
    // test host only; markup is renderer output, not user input.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
    el.innerHTML = markup;
    document.body.appendChild(el);

    await hydrate(el)(Counter, {}, {}, { client: "load" });

    const button = el.querySelector("button")!;
    button.click();
    expect(button.textContent).toBe("Clicks:1");

    el.dispatchEvent(new Event("astro:unmount"));
    el.remove();
  });

  it("hydrates an island nested inside a plain function component's markup", async () => {
    // Separate Astro islands: hydrate Counter itself (Panel is just surrounding HTML).
    const Panel = ({ children }: { children?: unknown }) =>
      html`<section class="panel">${children}</section>`;
    const { html: islandMarkup } = await renderer.renderToStaticMarkup(
      Counter,
      { label: "Clicks" },
      {},
      { displayName: "Counter" } as never,
    );
    const { html: markup } = await renderer.renderToStaticMarkup(
      Panel,
      {},
      { default: islandMarkup },
      { displayName: "Panel" } as never,
    );

    const el = document.createElement("div");
    el.setAttribute("ssr", "");
    // test host only; markup is renderer output, not user input.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
    el.innerHTML = markup;
    document.body.appendChild(el);

    await hydrate(el)(Counter, {}, {}, { client: "load" });

    expect(el.querySelector(".panel")).not.toBeNull();
    const button = el.querySelector("button")!;
    expect(button.textContent).toBe("Clicks:0");
    button.click();
    expect(button.textContent).toBe("Clicks:1");

    el.dispatchEvent(new Event("astro:unmount"));
    el.remove();
  });

  it("hydrates islands JSX-nested inside a plain function when the plain component is the Astro island", async () => {
    const Panel = () =>
      html`<section class="panel">
        ${__ilhaJsxSlot({
          island: Counter,
          props: { label: "Clicks" },
          key: undefined,
        })}
      </section>`;
    const { html: markup } = await renderer.renderToStaticMarkup(Panel, {}, {}, {
      displayName: "Panel",
    } as never);

    const el = document.createElement("div");
    el.setAttribute("ssr", "");
    // test host only; markup is renderer output, not user input.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
    el.innerHTML = markup;
    document.body.appendChild(el);

    // Astro hydrates Panel (plain), not Counter — nested island must still mount.
    await hydrate(el)(Panel, {}, {}, { client: "load" });

    const button = el.querySelector("button")!;
    expect(button.textContent).toBe("Clicks:0");
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
    // test host only; markup is renderer output, not user input.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
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
    // test host only; markup is renderer output, not user input.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
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

describe("effect.once runs after hydration", () => {
  // Regression: renderToStaticMarkup used to pass `skipOnMount: true`, which
  // makes ilha skip every effect.once slot on the client — dropping submit
  // listeners, controllers, and drag wiring for any island hydrated with a
  // state snapshot. Setup is client-only under the function API, so it must
  // always run at hydration.
  it("attaches once-setup when hydrating an island with a state snapshot", async () => {
    const { html: htmlTag } = await import("ilha");
    let setupRuns = 0;
    let clicked = 0;

    const Widget = ilha(() => {
      const n = state(0);
      effect.once(({ host }) => {
        setupRuns++;
        host.addEventListener("click", () => clicked++);
      });
      return htmlTag`<div data-widget>n:${n()}</div>`;
    });

    const { html } = await renderer.renderToStaticMarkup(Widget, {}, {}, {
      displayName: "Widget",
    } as never);
    expect(html).toContain("data-widget");

    document.body.innerHTML = html;
    const host = document.querySelector("[data-ilha='Widget']") as Element;
    await hydrate(host as never)(Widget as never, {}, {}, {} as never);
    await new Promise((r) => setTimeout(r, 20));

    expect(setupRuns).toBe(1);
    host.querySelector("[data-widget]")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(clicked).toBe(1);
  });
});
