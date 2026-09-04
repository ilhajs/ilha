import { describe, expect, it, mock } from "bun:test";
import { Script } from "node:vm";

import { atom, h } from "ilha";

import type { IslandProps } from "./client";

// The virtual module must be mocked before the integration imports it.
mock.module("virtual:@ilha/astro/options", () => ({
  default: (id: string) => id.includes("/ilha/"),
}));

const { default: hydrate } = await import("./client");
const {
  default: ilhaIntegration,
  getRenderer,
  getViteConfig,
} = await import("./index");
const { default: renderer } = await import("./server");

// SAFETY: Astro's renderer API types its extra metadata loosely; the tests
// pass only the fields the renderer reads.
const withMeta = (meta: Record<string, string>) => meta as never;

const Counter = (props: IslandProps) => {
  const count = atom(0);
  return h(
    "button",
    {
      onclick: () => count.update((v: number) => v + 1),
      type: "button",
    },
    String(props.label),
    ":",
    count
  );
};

describe("@ilha/astro integration", () => {
  it("registers the ilha renderer via astro:config:setup", () => {
    let registered: ReturnType<typeof getRenderer> | undefined;
    let viteConfig: unknown;
    const integration = ilhaIntegration();
    expect(integration.name).toBe("@ilha/astro");
    // SAFETY: Astro's hook context is loosely typed; only the two hooks under
    // test are invoked, and the test owns every field they read.
    integration.hooks["astro:config:setup"]?.({
      addRenderer: (r: ReturnType<typeof getRenderer>) => {
        registered = r;
      },
      updateConfig: (config: { vite?: unknown }) => {
        viteConfig = config.vite;
      },
    } as never);
    expect(registered).toEqual(getRenderer());
    expect(viteConfig).toMatchObject({
      optimizeDeps: { exclude: ["ilha"] },
      resolve: { dedupe: ["ilha"] },
    });
  });

  it("passes include/exclude patterns to the renderer filter", () => {
    const [plugin] = getViteConfig({
      exclude: ["**/*.test.tsx"],
      include: ["**/ilha/**"],
    }).plugins;
    const id = plugin?.resolveId("virtual:@ilha/astro/options");
    if (id === undefined) {
      throw new Error("options module not resolvable");
    }
    const module = plugin.load(id);
    if (module === undefined) {
      throw new Error("options module not loadable");
    }
    const filterSource = module.replace("export default", "return");
    // SAFETY: the generated module's only export is the component filter
    // function; unwrapping `export default` and evaluating it as an IIFE
    // yields exactly that function body.
    const filter = new Script(
      `(function(){${filterSource}})()`
    ).runInNewContext() as (id: string) => boolean;
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
      await renderer.check(
        Counter,
        {},
        {},
        withMeta({ componentUrl: "/src/solid/counter.tsx" })
      )
    ).toBe(false);
    expect(
      await renderer.check(
        Counter,
        {},
        {},
        withMeta({ componentUrl: "/src/ilha/counter.tsx" })
      )
    ).toBe(true);
  });

  it("renderToStaticMarkup() returns hydratable markup", async () => {
    const { html: markup } = await renderer.renderToStaticMarkup(
      Counter,
      { label: "Clicks" },
      {},
      withMeta({ displayName: "Counter" })
    );
    expect(markup).toContain("data-ilha");
    expect(markup).toContain("data-ilha-state=");
    expect(markup).toContain("Clicks");
    expect(markup).toContain(">0<");
  });

  it("renderToStaticMarkup() throws for non-functions", async () => {
    await expect(
      renderer.renderToStaticMarkup(
        null,
        {},
        {},
        withMeta({ displayName: "Mystery" })
      )
    ).rejects.toThrow(/Mystery/u);
  });
});

describe("@ilha/astro client hydration", () => {
  it("hydrates SSR markup and keeps events", async () => {
    const el = document.createElement("div");
    el.setAttribute("ssr", "");
    const { html: markup } = await renderer.renderToStaticMarkup(
      Counter,
      { label: "Clicks" },
      {},
      withMeta({ displayName: "Counter" })
    );
    // SAFETY: markup is renderer output under test, not untrusted input.
    const parsed = new DOMParser().parseFromString(markup, "text/html");
    el.append(...parsed.body.childNodes);
    document.body.append(el);

    await hydrate(el)(Counter, { label: "Clicks" }, {}, { client: "load" });
    await Bun.sleep(10);

    const button = el.querySelector("button");
    if (!button) {
      throw new Error("hydrated button missing");
    }
    button.click();
    await Bun.sleep(10);
    expect(button.textContent).toContain("Clicks:1");

    el.dispatchEvent(new Event("astro:unmount"));
    el.remove();
  });

  it("mounts client:only islands fresh in the browser", async () => {
    const el = document.createElement("div");
    document.body.append(el);

    await hydrate(el)(Counter, { label: "Clicks" }, {}, { client: "only" });
    await Bun.sleep(10);

    const button = el.querySelector("button");
    if (!button) {
      throw new Error("mounted button missing");
    }
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
    document.body.append(el);

    await hydrate(el)(Counter, { label: "Clicks" }, {}, { client: "only" });
    await Bun.sleep(10);

    const button = el.querySelector("button");
    if (!button) {
      throw new Error("client:only button missing");
    }
    expect(button.textContent).toContain("Clicks:0");
    button.click();
    await Bun.sleep(10);
    expect(button.textContent).toContain("Clicks:1");

    el.dispatchEvent(new Event("astro:unmount"));
    el.remove();
  });
});
