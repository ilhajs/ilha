import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ilha from "ilha";

import { routePath, routeParams } from "./index";
import {
  wrapLayout,
  wrapError,
  pages,
  type LayoutHandler,
  type ErrorHandler,
  type AppError,
  type RouteSnapshot,
} from "./vite";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function makeDir(suffix: string): Promise<string> {
  const dir = join(tmpdir(), `ilha-pages-test-${suffix}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writePage(dir: string, rel: string, content: string): Promise<void> {
  const full = join(dir, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content, "utf8");
}

async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

const make = (content: string) => ilha.render(() => content);

// ─────────────────────────────────────────────
// wrapLayout()
// ─────────────────────────────────────────────

describe("wrapLayout()", () => {
  it("wraps page island with layout", () => {
    const page: LayoutHandler = (children) =>
      ilha.render(() => `<layout>${children.toString()}</layout>`);
    const inner = make("<p>content</p>");
    const wrapped = wrapLayout(page, inner);
    expect(wrapped.toString()).toContain("<layout>");
    expect(wrapped.toString()).toContain("<p>content</p>");
  });

  it("nested layouts compose correctly — inner layout is innermost", () => {
    const rootLayout: LayoutHandler = (children) =>
      ilha.render(() => `<root>${children.toString()}</root>`);
    const userLayout: LayoutHandler = (children) =>
      ilha.render(() => `<user>${children.toString()}</user>`);
    const page = make("<p>page</p>");
    const wrapped = wrapLayout(rootLayout, wrapLayout(userLayout, page));
    const html = wrapped.toString();
    expect(html).toContain("<root>");
    expect(html).toContain("<user>");
    expect(html).toContain("<p>page</p>");
    expect(html.indexOf("<root>")).toBeLessThan(html.indexOf("<user>"));
    expect(html.indexOf("<user>")).toBeLessThan(html.indexOf("<p>page</p>"));
  });

  it("returns an island with .toString and .mount", () => {
    const layout: LayoutHandler = (children) => ilha.render(() => children.toString());
    const wrapped = wrapLayout(layout, make("hi"));
    expect(typeof wrapped.toString).toBe("function");
    expect(typeof wrapped.mount).toBe("function");
  });
});

// ─────────────────────────────────────────────
// wrapError()
// ─────────────────────────────────────────────

describe("wrapError()", () => {
  it("renders page normally when no error is thrown", () => {
    const handler: ErrorHandler = () => make(`<p>error</p>`);
    const wrapped = wrapError(handler, make(`<p>ok</p>`));
    expect(wrapped.toString()).toContain("<p>ok</p>");
    expect(wrapped.toString()).not.toContain("<p>error</p>");
  });

  it("renders error island when page throws", () => {
    const handler: ErrorHandler = (err) => make(`<p>caught:${err.message}</p>`);
    const page = ilha.render(() => {
      throw new Error("boom");
    });
    const wrapped = wrapError(handler, page);
    expect(wrapped.toString()).toContain("caught:boom");
  });

  it("passes error.message, error.status, error.stack to handler", () => {
    let captured: AppError | null = null;
    const handler: ErrorHandler = (err) => {
      captured = err;
      return make("");
    };
    const page = ilha.render(() => {
      const e: any = new Error("fail");
      e.status = 500;
      throw e;
    });
    wrapError(handler, page).toString();
    expect(captured!.message).toBe("fail");
    expect(captured!.status).toBe(500);
    expect(typeof captured!.stack).toBe("string");
  });

  it("passes current route snapshot to handler", () => {
    let snapshot: RouteSnapshot | null = null;
    const handler: ErrorHandler = (_, route) => {
      snapshot = route;
      return make("");
    };
    const page = ilha.render(() => {
      throw new Error("x");
    });
    routePath("/user/7");
    routeParams({ id: "7" });
    wrapError(handler, page).toString();
    expect(snapshot!.path).toBe("/user/7");
    expect(snapshot!.params).toEqual({ id: "7" });
  });

  it("nearest error boundary is innermost — outer boundary not called when inner catches", () => {
    let outerCalled = false;
    const outer: ErrorHandler = () => {
      outerCalled = true;
      return make("outer");
    };
    const inner: ErrorHandler = () => make("inner-caught");
    const page = ilha.render(() => {
      throw new Error("e");
    });
    const wrapped = wrapError(outer, wrapError(inner, page));
    expect(wrapped.toString()).toContain("inner-caught");
    expect(outerCalled).toBe(false);
  });

  it("falls back to outer boundary if inner re-throws", () => {
    const outer: ErrorHandler = () => make("outer-caught");
    const inner: ErrorHandler = (err) =>
      ilha.render(() => {
        throw err;
      });
    const page = ilha.render(() => {
      throw new Error("e");
    });
    const wrapped = wrapError(outer, wrapError(inner, page));
    expect(wrapped.toString()).toContain("outer-caught");
  });

  it("returns an island with .toString and .mount", () => {
    const wrapped = wrapError(() => make(""), make("hi"));
    expect(typeof wrapped.toString).toBe("function");
    expect(typeof wrapped.mount).toBe("function");
  });
});

// ─────────────────────────────────────────────
// codegen — generated file
// ─────────────────────────────────────────────

describe("codegen — generated file", () => {
  let pagesDir: string;
  let outFile: string;
  let root: string;

  beforeEach(async () => {
    root = await makeDir("root");
    pagesDir = join(root, "src/pages");
    outFile = join(root, "src/generated/page-routes.ts");
    await mkdir(pagesDir, { recursive: true });
  });

  afterEach(async () => {
    await removeDir(root);
  });

  async function runCodegen() {
    const plugin = pages({ dir: pagesDir, generated: outFile }) as any;
    plugin.configResolved({ root });
    await plugin.buildStart();
    return readFile(outFile, "utf8");
  }

  it("generates a file with the @generated header", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    expect(await runCodegen()).toContain("@generated by @ilha/router");
  });

  it("maps index.ts → /", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/"`);
  });

  it("maps about.ts → /about", async () => {
    await writePage(pagesDir, "about.ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/about"`);
  });

  it("maps [id].ts → /:id", async () => {
    await writePage(pagesDir, "[id].ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/:id"`);
  });

  it("maps user/[id].ts → /user/:id", async () => {
    await writePage(pagesDir, "user/[id].ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/user/:id"`);
  });

  it("maps [...slug].ts → /**:slug", async () => {
    await writePage(pagesDir, "[...slug].ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/**:slug"`);
  });

  it("maps nested [org]/[repo].ts → /:org/:repo", async () => {
    await writePage(pagesDir, "[org]/[repo].ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/:org/:repo"`);
  });

  it("excludes +layout.ts and +error.ts from page routes", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await writePage(pagesDir, "+layout.ts", `export default null;`);
    await writePage(pagesDir, "+error.ts", `export default null;`);
    const code = await runCodegen();
    const routeLines = code.split("\n").filter((l) => l.includes(".route("));
    expect(routeLines.every((l) => !l.includes("+layout"))).toBe(true);
    expect(routeLines.every((l) => !l.includes("+error"))).toBe(true);
    expect(routeLines).toHaveLength(1);
    expect(routeLines[0]).toContain(`"/"`);
  });

  it("imports root +layout.ts and wraps page", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await writePage(pagesDir, "+layout.ts", `export default null;`);
    const code = await runCodegen();
    expect(code).toContain("wrapLayout(");
    expect(code).toContain("+layout.ts");
  });

  it("imports root +error.ts and wraps page", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await writePage(pagesDir, "+error.ts", `export default null;`);
    const code = await runCodegen();
    expect(code).toContain("wrapError(");
    expect(code).toContain("+error.ts");
  });

  it("nested +layout.ts is applied only to pages in its subtree", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await writePage(pagesDir, "user/index.ts", `export default null;`);
    await writePage(pagesDir, "+layout.ts", `export default null;`);
    await writePage(pagesDir, "user/+layout.ts", `export default null;`);
    const code = await runCodegen();
    const wrappedLines = code
      .split("\n")
      .filter((l) => l.includes("const _wrapped") && l.includes("wrapLayout"));
    const userWrapped = wrappedLines.find((l) => l.includes("_layout1"));
    const rootWrapped = wrappedLines.find((l) => l.includes("_layout0") && !l.includes("_layout1"));
    expect([...userWrapped!.matchAll(/wrapLayout/g)]).toHaveLength(2);
    expect([...rootWrapped!.matchAll(/wrapLayout/g)]).toHaveLength(1);
  });

  it("root layout wraps all pages, nested layout wraps only its subtree", async () => {
    await writePage(pagesDir, "about.ts", `export default null;`);
    await writePage(pagesDir, "user/[id].ts", `export default null;`);
    await writePage(pagesDir, "+layout.ts", `export default null;`);
    await writePage(pagesDir, "user/+layout.ts", `export default null;`);
    const code = await runCodegen();
    const wrappedLines = code
      .split("\n")
      .filter((l) => l.includes("const _wrapped") && l.includes("wrapLayout"));
    const aboutWrapped = wrappedLines.find((l) => l.includes("_page0") || l.includes("about"));
    const userWrapped = wrappedLines.find((l) => l.includes("_page1") || l.includes("user"));
    expect([...aboutWrapped!.matchAll(/wrapLayout/g)]).toHaveLength(1);
    expect([...userWrapped!.matchAll(/wrapLayout/g)]).toHaveLength(2);
  });

  it("generates export const pageRouter", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    expect(await runCodegen()).toContain("export const pageRouter");
  });

  it("does not generate export default", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    expect(await runCodegen()).not.toContain("export default");
  });

  it("empty pages dir generates an empty router", async () => {
    const code = await runCodegen();
    expect(code).toContain("export const pageRouter = router()");
    expect(code).not.toContain(".route(");
  });

  // ─────────────────────────────────────────────
  // Route groups
  // ─────────────────────────────────────────────

  it("route group: (auth)/sign-in.ts → /sign-in", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/sign-in"`);
  });

  it("route group: (auth)/sign-up.ts → /sign-up", async () => {
    await writePage(pagesDir, "(auth)/sign-up.ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/sign-up"`);
  });

  it("route group: (marketing)/index.ts → /", async () => {
    await writePage(pagesDir, "(marketing)/index.ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/"`);
  });

  it("route group: (shop)/products/[id].ts → /products/:id", async () => {
    await writePage(pagesDir, "(shop)/products/[id].ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/products/:id"`);
  });

  it("route group folder name does not appear in the URL", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    const code = await runCodegen();
    expect(code).not.toContain(`"(auth)`);
    expect(code).not.toContain(`/auth/`);
  });

  it("multiple route groups can coexist without collision", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    await writePage(pagesDir, "(marketing)/about.ts", `export default null;`);
    const code = await runCodegen();
    expect(code).toContain(`route("/sign-in"`);
    expect(code).toContain(`route("/about"`);
  });

  it("route group +layout.ts wraps only pages inside the group", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    await writePage(pagesDir, "about.ts", `export default null;`);
    await writePage(pagesDir, "(auth)/+layout.ts", `export default null;`);
    const code = await runCodegen();
    const lines = code.split("\n");
    const wrappedLines = lines.filter(
      (l) => l.includes("const _wrapped") && l.includes("wrapLayout"),
    );
    // exactly one page gets wrapped (sign-in); about does not
    expect(wrappedLines).toHaveLength(1);
    // find which _pageN import corresponds to sign-in, then verify that variable is the wrapped one
    const signInImport = lines.find((l) => l.startsWith("import") && l.includes("sign-in"));
    const pageVar = signInImport?.match(/as (_page\d+)/)?.[1];
    expect(pageVar).toBeDefined();
    expect(wrappedLines[0]).toContain(pageVar!);
  });

  it("route group +layout.ts is picked up by chainForFile for pages inside it", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    await writePage(pagesDir, "(auth)/+layout.ts", `export default null;`);
    const code = await runCodegen();
    expect(code).toContain("wrapLayout(");
    expect(code).toContain("+layout.ts");
  });

  it("root +layout.ts also wraps pages inside a route group", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    await writePage(pagesDir, "+layout.ts", `export default null;`);
    const code = await runCodegen();
    expect(code).toContain("wrapLayout(");
  });

  it("nested route group: (a)/(b)/page.ts → /page", async () => {
    await writePage(pagesDir, "(a)/(b)/page.ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/page"`);
  });

  it("route group: (auth)/sign-in.ts → /sign-in", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/sign-in"`);
  });

  it("leaf filename (landing).ts is NOT treated as a group — maps to /(landing)", async () => {
    await writePage(pagesDir, "(landing).ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/(landing)"`);
  });

  it("leaf filename (landing).ts does not collide with index.ts", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await writePage(pagesDir, "(landing).ts", `export default null;`);
    const code = await runCodegen();
    expect(code).toContain(`route("/"`);
    expect(code).toContain(`route("/(landing)"`);
  });

  it("group folder (auth) is transparent but leaf (login).ts in it is not", async () => {
    await writePage(pagesDir, "(auth)/(login).ts", `export default null;`);
    expect(await runCodegen()).toContain(`route("/(login)"`);
  });
});

// ─────────────────────────────────────────────
// codegen — registry
// ─────────────────────────────────────────────

describe("codegen — registry", () => {
  let pagesDir: string;
  let outFile: string;
  let root: string;

  beforeEach(async () => {
    root = await makeDir("registry");
    pagesDir = join(root, "src/pages");
    outFile = join(root, ".ilha/routes.ts");
    await mkdir(pagesDir, { recursive: true });
  });

  afterEach(async () => {
    await removeDir(root);
  });

  async function runCodegen() {
    const plugin = pages({ dir: pagesDir, generated: outFile }) as any;
    plugin.configResolved({ root });
    await plugin.buildStart();
    return readFile(outFile, "utf8");
  }

  it("generates export const registry", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    expect(await runCodegen()).toContain("export const registry");
  });

  it("registry is typed as Record<string, Island<any, any>>", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    expect(await runCodegen()).toContain("Record<string, Island<any, any>>");
  });

  it("imports Island type from ilha", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    expect(await runCodegen()).toContain(`from "ilha"`);
  });

  it("maps index.ts → registry key 'index'", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    expect(await runCodegen()).toContain(`"index"`);
  });

  it("maps about.ts → registry key 'about'", async () => {
    await writePage(pagesDir, "about.ts", `export default null;`);
    expect(await runCodegen()).toContain(`"about"`);
  });

  it("maps [id].ts → registry key 'id'", async () => {
    await writePage(pagesDir, "[id].ts", `export default null;`);
    expect(await runCodegen()).toContain(`"id"`);
  });

  it("maps user/[id].ts → registry key 'user-id'", async () => {
    await writePage(pagesDir, "user/[id].ts", `export default null;`);
    expect(await runCodegen()).toContain(`"user-id"`);
  });

  it("maps [...slug].ts → registry key 'slug'", async () => {
    await writePage(pagesDir, "[...slug].ts", `export default null;`);
    expect(await runCodegen()).toContain(`"slug"`);
  });

  it("maps anonymous wildcard [...].ts → registry key 'wildcard'", async () => {
    // [...] — empty param name → wildcard
    await writePage(pagesDir, "[...].ts", `export default null;`);
    const code = await runCodegen();
    expect(code).toContain(`"wildcard"`);
  });

  it("registry maps to wrapped island variables (same as route) for hydration to work", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await writePage(pagesDir, "+layout.ts", `export default null;`);
    const code = await runCodegen();
    const regBlock = code.slice(
      code.indexOf("export const registry"),
      code.indexOf("}", code.indexOf("export const registry")) + 2,
    );
    // Registry must reference the wrapped island variable so renderHydratable can find by identity
    expect(regBlock).toContain("_wrapped");
    expect(regBlock).toMatch(/"index"/);
  });

  it("registry appears before pageRouter in the file", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    const code = await runCodegen();
    expect(code.indexOf("export const registry")).toBeLessThan(
      code.indexOf("export const pageRouter"),
    );
  });

  it("empty pages dir generates an empty registry object", async () => {
    const code = await runCodegen();
    expect(code).toContain("export const registry");
    expect(code).toMatch(/export const registry[^=]*=\s*\{\s*\}/);
  });

  // Route group registry names
  it("route group: (auth)/sign-in.ts → registry key 'sign-in'", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    expect(await runCodegen()).toContain(`"sign-in"`);
  });

  it("route group: (shop)/products/[id].ts → registry key 'products-id'", async () => {
    await writePage(pagesDir, "(shop)/products/[id].ts", `export default null;`);
    expect(await runCodegen()).toContain(`"products-id"`);
  });
});

// ─────────────────────────────────────────────
// codegen — registry name collision detection
// ─────────────────────────────────────────────

describe("codegen — registry name collision", () => {
  let pagesDir: string;
  let outFile: string;
  let root: string;
  let warnings: string[];

  beforeEach(async () => {
    root = await makeDir("namecol");
    pagesDir = join(root, "src/pages");
    outFile = join(root, ".ilha/routes.ts");
    await mkdir(pagesDir, { recursive: true });
    warnings = [];
    console.warn = (...args: any[]) => warnings.push(args.join(" "));
  });

  afterEach(async () => {
    await removeDir(root);
  });

  async function runCodegen() {
    const plugin = pages({ dir: pagesDir, generated: outFile }) as any;
    plugin.configResolved({ root });
    await plugin.buildStart();
    return readFile(outFile, "utf8");
  }

  it("warns on registry name collision", async () => {
    await writePage(pagesDir, "user.ts", `export default null;`);
    await writePage(pagesDir, "user/index.ts", `export default null;`);
    await runCodegen();
    expect(warnings.some((w) => w.includes("Duplicate") || w.includes("collision"))).toBe(true);
  });

  it("does not warn on name collision when all names are unique", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await writePage(pagesDir, "about.ts", `export default null;`);
    await runCodegen();
    expect(warnings.some((w) => w.includes("collision"))).toBe(false);
  });

  it("still generates the file when a name collision exists", async () => {
    await writePage(pagesDir, "user.ts", `export default null;`);
    await writePage(pagesDir, "user/index.ts", `export default null;`);
    const code = await runCodegen();
    expect(code).toContain("export const registry");
  });

  it("route group collision: (auth)/sign-in.ts and sign-in.ts produce same pattern — warns", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    await writePage(pagesDir, "sign-in.ts", `export default null;`);
    await runCodegen();
    expect(warnings.some((w) => w.includes("Duplicate") || w.includes("/sign-in"))).toBe(true);
  });
});

// ─────────────────────────────────────────────
// codegen — route sorting
// ─────────────────────────────────────────────

describe("codegen — route sorting", () => {
  let pagesDir: string;
  let outFile: string;
  let root: string;

  beforeEach(async () => {
    root = await makeDir("sort");
    pagesDir = join(root, "src/pages");
    outFile = join(root, "src/generated/page-routes.ts");
    await mkdir(pagesDir, { recursive: true });
  });

  afterEach(async () => {
    await removeDir(root);
  });

  async function runCodegen() {
    const plugin = pages({ dir: pagesDir, generated: outFile }) as any;
    plugin.configResolved({ root });
    await plugin.buildStart();
    return readFile(outFile, "utf8");
  }

  it("static routes appear before param routes", async () => {
    await writePage(pagesDir, "[id].ts", `export default null;`);
    await writePage(pagesDir, "about.ts", `export default null;`);
    const lines = (await runCodegen()).split("\n").filter((l) => l.includes(".route("));
    const aboutIdx = lines.findIndex((l) => l.includes("about"));
    const paramIdx = lines.findIndex((l) => l.includes(":id"));
    expect(aboutIdx).toBeLessThan(paramIdx);
  });

  it("param routes appear before wildcard routes", async () => {
    await writePage(pagesDir, "[...slug].ts", `export default null;`);
    await writePage(pagesDir, "[id].ts", `export default null;`);
    const lines = (await runCodegen()).split("\n").filter((l) => l.includes(".route("));
    const paramIdx = lines.findIndex((l) => l.includes(":id"));
    const wildcardIdx = lines.findIndex((l) => l.includes("**"));
    expect(paramIdx).toBeLessThan(wildcardIdx);
  });

  it("/ root route appears before all others", async () => {
    await writePage(pagesDir, "[...slug].ts", `export default null;`);
    await writePage(pagesDir, "[id].ts", `export default null;`);
    await writePage(pagesDir, "about.ts", `export default null;`);
    await writePage(pagesDir, "index.ts", `export default null;`);
    const lines = (await runCodegen()).split("\n").filter((l) => l.includes(".route("));
    expect(lines[0]).toContain(`"/"`);
  });

  it("full order: static > param > wildcard", async () => {
    await writePage(pagesDir, "[...slug].ts", `export default null;`);
    await writePage(pagesDir, "[id].ts", `export default null;`);
    await writePage(pagesDir, "about.ts", `export default null;`);
    await writePage(pagesDir, "index.ts", `export default null;`);
    const lines = (await runCodegen()).split("\n").filter((l) => l.includes(".route("));
    const order = lines.map((l) => {
      if (l.includes(`"/"`)) return "root";
      if (l.includes("about")) return "static";
      if (l.includes(":id")) return "param";
      if (l.includes("**")) return "wildcard";
      return "other";
    });
    expect(order).toEqual(["root", "static", "param", "wildcard"]);
  });

  it("route group pages sort correctly alongside non-grouped pages", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    await writePage(pagesDir, "(auth)/[token].ts", `export default null;`);
    await writePage(pagesDir, "about.ts", `export default null;`);
    const lines = (await runCodegen()).split("\n").filter((l) => l.includes(".route("));
    const aboutIdx = lines.findIndex((l) => l.includes("/about"));
    const signInIdx = lines.findIndex((l) => l.includes("/sign-in"));
    const tokenIdx = lines.findIndex((l) => l.includes(":token"));
    // both static routes before the param route
    expect(aboutIdx).toBeLessThan(tokenIdx);
    expect(signInIdx).toBeLessThan(tokenIdx);
  });
});

// ─────────────────────────────────────────────
// codegen — duplicate pattern detection
// ─────────────────────────────────────────────

describe("codegen — duplicate pattern detection", () => {
  let pagesDir: string;
  let outFile: string;
  let root: string;
  let warnings: string[];

  beforeEach(async () => {
    root = await makeDir("dup");
    pagesDir = join(root, "src/pages");
    outFile = join(root, "src/generated/page-routes.ts");
    await mkdir(pagesDir, { recursive: true });
    warnings = [];
    console.warn = (...args: any[]) => warnings.push(args.join(" "));
  });

  afterEach(async () => {
    await removeDir(root);
  });

  async function runCodegen() {
    const plugin = pages({ dir: pagesDir, generated: outFile }) as any;
    plugin.configResolved({ root });
    await plugin.buildStart();
    return readFile(outFile, "utf8");
  }

  it("warns when two files produce the same pattern", async () => {
    await writePage(pagesDir, "user.ts", `export default null;`);
    await writePage(pagesDir, "user/index.ts", `export default null;`);
    await runCodegen();
    expect(warnings.some((w) => w.includes("/user") && w.includes("Duplicate"))).toBe(true);
  });

  it("includes both file paths in the duplicate warning", async () => {
    await writePage(pagesDir, "user.ts", `export default null;`);
    await writePage(pagesDir, "user/index.ts", `export default null;`);
    await runCodegen();
    const warn = warnings.find((w) => w.includes("Duplicate"));
    expect(warn).toContain("user.ts");
    expect(warn).toContain("user/index.ts");
  });

  it("does not warn when all patterns are unique", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await writePage(pagesDir, "about.ts", `export default null;`);
    await runCodegen();
    expect(warnings.some((w) => w.includes("Duplicate"))).toBe(false);
  });

  it("still generates the file when duplicates exist", async () => {
    await writePage(pagesDir, "user.ts", `export default null;`);
    await writePage(pagesDir, "user/index.ts", `export default null;`);
    expect(await runCodegen()).toContain("export const pageRouter");
  });
});

// ─────────────────────────────────────────────
// codegen — empty pages dir warning
// ─────────────────────────────────────────────

describe("codegen — empty pages dir warning", () => {
  let pagesDir: string;
  let outFile: string;
  let root: string;
  let warnings: string[];

  beforeEach(async () => {
    root = await makeDir("empty");
    pagesDir = join(root, "src/pages");
    outFile = join(root, "src/generated/page-routes.ts");
    await mkdir(pagesDir, { recursive: true });
    warnings = [];
    console.warn = (...args: any[]) => warnings.push(args.join(" "));
  });

  afterEach(async () => {
    await removeDir(root);
  });

  async function runCodegen() {
    const plugin = pages({ dir: pagesDir, generated: outFile }) as any;
    plugin.configResolved({ root });
    await plugin.buildStart();
    return readFile(outFile, "utf8");
  }

  it("warns when pages dir is empty", async () => {
    await runCodegen();
    expect(warnings.some((w) => w.includes("No pages found"))).toBe(true);
  });

  it("includes the pages dir path in the warning", async () => {
    await runCodegen();
    expect(warnings.find((w) => w.includes("No pages found"))).toContain(pagesDir);
  });

  it("does not warn when pages dir has at least one page", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await runCodegen();
    expect(warnings.some((w) => w.includes("No pages found"))).toBe(false);
  });

  it("does not warn when pages dir only has +layout.ts / +error.ts", async () => {
    await writePage(pagesDir, "+layout.ts", `export default null;`);
    await writePage(pagesDir, "+error.ts", `export default null;`);
    await runCodegen();
    expect(warnings.some((w) => w.includes("No pages found"))).toBe(true);
  });
});

// ─────────────────────────────────────────────
// codegen — relative imports
// ─────────────────────────────────────────────

describe("codegen — relative imports", () => {
  let pagesDir: string;
  let outFile: string;
  let root: string;

  beforeEach(async () => {
    root = await makeDir("rel");
    pagesDir = join(root, "src/pages");
    outFile = join(root, ".ilha/routes.ts");
    await mkdir(pagesDir, { recursive: true });
  });

  afterEach(async () => {
    await removeDir(root);
  });

  async function runCodegen() {
    const plugin = pages({ dir: pagesDir, generated: outFile }) as any;
    plugin.configResolved({ root });
    await plugin.buildStart();
    return readFile(outFile, "utf8");
  }

  it("page imports start with . or ..", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    const importLines = (await runCodegen())
      .split("\n")
      .filter((l) => l.includes("_page") && l.startsWith("import"));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) expect(line).toMatch(/from ["']\.\.?/);
  });

  it("layout imports start with . or ..", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await writePage(pagesDir, "+layout.ts", `export default null;`);
    const importLines = (await runCodegen())
      .split("\n")
      .filter((l) => l.includes("+layout") && l.startsWith("import"));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) expect(line).toMatch(/from ["']\.\.?/);
  });

  it("no import contains an absolute path", async () => {
    await writePage(pagesDir, "index.ts", `export default null;`);
    await writePage(pagesDir, "+layout.ts", `export default null;`);
    await writePage(pagesDir, "+error.ts", `export default null;`);
    const bad = (await runCodegen())
      .split("\n")
      .filter(
        (l) =>
          l.startsWith("import") &&
          (l.includes("_page") || l.includes("+layout") || l.includes("+error")),
      )
      .filter((l) => !l.includes("./") && !l.includes("../"));
    expect(bad).toHaveLength(0);
  });

  it("route group page imports are relative (no absolute path)", async () => {
    await writePage(pagesDir, "(auth)/sign-in.ts", `export default null;`);
    const importLines = (await runCodegen())
      .split("\n")
      .filter((l) => l.includes("_page") && l.startsWith("import"));
    for (const line of importLines) expect(line).toMatch(/from ["']\.\.?/);
  });
});

// ─────────────────────────────────────────────
// Vite plugin virtual modules
// ─────────────────────────────────────────────

describe("pages — Vite plugin", () => {
  it("resolves ilha:pages virtual id", () => {
    const plugin = pages() as any;
    expect(plugin.resolveId("ilha:pages")).toBe("\0ilha:pages");
  });

  it("resolves ilha:registry virtual id", () => {
    const plugin = pages() as any;
    expect(plugin.resolveId("ilha:registry")).toBe("\0ilha:registry");
  });

  it("returns undefined for unrelated ids", () => {
    const plugin = pages() as any;
    expect(plugin.resolveId("some-other-module")).toBeUndefined();
  });

  it("load for ilha:pages re-exports pageRouter as named export", async () => {
    const root = await makeDir("vite-pages");
    const pagesDir = join(root, "src/pages");
    const outFile = join(root, ".ilha/routes.ts");
    await mkdir(pagesDir, { recursive: true });
    const plugin = pages({ dir: pagesDir, generated: outFile }) as any;
    plugin.configResolved({ root });
    const result = plugin.load("\0ilha:pages");
    expect(result).toContain("routes.ts");
    expect(result).toContain("pageRouter");
    expect(result).toContain("export");
    // must NOT re-export default — named exports only
    expect(result).not.toContain("export default");
    await removeDir(root);
  });

  it("load for ilha:registry re-exports registry as named export", async () => {
    const root = await makeDir("vite-registry");
    const pagesDir = join(root, "src/pages");
    const outFile = join(root, ".ilha/routes.ts");
    await mkdir(pagesDir, { recursive: true });
    const plugin = pages({ dir: pagesDir, generated: outFile }) as any;
    plugin.configResolved({ root });
    const result = plugin.load("\0ilha:registry");
    expect(result).toContain("routes.ts");
    expect(result).toContain("registry");
    expect(result).toContain("export");
    expect(result).not.toContain("export default");
    await removeDir(root);
  });

  it("ilha:pages and ilha:registry both point to the same generated file", async () => {
    const root = await makeDir("vite-same-file");
    const pagesDir = join(root, "src/pages");
    const outFile = join(root, ".ilha/routes.ts");
    await mkdir(pagesDir, { recursive: true });
    const plugin = pages({ dir: pagesDir, generated: outFile }) as any;
    plugin.configResolved({ root });
    const pagesResult = plugin.load("\0ilha:pages");
    const registryResult = plugin.load("\0ilha:registry");
    const fileRef = (s: string) => s.match(/from ['"](.+)['"]/)?.[1];
    expect(fileRef(pagesResult)).toBe(fileRef(registryResult));
    await removeDir(root);
  });

  it("load returns undefined for unrelated ids", () => {
    const plugin = pages() as any;
    expect(plugin.load("something-else")).toBeUndefined();
  });

  it("plugin has correct name", () => {
    expect((pages() as any).name).toBe("ilha:pages");
  });

  it("configResolved sets root-relative paths", async () => {
    const root = await makeDir("cfg");
    const plugin = pages({ dir: "src/pages", generated: "src/generated/routes.ts" }) as any;
    plugin.configResolved({ root });
    await mkdir(join(root, "src/pages"), { recursive: true });
    expect(plugin.buildStart()).resolves.toBeUndefined();
    await removeDir(root);
  });
});
