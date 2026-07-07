import { describe, it, expect } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { resolveGeneratedPaths } from "./codegen";
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
  it("resolves ilha:pages/server virtual id", () => {
    const p = plugin();
    expect(p.resolveId("ilha:pages/server")).toBe("\0ilha:pages/server");
  });

  it("resolves ilha:pages/client virtual id", () => {
    const p = plugin();
    expect(p.resolveId("ilha:pages/client")).toBe("\0ilha:pages/client");
  });

  it("returns undefined for unrelated ids", () => {
    const p = plugin();
    expect(p.resolveId("some-other-module")).toBeUndefined();
  });

  it("load for ilha:pages/server re-exports pageRouter and registry", async () => {
    const root = await makeDir("vite-server");
    const pagesDir = join(root, "src/pages");
    const outDir = join(root, ".ilha");
    await mkdir(pagesDir, { recursive: true });
    const p = plugin({ dir: pagesDir, outDir });
    p.configResolved({ root });
    const result = p.load("\0ilha:pages/server");
    const serverSpec = resolveGeneratedPaths(outDir).serverFile.replace(/\.ts$/, "");
    expect(result).toContain(serverSpec);
    expect(result).toContain("pageRouter");
    expect(result).toContain("registry");
    await removeDir(root);
  });

  it("load for ilha:pages/client re-exports pageRouter and registry", async () => {
    const root = await makeDir("vite-client");
    const pagesDir = join(root, "src/pages");
    const outDir = join(root, ".ilha");
    await mkdir(pagesDir, { recursive: true });
    const p = plugin({ dir: pagesDir, outDir });
    p.configResolved({ root });
    const result = p.load("\0ilha:pages/client");
    const clientSpec = resolveGeneratedPaths(outDir).clientFile.replace(/\.ts$/, "");
    expect(result).toContain(clientSpec);
    expect(result).toContain("pageRouter");
    expect(result).toContain("registry");
    await removeDir(root);
  });

  it("server and client load from different generated files", async () => {
    const root = await makeDir("vite-split");
    const pagesDir = join(root, "src/pages");
    const outDir = join(root, ".ilha");
    await mkdir(pagesDir, { recursive: true });
    const p = plugin({ dir: pagesDir, outDir });
    p.configResolved({ root });
    const serverResult = p.load("\0ilha:pages/server");
    const clientResult = p.load("\0ilha:pages/client");
    const fileRef = (s: string | undefined) => s?.match(/from ['"](.+)['"]/)?.[1];
    expect(fileRef(serverResult)).not.toBe(fileRef(clientResult));
    expect(fileRef(serverResult)).toContain("pages.server");
    expect(fileRef(clientResult)).toContain("pages.client");
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
    const p = plugin({ dir: "src/pages", outDir: ".ilha" });
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
    p.configResolved({ root: "/proj" });
    const resolved = p.resolveId("../src/pages/foo.ts?client", "/proj/.ilha/pages.client.ts");
    expect(resolved).toBe("/proj/src/pages/foo.ts?client");
  });

  it("resolveId resolves ../ paths relative to importer", () => {
    const p = plugin();
    p.configResolved({ root: "/proj" });
    const resolved = p.resolveId("../src/pages/index.ts?client", "/proj/.ilha/pages.client.ts");
    expect(resolved).toBe("/proj/src/pages/index.ts?client");
  });

  it("resolveId without ?client suffix is unaffected", () => {
    const p = plugin();
    expect(p.resolveId("./foo.ts", "/proj/.ilha/pages.client.ts")).toBeUndefined();
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
    const outDir = join(root, ".ilha");
    await mkdir(pagesDir, { recursive: true });
    const p = plugin({ dir: pagesDir, outDir });
    p.configResolved({ root });
    const result = p.load("\0ilha:loaders");
    const loadersSpec = resolveGeneratedPaths(outDir).loadersFile.replace(/\.ts$/, "");
    expect(result).toContain(loadersSpec);
    expect(result).toMatch(/import\s+["']/);
    expect(result).not.toContain("export");
    await removeDir(root);
  });

  it("plugin.resolveId returns undefined for unrelated ids", () => {
    const p = plugin();
    expect(p.resolveId("random-module")).toBeUndefined();
  });
});
