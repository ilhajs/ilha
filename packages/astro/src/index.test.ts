import { describe, expect, it, mock } from "bun:test";

mock.module("virtual:@ilha/astro/options", () => ({
  default: (id: string) => id.includes("/ilha/"),
}));

import { atom, h } from "ilha";

import hydrate from "./client";
import ilhaIntegration, { getRenderer, getViteConfig } from "./index";
import renderer from "./server";

const Counter = ({ label }: { label: string }) => {
  const count = atom(0);
  return h("button", { onclick: () => count.update((v: number) => v + 1) }, label, ":", count);
};

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
  it("check() accepts functions and rejects non-functions", async () => {
    expect(await renderer.check(Counter, {}, {})).toBe(true);
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

  it("renderToStaticMarkup() returns hydratable markup", async () => {
    const { html: markup } = await renderer.renderToStaticMarkup(Counter, { label: "Clicks" }, {}, {
      displayName: "Counter",
    } as never);
    expect(markup).toContain("data-ilha");
    expect(markup).toContain("data-ilha-state=");
    expect(markup).toContain("Clicks");
    expect(markup).toContain(">0<");
  });

  it("renderToStaticMarkup() throws for non-functions", async () => {
    await expect(
      renderer.renderToStaticMarkup(null, {}, {}, { displayName: "Mystery" } as never),
    ).rejects.toThrow(/Mystery/);
  });
});

describe("@ilha/astro client hydration", () => {
  it("hydrates SSR markup and keeps events", async () => {
    const el = document.createElement("div");
    el.setAttribute("ssr", "");
    const { html: markup } = await renderer.renderToStaticMarkup(Counter, { label: "Clicks" }, {}, {
      displayName: "Counter",
    } as never);
    // test host only; markup is renderer output, not user input.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
    el.innerHTML = markup;
    document.body.appendChild(el);

    await hydrate(el)(Counter, { label: "Clicks" }, {}, { client: "load" });
    await Bun.sleep(10);

    const button = el.querySelector("button")!;
    button.click();
    await Bun.sleep(10);
    expect(button.textContent).toContain("Clicks:1");

    el.dispatchEvent(new Event("astro:unmount"));
    el.remove();
  });

  it("mounts client:only islands fresh in the browser", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    await hydrate(el)(Counter, { label: "Clicks" }, {}, { client: "only" });
    await Bun.sleep(10);

    const button = el.querySelector("button")!;
    expect(button.textContent).toContain("Clicks:0");
    button.click();
    await Bun.sleep(10);
    expect(button.textContent).toContain("Clicks:1");

    el.dispatchEvent(new Event("astro:unmount"));
    el.remove();
  });

  it('mounts fresh when Astro leaves ssr="" on a client:only island', async () => {
    // Regression: Astro emits ssr="" even for client:only, where the host has
    // no [data-ilha] child. Hydrating that empty host would render nothing.
    const el = document.createElement("div");
    el.setAttribute("ssr", "");
    document.body.appendChild(el);

    await hydrate(el)(Counter, { label: "Clicks" }, {}, { client: "only" });
    await Bun.sleep(10);

    const button = el.querySelector("button")!;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain("Clicks:0");
    button.click();
    await Bun.sleep(10);
    expect(button.textContent).toContain("Clicks:1");

    el.dispatchEvent(new Event("astro:unmount"));
    el.remove();
  });
});
