import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin, UserConfig } from "vite";
import { resolvePagesDir } from "void/pages";

import { islandsPlugin } from "./plugin-islands";
import { pagesPlugin } from "./plugin-pages";
import type { PrefetchConfig } from "./plugin-pages";

export type { PrefetchConfig } from "./plugin-pages";

export interface VoidIlhaOptions {
  /** Wrap Void Router navigations in `document.startViewTransition`. */
  viewTransitions?: boolean;
  /** Defaults for `<Link prefetch>`. */
  prefetch?: PrefetchConfig;
}

interface PackageJsonFields {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const readJson = (file: string): PackageJsonFields | null => {
  try {
    // SAFETY: package.json is trusted build-time input; only dependency maps are read.
    return JSON.parse(readFileSync(file, "utf-8")) as PackageJsonFields;
  } catch {
    return null;
  }
};

const readDependencyPackageJson = (
  root: string,
  name: string
): PackageJsonFields | null => {
  let dir = root;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) {
      return readJson(candidate);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
};

/**
 * App dependencies built on ilha (a UI library, for example). They must share
 * the app's ilha instance: a second copy breaks context lookup and hydration.
 */
const detectIlhaConsumers = (root: string): string[] => {
  const app = readJson(path.join(root, "package.json"));
  if (!app) {
    return [];
  }
  const names = Object.keys({ ...app.dependencies, ...app.devDependencies });
  return names.filter((name) => {
    if (name === "ilha" || name === "@ilha/void") {
      return false;
    }
    const pkg = readDependencyPackageJson(root, name);
    return (
      pkg !== null &&
      ("ilha" in (pkg.peerDependencies ?? {}) ||
        "ilha" in (pkg.dependencies ?? {}))
    );
  });
};

type NoExternal = NonNullable<NonNullable<UserConfig["ssr"]>["noExternal"]>;

const withNoExternal = (
  existing: NoExternal | undefined,
  names: readonly string[]
): NoExternal => {
  if (existing === true) {
    return true;
  }
  let list: (string | RegExp)[] = [];
  if (Array.isArray(existing)) {
    list = existing;
  } else if (existing !== undefined) {
    list = [existing];
  }
  return [...new Set([...list, ...names])];
};

const configPlugin = (): Plugin => {
  // Root seen by `config`; `configEnvironment` has no root, so it reuses the
  // stored one (falling back to cwd when it somehow runs first).
  let root = process.cwd();
  const singletonExcludes = (): string[] => [
    "ilha",
    "ilha/jsx-runtime",
    "ilha/jsx-dev-runtime",
    "@ilha/void",
    ...detectIlhaConsumers(root),
  ];
  return {
    config(userConfig) {
      root = userConfig.root ? path.resolve(userConfig.root) : process.cwd();
      const singletons = ["ilha", "@ilha/void", ...detectIlhaConsumers(root)];
      const jsx =
        userConfig.oxc === false || userConfig.oxc?.jsx !== undefined
          ? {}
          : {
              oxc: {
                jsx: { importSource: "ilha", runtime: "automatic" as const },
              },
            };
      return {
        ...jsx,
        optimizeDeps: {
          include: [
            "ilha",
            "ilha/jsx-runtime",
            // Dev JSX compiles to jsxDEV. Prebundle the dev runtime too, or it
            // loads a second raw ilha and islands stop hydrating.
            "ilha/jsx-dev-runtime",
          ],
        },
        resolve: { dedupe: singletons },
        ssr: {
          noExternal: withNoExternal(userConfig.ssr?.noExternal, singletons),
        },
      };
    },
    configEnvironment(name) {
      // The client keeps prebundling ilha (see above). Every other
      // environment runs SSR or worker code, where modules must all resolve
      // ilha to the same source file: a prebundled `@ilha/void/server` would
      // inline its own ilha copy next to transformed components reading
      // another, so `atom()` during SSR render throws ILHA001. Excluding the
      // singletons keeps the dep optimizer from ever splitting them.
      if (name === "client") {
        return;
      }
      return { optimizeDeps: { exclude: singletonExcludes() } };
    },
    name: "@ilha/void:config",
  };
};

/**
 * Render Void pages, layouts, and islands with ilha. Add it after
 * `voidPlugin()` in your Vite config.
 */
export const voidIlha = (options: VoidIlhaOptions = {}): Plugin[] => {
  const root = process.cwd();
  const pagesDir = resolvePagesDir(root);
  return [
    configPlugin(),
    pagesPlugin(pagesDir, {
      prefetch: options.prefetch,
      root,
      viewTransitions: options.viewTransitions,
    }),
    islandsPlugin(pagesDir, { root }),
  ];
};
