import { describe, it, expect } from "bun:test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ilhaPages } from "./plugin";
import { makeDir, removeDir } from "./test-helpers";

function plugin(options: Record<string, string> = {}) {
  return ilhaPages.vite(options) as {
    name: string;
    configResolved(config: { root: string }): void;
    buildStart(): Promise<void>;
    resolveId(id: string, importer?: string): string | undefined;
    load(id: string): string | undefined;
  };
}

// ─────────────────────────────────────────────
// Plugin virtual modules
// ─────────────────────────────────────────────

describe("pages — plugin", () => {
  it("resolves ilha:pages virtual id", () => {
    const p = plugin();
    expect(p.resolveId("ilha:pages")).toBe("\0ilha:pages");
  });

  it("resolves ilha:registry virtual id", () => {
    const p = plugin();
    expect(p.resolveId("ilha:registry")).toBe("\0ilha:registry");
  });

  it("returns undefined for unrelated ids", () => {
    const p = plugin();
    expect(p.resolveId("some-other-module")).toBeUndefined();
  });

  it("load for ilha:pages re-exports pageRouter as named export", async () => {
    const root = await makeDir("vite-pages");
    const pagesDir = join(root, "src/pages");
    const outFile = join(root, ".ilha/routes.ts");
    await mkdir(pagesDir, { recursive: true });
    const p = plugin({ dir: pagesDir, generated: outFile });
    p.configResolved({ root });
    const result = p.load("\0ilha:pages");
    expect(result).toContain(outFile.replace(/\.ts$/, ""));
    expect(result).toContain("pageRouter");
    expect(result).toContain("export");
    expect(result).not.toContain("export default");
    await removeDir(root);
  });

  it("load for ilha:registry re-exports registry as named export", async () => {
    const root = await makeDir("vite-registry");
    const pagesDir = join(root, "src/pages");
    const outFile = join(root, ".ilha/routes.ts");
    await mkdir(pagesDir, { recursive: true });
    const p = plugin({ dir: pagesDir, generated: outFile });
    p.configResolved({ root });
    const result = p.load("\0ilha:registry");
    expect(result).toContain(outFile.replace(/\.ts$/, ""));
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
    const p = plugin({ dir: pagesDir, generated: outFile });
    p.configResolved({ root });
    const pagesResult = p.load("\0ilha:pages");
    const registryResult = p.load("\0ilha:registry");
    const fileRef = (s: string | undefined) => s?.match(/from ['"](.+)['"]/)?.[1];
    expect(fileRef(pagesResult)).toBe(fileRef(registryResult));
    await removeDir(root);
  });

  it("load returns undefined for unrelated ids", () => {
    const p = plugin();
    expect(p.load("something-else")).toBeUndefined();
  });

  it("plugin has correct name", () => {
    expect(plugin().name).toBe("ilha:pages");
  });

  it("configResolved sets root-relative paths", async () => {
    const root = await makeDir("cfg");
    const p = plugin({ dir: "src/pages", generated: "src/generated/routes.ts" });
    p.configResolved({ root });
    await mkdir(join(root, "src/pages"), { recursive: true });
    await expect(p.buildStart()).resolves.toBeUndefined();
    await removeDir(root);
  });
});

// ─────────────────────────────────────────────
// Plugin — ?client virtual module
// ─────────────────────────────────────────────

describe("pages — ?client virtual module", () => {
  it("resolveId returns the id with ?client suffix for a relative ?client import", () => {
    const p = plugin();
    const resolved = p.resolveId("./foo.ts?client", "/proj/.ilha/routes.ts");
    expect(resolved).toBe("/proj/.ilha/foo.ts?client");
  });

  it("resolveId resolves ../ paths relative to importer", () => {
    const p = plugin();
    const resolved = p.resolveId("../src/pages/index.ts?client", "/proj/.ilha/routes.ts");
    expect(resolved).toBe("/proj/src/pages/index.ts?client");
  });

  it("resolveId without ?client suffix is unaffected", () => {
    const p = plugin();
    expect(p.resolveId("./foo.ts", "/proj/.ilha/routes.ts")).toBeUndefined();
  });

  it("load(?client) emits `export { default }` from the bare path", () => {
    const p = plugin();
    const result = p.load("/proj/src/pages/index.ts?client");
    expect(result).toContain("export { default }");
    expect(result).toContain(`"/proj/src/pages/index.ts"`);
    expect(result).not.toContain("load");
  });

  it("load(?client) result does not re-export non-default symbols", () => {
    const p = plugin();
    const result = p.load("/abs/path.ts?client");
    expect(result).toMatch(/export\s*\{\s*default\s*\}/);
    expect(result).not.toContain("*");
  });
});

// ─────────────────────────────────────────────
// Plugin — ilha:loaders virtual module
// ─────────────────────────────────────────────

describe("pages — ilha:loaders virtual module", () => {
  it("resolves ilha:loaders virtual id", () => {
    const p = plugin();
    expect(p.resolveId("ilha:loaders")).toBe("\0ilha:loaders");
  });

  it("load for ilha:loaders imports the generated loaders file for side effects", async () => {
    const root = await makeDir("loaders-virt");
    const pagesDir = join(root, "src/pages");
    const outFile = join(root, ".ilha/routes.ts");
    await mkdir(pagesDir, { recursive: true });
    const p = plugin({ dir: pagesDir, generated: outFile });
    p.configResolved({ root });
    const result = p.load("\0ilha:loaders");
    const loadersFile = join(dirname(outFile), "loaders.ts");
    expect(result).toContain(loadersFile.replace(/\.ts$/, ""));
    expect(result).toMatch(/import\s+["']/);
    expect(result).not.toContain("export");
    await removeDir(root);
  });

  it("plugin.resolveId returns undefined for unrelated ids", () => {
    const p = plugin();
    expect(p.resolveId("random-module")).toBeUndefined();
  });
});
