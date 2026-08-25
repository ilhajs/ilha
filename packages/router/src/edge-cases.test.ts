/**
 * Exotic edge cases grouped in one file: attribute escaping, redirect
 * hardening, in-place updates, and layout nesting stress.
 */
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ilha, html, mount as ilhaMount, raw, effect } from "ilha";
import { ISLAND_MOUNT_HANDLES } from "ilha/internal";
import { jsx, jsxs } from "ilha/jsx-runtime";

import { generate } from "./codegen";
import {
  defineLayout,
  invalidate,
  isActive,
  LoaderError,
  loader,
  navigate,
  Redirect,
  redirect,
  router,
  serializeHead,
  wrapLayout,
  beforeNavigate,
  afterNavigate,
} from "./index";
import { CLIENT_QUERY, createPagesPluginState, resolvePagesId } from "./plugin";
// ─────────── from props-quote.test.ts ───────────
{
  // Regression: data-ilha-props must survive props JSON containing a single
  // quote (e.g. a SQL default of `'user'`) across the in-place layout update
  // path (layoutUpdateProps → layout re-render → morph).

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
      const Page = ilha(
        (input: any) => `<p data-def>${input?.load?.value?.meta?.default ?? "-"}</p>`,
      );
      const Wrapped = wrapLayout(
        (children: any) =>
          ilha((input: any) => html`<section data-shell>${children(input)}</section>`),
        Page,
      );
      let n = 0;
      const load = mock(async () => ({ meta: { default: "'user'", n: ++n } }));
      unmount = router()
        .route(
          "/",
          ilha(() => `<p>home</p>`),
        )
        .route("/t", Wrapped, loader(load))
        .mount(el);

      navigate("/t");
      await flush();

      const hostBefore = el.querySelector("[data-ilha-slot='k:page']")!;
      expect(hostBefore).not.toBeNull();
      expect(JSON.parse(hostBefore.getAttribute("data-ilha-props")!)).toEqual({
        load: { loading: false, value: { meta: { default: "'user'", n: 1 } }, error: undefined },
      });

      await invalidate();
      await flush();

      const host = el.querySelector("[data-ilha-slot='k:page']")!;
      const raw = host.getAttribute("data-ilha-props")!;
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(JSON.parse(raw)).toEqual({
        load: { loading: false, value: { meta: { default: "'user'", n: 2 } } },
      });

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
      const Page = ilha(
        (input: any) => `<p data-def>${input?.load?.value?.meta?.default ?? "-"}</p>`,
      );
      const Wrapped = wrapLayout(
        (children: any) =>
          ilha((input: any) => html`<section data-shell>${children(input)}</section>`),
        Page,
      );
      let n = 0;
      const load = mock(async () => ({ meta: { default: "'user'", n: ++n } }));
      const reg = { page: Wrapped };
      const r = () => router().route("/t", Wrapped, loader(load));

      const ssrHtml = await r().renderHydratable("/t", reg);
      setLocation("/t");
      const el = makeEl(ssrHtml);
      const hydrated = ilhaMount(reg, { root: el });
      const unmount = r().mount(el, { hydrate: true, registry: reg });
      await flush();

      await invalidate();
      await flush();

      const host = el.querySelector("[data-ilha-slot='k:page']")!;
      const raw = host.getAttribute("data-ilha-props")!;
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(JSON.parse(raw).load.value.meta.default).toBe("'user'");
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
}

// ─────────── from improvements.test.ts ───────────
{
  const Page = ilha(() => `<p>page</p>`);
  const NotFoundPage = ilha(() => `<h1>lost</h1>`);

  function setLocation(path: string) {
    window.location.href = "http://localhost" + path;
  }

  // ─────────────────────────────────────────────
  // Redirect safety
  // ─────────────────────────────────────────────

  describe("redirect target validation", () => {
    it("escapes the meta-refresh redirect URL in renderHydratable", async () => {
      const load = loader(async () => {
        redirect(`/x"><script>alert(1)</script>`);
      });
      const r = router().route("/", Page, load);
      const html = await r.renderHydratable("http://localhost/", { index: Page });
      expect(html).not.toContain("<script>alert");
      expect(html).toContain("&quot;&gt;&lt;script&gt;");
    });

    it("blocks cross-origin redirects by default (renderResponse)", async () => {
      const load = loader(async () => {
        redirect("https://evil.example/phish");
      });
      const r = router().route("/", Page, load);
      const res = await r.renderResponse("http://localhost/", { index: Page });
      expect(res.kind).toBe("error");
      if (res.kind === "error") expect(res.status).toBe(500);
    });

    it("blocks protocol-relative redirect targets", async () => {
      const load = loader(async () => {
        redirect("//evil.example/phish");
      });
      const r = router().route("/", Page, load);
      const res = await r.runLoader("http://localhost/");
      expect(res.kind).toBe("error");
    });

    it("allows cross-origin redirects when opted in", async () => {
      const load = loader(async () => {
        redirect("https://other.example/next");
      });
      const r = router({ allowExternalRedirects: true }).route("/", Page, load);
      const res = await r.renderResponse("http://localhost/", { index: Page });
      expect(res).toEqual({
        kind: "redirect",
        to: "https://other.example/next",
        status: 302,
      });
    });

    it("collapses same-origin absolute redirect targets to a path", async () => {
      const load = loader(async () => {
        redirect("http://localhost/dest?a=1");
      });
      const r = router().route("/", Page, load);
      const res = await r.runLoader("http://localhost/");
      expect(res).toEqual({ kind: "redirect", to: "/dest?a=1", status: 302 });
    });

    it("keeps relative-path redirects untouched", async () => {
      const load = loader(async () => {
        redirect("/login", 307);
      });
      const r = router().route("/", Page, load);
      const res = await r.runLoader("http://localhost/");
      expect(res).toEqual({ kind: "redirect", to: "/login", status: 307 });
    });
  });

  describe("sentinel status validation", () => {
    it("clamps Redirect to a real 3xx status", () => {
      expect(new Redirect("/x", 302).status).toBe(302);
      expect(new Redirect("/x", 301).status).toBe(301);
      expect(new Redirect("/x", 307).status).toBe(307);
      expect(new Redirect("/x", 999).status).toBe(302); // invalid → 302
      expect(new Redirect("/x", 200).status).toBe(302);
    });

    it("clamps LoaderError to a real 4xx/5xx status", () => {
      expect(new LoaderError(404, "nope").status).toBe(404);
      expect(new LoaderError(500, "boom").status).toBe(500);
      expect(new LoaderError(200, "bad").status).toBe(500); // invalid → 500
      expect(new LoaderError(0, "zero").status).toBe(500);
    });
  });

  describe("head serialization hardening", () => {
    it("drops event-handler attribute names; keeps safe attrs and URLs", () => {
      const out = serializeHead([
        {
          htmlAttrs: { onload: "alert(1)", "data-x": "ok", lang: "en" },
          link: [{ rel: "icon", href: "javascript:alert(1)" }],
        },
      ]);
      expect(out.htmlAttrs).not.toContain("onload");
      expect(out.htmlAttrs).toContain('data-x="ok"');
      expect(out.htmlAttrs).toContain('lang="en"');
      expect(out.headTags).not.toContain("javascript:");
    });

    it("keeps safe link hrefs and drops an unsafe meta-refresh target", () => {
      const safe = serializeHead([
        {
          link: [{ rel: "stylesheet", href: "/app.css" }],
          meta: [{ "http-equiv": "refresh", content: "0; url=/home" }],
        },
      ]);
      expect(safe.headTags).toContain('/app.css"');
      expect(safe.headTags).toContain("refresh");

      const unsafe = serializeHead([
        { meta: [{ "http-equiv": "refresh", content: "0; url=javascript:alert(1)" }] },
        { link: [{ rel: "stylesheet", href: "//evil.example/app.css" }] },
        { script: [{ src: "//evil.example/app.js" }] },
      ]);
      expect(unsafe.headTags).not.toContain("refresh");
      expect(unsafe.headTags).not.toContain("evil.example");
    });
  });

  describe("request-first SSR API and respond()", () => {
    it("derives URL from a Request in runLoader", async () => {
      const load = loader(async ({ url }) => ({ path: url.pathname }));
      const r = router().route("/user/:id", Page, load);
      const res = await r.runLoader(new Request("http://localhost/user/42?tab=overview"));
      expect(res.kind).toBe("data");
      if (res.kind === "data") {
        const enveloped = res.data as { load: { value: unknown } };
        expect(enveloped.load.value).toEqual({ path: "/user/42" });
      }
    });

    it("renderResponse accepts a Request as the first argument", async () => {
      const r = router().route("/about", Page);
      const res = await r.renderResponse(new Request("http://localhost/about"), { index: Page });
      expect(res.kind).toBe("html");
      if (res.kind === "html") expect(res.html).toContain("page");
    });

    it("respond() returns a Response with security headers", async () => {
      const r = router().route("/", Page);
      const res = await r.respond(new Request("http://localhost/"), { index: Page });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  // ─────────────────────────────────────────────
  // Loader error redaction
  // ─────────────────────────────────────────────

  describe("loader error redaction", () => {
    const prevEnv = process.env.NODE_ENV;
    afterEach(() => {
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
    });

    it("redacts non-LoaderError messages in production", async () => {
      process.env.NODE_ENV = "production";
      const load = loader(async () => {
        throw new Error("connection to db://internal-host failed");
      });
      const r = router().route("/", Page, load);
      const res = await r.runLoader("http://localhost/");
      expect(res).toEqual({
        kind: "error",
        status: 500,
        message: "Internal error",
      });
    });

    it("keeps LoaderError messages in production (intentional user-facing errors)", async () => {
      process.env.NODE_ENV = "production";
      const load = loader(async () => {
        throw new LoaderError(404, "not found");
      });
      const r = router().route("/", Page, load);
      const res = await r.runLoader("http://localhost/");
      expect(res).toEqual({ kind: "error", status: 404, message: "not found" });
    });

    it("keeps raw messages in dev", async () => {
      process.env.NODE_ENV = "development";
      const load = loader(async () => {
        throw new Error("boom");
      });
      const r = router().route("/", Page, load);
      const res = await r.runLoader("http://localhost/");
      expect(res).toEqual({ kind: "error", status: 500, message: "boom" });
    });
  });

  // ─────────────────────────────────────────────
  // Loader timeout / abort
  // ─────────────────────────────────────────────

  describe("loader timeout", () => {
    it("aborts a hung loader after loaderTimeout ms", async () => {
      const load = loader(
        (ctx) =>
          new Promise<never>((_, reject) => {
            ctx.signal.addEventListener("abort", () => reject(new LoaderError(504, "timed out")), {
              once: true,
            });
          }),
      );
      const r = router({ loaderTimeout: 20 }).route("/", Page, load);
      const res = await r.runLoader("http://localhost/");
      expect(res).toEqual({ kind: "error", status: 504, message: "timed out" });
    });

    it("aborts when the incoming request signal aborts", async () => {
      const load = loader(
        (ctx) =>
          new Promise<never>((_, reject) => {
            ctx.signal.addEventListener(
              "abort",
              () => reject(new LoaderError(499, "client gone")),
              {
                once: true,
              },
            );
          }),
      );
      const r = router().route("/", Page, load);
      const ctrl = new AbortController();
      const pending = r.runLoader(
        "http://localhost/",
        new Request("http://localhost/", { signal: ctrl.signal }),
      );
      ctrl.abort();
      const res = await pending;
      expect(res).toEqual({ kind: "error", status: 499, message: "client gone" });
    });
  });

  // ─────────────────────────────────────────────
  // notFound island
  // ─────────────────────────────────────────────

  describe("router({ notFound })", () => {
    it("renders the notFound island with a 404 status on the server", async () => {
      const r = router({ notFound: NotFoundPage }).route("/", Page);
      const res = await r.renderResponse("http://localhost/nope", {
        index: Page,
      });
      expect(res.kind).toBe("html");
      if (res.kind === "html") {
        expect(res.status).toBe(404);
        expect(res.html).toContain("<h1>lost</h1>");
        expect(res.html).toContain("data-router-not-found");
      }
    });

    it("renders the notFound island in RouterView on the client", () => {
      setLocation("/nowhere");
      const r = router({ notFound: NotFoundPage }).route("/", Page);
      expect(r.render("http://localhost/nowhere")).toContain("<h1>lost</h1>");
    });

    it("falls back to data-router-empty without a notFound island", async () => {
      const r = router().route("/", Page);
      const res = await r.renderResponse("http://localhost/nope", {
        index: Page,
      });
      if (res.kind === "html") {
        expect(res.status).toBe(404);
        expect(res.html).toContain("data-router-empty");
      }
    });
  });

  // ─────────────────────────────────────────────
  // isActive prefix matching
  // ─────────────────────────────────────────────

  describe("isActive({ exact: false })", () => {
    it("matches nested paths as a prefix", () => {
      router()
        .route("/docs", Page)
        .route(
          "/docs/:slug",
          ilha(() => `<p>doc</p>`),
        );
      setLocation("/");
      navigate("/docs/getting-started"); // sync signals
      expect(isActive("/docs")).toBe(false);
      expect(isActive("/docs", { exact: false })).toBe(true);
      expect(isActive("/docs/", { exact: false })).toBe(true);
      expect(isActive("/doc", { exact: false })).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // Navigation hooks
  // ─────────────────────────────────────────────

  describe("beforeNavigate / afterNavigate", () => {
    it("cancel() prevents the navigation", () => {
      router().route("/", Page);
      setLocation("/");
      navigate("/"); // sync signals to "/"
      const off = beforeNavigate((nav) => {
        if (nav.to === "/blocked") nav.cancel();
      });
      try {
        navigate("/blocked");
        expect(window.location.pathname).toBe("/");
        navigate("/allowed");
        expect(window.location.pathname).toBe("/allowed");
      } finally {
        off();
      }
    });

    it("afterNavigate fires with from/to/type", () => {
      router().route("/", Page);
      setLocation("/");
      navigate("/"); // ensure a known starting point
      const seen: Array<{ from: string; to: string; type: string }> = [];
      const off = afterNavigate((nav) => seen.push(nav));
      try {
        navigate("/next?q=1");
        expect(seen).toEqual([{ from: "/", to: "/next?q=1", type: "push" }]);
      } finally {
        off();
      }
    });

    it("a throwing hook does not break navigation", () => {
      router().route("/", Page);
      setLocation("/");
      navigate("/");
      const off = beforeNavigate(() => {
        throw new Error("hook boom");
      });
      try {
        navigate("/still-works");
        expect(window.location.pathname).toBe("/still-works");
      } finally {
        off();
      }
    });
  });

  // ─────────────────────────────────────────────
  // Plugin — ?client containment
  // ─────────────────────────────────────────────

  describe("resolvePagesId containment", () => {
    it("refuses ?client ids that resolve outside the pages dir", () => {
      const state = createPagesPluginState({});
      state.setPaths("/proj");
      const importer = join("/proj", ".ilha", "pages.client.ts");
      const escape = resolvePagesId(state, `../../../etc/passwd${CLIENT_QUERY}`, importer);
      expect(escape).toBeUndefined();
    });

    it("fails closed when pagesDir is not configured yet", () => {
      const state = createPagesPluginState({});
      // no setPaths() — pagesDir is still unset, so containment can't be checked
      const importer = join("/proj", ".ilha", "pages.client.ts");
      const escape = resolvePagesId(state, `../../../etc/passwd${CLIENT_QUERY}`, importer);
      expect(escape).toBeUndefined();
    });

    it("still resolves ?client ids inside the pages dir", () => {
      const state = createPagesPluginState({});
      state.setPaths("/proj");
      const importer = join("/proj", ".ilha", "pages.client.ts");
      const ok = resolvePagesId(state, `../src/pages/index.tsx${CLIENT_QUERY}`, importer);
      expect(ok).toBe(join("/proj", "src", "pages", "index.tsx") + CLIENT_QUERY);
    });
  });

  // ─────────────────────────────────────────────
  // Codegen — strict mode
  // ─────────────────────────────────────────────

  describe("codegen strict mode", () => {
    it("throws on duplicate route patterns when strict", async () => {
      const root = await mkdtemp(join(tmpdir(), "ilha-strict-test-"));
      try {
        const pagesDir = join(root, "pages");
        await mkdir(join(pagesDir, "foo"), { recursive: true });
        const island = `import { ilha } from "ilha"; export default ilha(() => "<p>x</p>");`;
        // Both map to "/foo"
        await writeFile(join(pagesDir, "foo.ts"), island);
        await writeFile(join(pagesDir, "foo", "index.ts"), island);

        await expect(generate(pagesDir, join(root, "out"), { strict: true })).rejects.toThrow(
          /Duplicate route pattern/,
        );
        // Non-strict still succeeds (warns only)
        await generate(pagesDir, join(root, "out"));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
}

// ─────────── from inplace-update.test.ts ───────────
{
  // =============================================================================
  // Same-island navigations update the mounted view in place (no remount):
  // loader data flows through updateProps + morph, so focus, caret, and scroll
  // survive — the persistQuery filter-input case. Island-changed navigations
  // keep the teardown + mount path.
  // =============================================================================

  function makeEl(inner = ""): Element {
    const el = document.createElement("div");
    el.innerHTML = inner;
    document.body.appendChild(el);
    return el;
  }

  function cleanup(el: Element) {
    el.remove();
  }

  function setLocation(path: string) {
    window.location.href = "http://localhost" + path;
  }

  const flush = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };

  /** Wait long enough for scrollAfterNavigate's requestAnimationFrame. */
  const flushRaf = async () => {
    await new Promise((r) => setTimeout(r, 40));
  };

  const HomePage = ilha(() => `<p>home</p>`);
  const AboutPage = ilha(() => `<p>about</p>`);

  /** A search page: an input plus a loader-driven list. */
  function makeSearchPage() {
    return ilha(
      (input: any) =>
        `<div><input data-q /><ul>${((input?.load?.value?.rows ?? []) as string[])
          .map((r) => `<li>${r}</li>`)
          .join("")}</ul></div>`,
    );
  }

  /** Loader echoing ?q= into rows. */
  function makeSearchLoader() {
    return mock(async ({ url }: any) => ({ rows: [url.searchParams.get("q") ?? ""] }));
  }

  describe("same-island in-place updates (SPA mode)", () => {
    let el: Element;
    let unmount: (() => void) | null = null;

    beforeEach(() => {
      setLocation("/");
      el = makeEl();
    });

    afterEach(() => {
      unmount?.();
      unmount = null;
      cleanup(el);
      setLocation("/");
    });

    it("focus + caret survive a search-only navigation; the list re-renders with new data", async () => {
      const SearchPage = makeSearchPage();
      const load = makeSearchLoader();
      unmount = router().route("/", HomePage).route("/s", SearchPage, loader(load)).mount(el);

      navigate("/s?q=a");
      await flush();
      expect(el.innerHTML).toContain("<li>a</li>");

      const input = el.querySelector<HTMLInputElement>("input[data-q]")!;
      input.focus();
      input.value = "ab";
      input.setSelectionRange(1, 1);
      expect(document.activeElement).toBe(input);

      navigate("/s?q=ab");
      await flush();

      // Same DOM node — not a remounted copy — still focused, caret intact.
      expect(el.querySelector("input[data-q]")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(1);
      // And the loader-driven part of the view did re-render.
      expect(load).toHaveBeenCalledTimes(2);
      expect(el.innerHTML).toContain("<li>ab</li>");
      expect(el.innerHTML).not.toContain("<li>a</li><li>a</li>");
    });

    it("updateProps path: view container and page root are not replaced across a param change", async () => {
      const SearchPage = makeSearchPage();
      const load = makeSearchLoader();
      unmount = router().route("/", HomePage).route("/s", SearchPage, loader(load)).mount(el);

      navigate("/s?q=one");
      await flush();
      const view = el.querySelector("[data-router-view]")!;
      const pageRoot = view.firstElementChild!;

      navigate("/s?q=two");
      await flush();

      // innerHTML was not reassigned — same container, same page root element.
      expect(el.querySelector("[data-router-view]")).toBe(view);
      expect(view.firstElementChild).toBe(pageRoot);
      expect(view.innerHTML).toContain("<li>two</li>");
    });

    it("island change still remounts: effect cleanup runs exactly once, none for same-island navs", async () => {
      let cleanups = 0;
      const FxPage = ilha((input: any) => {
        // effect.once: setup runs once per mount; its cleanup fires only on
        // unmount, so teardown counts distinguish in-place updates from remounts.
        effect.once(() => () => {
          cleanups++;
        });
        return `<p>fx:${input?.load?.value?.rows?.[0] ?? "-"}</p>`;
      });
      const load = makeSearchLoader();
      unmount = router()
        .route("/", HomePage)
        .route("/about", AboutPage)
        .route("/fx", FxPage, loader(load))
        .mount(el);

      navigate("/fx?q=a");
      await flush();
      navigate("/fx?q=b");
      await flush();
      expect(cleanups).toBe(0); // in-place update — no teardown
      expect(el.innerHTML).toContain("fx:b");

      navigate("/about");
      await flush();
      expect(cleanups).toBe(1); // island changed — exactly one teardown
      expect(el.innerHTML).toContain("about");
    });

    it("invalidate() updates the mounted island in place — focused element preserved", async () => {
      const SearchPage = makeSearchPage();
      const load = makeSearchLoader();
      unmount = router().route("/", HomePage).route("/s", SearchPage, loader(load)).mount(el);

      navigate("/s?q=a");
      await flush();
      const input = el.querySelector<HTMLInputElement>("input[data-q]")!;
      input.focus();

      await invalidate();
      await flush();

      expect(load).toHaveBeenCalledTimes(2);
      expect(el.querySelector("input[data-q]")).toBe(input);
      expect(document.activeElement).toBe(input);
    });

    it("superseded navigations never apply: only the final loader result reaches the DOM", async () => {
      const SearchPage = makeSearchPage();
      const pending: Array<{ q: string; resolve: () => void }> = [];
      const load = mock(({ url }: any) => {
        const q = url.searchParams.get("q") ?? "";
        return new Promise((resolve) => {
          pending.push({ q, resolve: () => resolve({ rows: [q] }) });
        });
      });
      unmount = router()
        .route("/", HomePage)
        .route("/s", SearchPage, loader(load as any))
        .mount(el);

      navigate("/s?q=a");
      await flush(); // loader for "a" is in flight
      navigate("/s?q=ab");
      await flush();
      navigate("/s?q=abc");
      await flush();

      // Resolve stale loaders first — their navigations were superseded, so
      // their data must never be pushed into the view.
      pending.find((p) => p.q === "a")?.resolve();
      pending.find((p) => p.q === "ab")?.resolve();
      await flush();
      expect(el.innerHTML).not.toContain("<li>a</li>");
      expect(el.innerHTML).not.toContain("<li>ab</li>");

      pending.find((p) => p.q === "abc")?.resolve();
      await flush();
      expect(el.innerHTML).toContain("<li>abc</li>");
    });

    it("same-island navigation keeps scroll; island change scrolls to top", async () => {
      const SearchPage = makeSearchPage();
      const load = makeSearchLoader();
      unmount = router()
        .route("/", HomePage)
        .route("/about", AboutPage)
        .route("/s", SearchPage, loader(load))
        .mount(el);
      navigate("/s?q=a");
      await flush();

      const scrollSpy = spyOn(window, "scrollTo").mockImplementation((() => {}) as any);
      try {
        navigate("/s?q=ab");
        await flush();
        await flushRaf();
        // Param change on the same island — no scroll reset.
        expect(scrollSpy).not.toHaveBeenCalled();

        navigate("/about");
        await flush();
        await flushRaf();
        // Island change — existing scroll-to-top behavior.
        expect(scrollSpy).toHaveBeenCalledWith(0, 0);
      } finally {
        scrollSpy.mockRestore();
      }
    });

    it("layouts update in place too: page under an input-ignoring layout keeps focus and gets new props", async () => {
      const SearchPage = makeSearchPage();
      // Layout that never reads its input — props must still reach the page.
      const Wrapped = wrapLayout(
        (children: any) => ilha(() => html`<section data-shell>${children}</section>`),
        SearchPage,
      );
      const load = makeSearchLoader();
      unmount = router().route("/", HomePage).route("/l", Wrapped, loader(load)).mount(el);

      navigate("/l?q=a");
      await flush();
      expect(el.innerHTML).toContain("<li>a</li>");
      const input = el.querySelector<HTMLInputElement>("input[data-q]")!;
      input.focus();
      input.setSelectionRange(0, 0);

      // happy-dom doesn't blur on detach like real engines do, so also assert
      // via MutationObserver that no ancestor of the input is ever removed —
      // the real-browser condition for focus surviving the navigation.
      const removals: Node[] = [];
      const obs = new MutationObserver(() => {});
      obs.observe(el, { childList: true, subtree: true });

      navigate("/l?q=ab");
      await flush();

      for (const record of obs.takeRecords()) {
        for (const node of record.removedNodes) {
          if (node === input || (node as Element).contains?.(input)) removals.push(node);
        }
      }
      obs.disconnect();
      expect(removals).toEqual([]);
      expect(el.querySelector("input[data-q]")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(el.innerHTML).toContain("<li>ab</li>");
      expect(el.querySelector("[data-shell]")).not.toBeNull();
    });
  });

  describe("same-island in-place updates (hydrate mode)", () => {
    afterEach(() => {
      setLocation("/");
    });

    it("router-mounted view updates in place on the second same-island navigation", async () => {
      const SearchPage = makeSearchPage();
      const load = makeSearchLoader();
      const reg = { home: HomePage, search: SearchPage };

      setLocation("/");
      const el = makeEl(`<div data-router-view><p>home</p></div>`);
      const unmount = router()
        .route("/", HomePage)
        .route("/s", SearchPage, loader(load))
        .mount(el, { hydrate: true, registry: reg });
      await flush();

      // First navigation to /s mounts the island fresh (island changed).
      navigate("/s?q=a");
      await flush();
      expect(el.innerHTML).toContain("<li>a</li>");
      const input = el.querySelector<HTMLInputElement>("input[data-q]")!;
      input.focus();

      // Second navigation: same island — must update in place.
      navigate("/s?q=ab");
      await flush();
      expect(el.querySelector("input[data-q]")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(el.innerHTML).toContain("<li>ab</li>");

      unmount();
      cleanup(el);
    });

    it("adopts the SSR-hydrated island: the very first same-island navigation updates in place", async () => {
      const SearchPage = makeSearchPage();
      const load = makeSearchLoader();
      const reg = { home: HomePage, search: SearchPage };

      const ssrHtml = await router()
        .route("/", HomePage)
        .route("/s", SearchPage, loader(load))
        .renderHydratable("/s?q=a", reg);
      expect(ssrHtml).toContain("<li>a</li>");

      setLocation("/s?q=a");
      const el = makeEl(ssrHtml);
      // App boot: ilha.mount() hydrates the SSR islands (the router never saw
      // these handles — it must adopt them).
      const hydrated = ilhaMount(reg, { root: el });
      const unmount = router()
        .route("/", HomePage)
        .route("/s", SearchPage, loader(load))
        .mount(el, { hydrate: true, registry: reg });
      await flush();

      const input = el.querySelector<HTMLInputElement>("input[data-q]")!;
      input.focus();

      navigate("/s?q=ab");
      await flush();

      // In-place: the hydrated input survived the first client navigation.
      expect(el.querySelector("input[data-q]")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(el.innerHTML).toContain("<li>ab</li>");

      unmount();
      void hydrated.unmount();
      cleanup(el);
    });
  });
}

// ─────────── from layout-nested-children.test.ts ───────────
{
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
      `data-ilha-slot="${slotId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*data-ilha-props='([^']*)'`,
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

      const Pagination = ilha<{
        page: number;
        setPage?: (n: number) => void;
        children?: unknown;
      }>((props) => {
        effect.once(({ host, signal }) => {
          host.addEventListener(
            "click",
            (event) => {
              if ((event.target as Element).closest("[data-next]")) {
                props.setPage?.(props.page + 1);
              }
            },
            { signal },
          );
        });
        return html`<div data-slot="pagination" data-page=${String(props.page)}>
          ${paintChildren(props.children)}<button type="button" data-next>next</button>
        </div>`;
      });

      const Page = ilha(() => html`<p data-page-body>page</p>`);

      const Layout = defineLayout((Children) =>
        ilha<{ page: number }>(({ page }) =>
          jsxs("div", {
            class: "flex",
            children: [
              jsx("footer", {
                children: jsx(Pagination as never, {
                  key: "grid-pagination",
                  page,
                  setPage: (p: number) => {
                    setPageCalls.push(p);
                  },
                  children: [
                    jsx("span", { "data-info": true, children: `info ${page}` }),
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

      const Pagination = ilha<{
        page: number;
        totalCount: number;
        setPage?: (n: number) => void;
        children?: unknown;
      }>((props) => {
        effect.once(({ host, signal }) => {
          host.addEventListener(
            "click",
            (event) => {
              if ((event.target as Element).closest("[data-next]")) {
                props.setPage?.(props.page + 1);
              }
            },
            { signal },
          );
        });
        return html`<div
          data-slot="pagination"
          data-page=${String(props.page)}
          data-total=${String(props.totalCount)}
        >
          ${paintChildren(props.children)}<button type="button" data-next>next</button>
        </div>`;
      });

      const Page = ilha(() => html`<p data-page-body>page</p>`);

      const Layout = defineLayout((Children) =>
        ilha<{ page: number; totalCount: number }>(({ page, totalCount }) =>
          jsxs("div", {
            class: "flex",
            children: [
              jsx("footer", {
                children: jsx(Pagination as never, {
                  key: "grid-pagination",
                  page,
                  totalCount,
                  setPage: (p: number) => {
                    setPageCalls.push(p);
                  },
                  children: [
                    jsx("span", {
                      "data-info": true,
                      children: `info ${page}/${totalCount}`,
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

      const Tool = ilha<{ name: string; onGo?: () => void; children?: unknown }>((props) => {
        effect.once(({ host, signal }) => {
          host.addEventListener(
            "click",
            (event) => {
              if ((event.target as Element).closest("[data-go]")) props.onGo?.();
            },
            { signal },
          );
        });
        return html`<div data-tool=${props.name}>
          ${paintChildren(props.children)}
          <button type="button" data-go>${props.name}</button>
        </div>`;
      });

      const Page = ilha(() => html`<p data-page>page</p>`);

      const Inner = defineLayout((Children) =>
        ilha(() =>
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
        ilha(() =>
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

      const Chip = ilha<{ id: number; onHit?: (id: number) => void; children?: unknown }>(
        (props) => {
          effect.once(({ host, signal }) => {
            host.addEventListener(
              "click",
              (event) => {
                if ((event.target as Element).closest("[data-hit]")) {
                  props.onHit?.(props.id);
                }
              },
              { signal },
            );
          });
          return html`<button type="button" data-hit data-chip=${String(props.id)}>
            ${paintChildren(props.children)}
          </button>`;
        },
      );

      const Page = ilha<{ marker: string }>(
        ({ marker }) => html`<p data-page-marker>${marker}</p>`,
      );

      const Layout = defineLayout((Children) =>
        ilha<{ marker: string; tick: number }>(({ tick }) => {
          const chips = Array.from({ length: 12 }, (_, id) =>
            jsx(Chip as never, {
              key: `chip-${id}`,
              id,
              onHit: (n: number) => hits.push(n),
              children: [
                jsx("span", {
                  "data-chip-label": true,
                  children: `c${id}@${tick}`,
                }),
              ],
            }),
          );
          return jsxs("div", {
            "data-layout": true,
            children: [
              jsx("nav", { "data-nav": true, children: chips }),
              jsx(Children as never, {}),
            ],
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
      const Pagination = ilha<{
        page: number;
        total: number;
        setPage?: (n: number) => void;
        children?: unknown;
      }>((props) => {
        effect.once(({ host, signal }) => {
          host.addEventListener(
            "click",
            (event) => {
              if ((event.target as Element).closest("[data-next]")) {
                props.setPage?.(props.page + 1);
              }
            },
            { signal },
          );
        });
        return html`<div data-pag data-page=${String(props.page)} data-total=${String(props.total)}>
          ${paintChildren(props.children)}
          <button type="button" data-next>n</button>
        </div>`;
      });

      const calls: number[] = [];
      const Page = ilha(() => html`<p data-page>p</p>`);
      const Layout = defineLayout((Children) =>
        ilha<{ page: number; total: number }>(({ page, total }) =>
          jsxs("div", {
            children: [
              jsx(Pagination as never, {
                key: "pag",
                page,
                total,
                setPage: (n: number) => calls.push(n),
                children: [
                  jsx("span", {
                    "data-info": true,
                    children: `${page}/${total}`,
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
      const ssr = await Wrapped.hydratable(
        { page: 1, total: 10 },
        { name: "page", snapshot: true },
      );
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
      const Pos = ilha<{ label: string; children?: unknown }>(
        ({ label, children }) => html`<aside data-pos>${label}:${paintChildren(children)}</aside>`,
      );
      const Keyed = ilha<{ label: string; children?: unknown }>(
        ({ label, children }) =>
          html`<header data-keyed>${label}:${paintChildren(children)}</header>`,
      );

      const Page = ilha(() => html`<main data-main>main</main>`);
      const Layout = defineLayout((Children) =>
        ilha(() =>
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
}
