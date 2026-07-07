import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ilha from "ilha";

import { generate } from "./codegen";
import {
  router,
  navigate,
  isActive,
  beforeNavigate,
  afterNavigate,
  loader,
  redirect,
  LoaderError,
} from "./index";
import { createPagesPluginState, resolvePagesId, CLIENT_QUERY } from "./plugin";

const Page = ilha.render(() => `<p>page</p>`);
const NotFoundPage = ilha.render(() => `<h1>lost</h1>`);

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

// ─────────────────────────────────────────────
// Loader error redaction
// ─────────────────────────────────────────────

describe("loader error redaction", () => {
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = prevEnv;
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
          ctx.signal.addEventListener("abort", () => reject(new LoaderError(499, "client gone")), {
            once: true,
          });
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
        ilha.render(() => `<p>doc</p>`),
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
      const island = `import ilha from "ilha"; export default ilha.render(() => "<p>x</p>");`;
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
