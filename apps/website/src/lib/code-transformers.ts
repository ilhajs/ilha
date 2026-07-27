import { defaultCodeTransformers } from "@cloudflare/nimbus-docs";
import { rendererRich, transformerTwoslash } from "@shikijs/twoslash";
import type { ShikiTransformer } from "@shikijs/types";

/**
 * Twoslash only runs on fences with a `twoslash` meta tag
 * (e.g. ```ts twoslash / ```tsx twoslash).
 *
 * MDX fences: `astro.config.ts` appends `twoslashTransformer` after Nimbus
 * (Astro concatenates transformer arrays — never re-append the full chain).
 * `<Code>`: use `docsCodeTransformers()` so Twoslash sits in
 * `beforeTitleTransformers` of a single Nimbus chain.
 */
export const twoslashTransformer = transformerTwoslash({
  explicitTrigger: true,
  // Docs samples are often incomplete; still enhance the ones that typecheck.
  throws: false,
  renderer: rendererRich(),
  twoslashOptions: {
    compilerOptions: {
      // Match apps/website/tsconfig.json so JSX samples typecheck.
      jsx: 4 /* ReactJSX */,
      jsxImportSource: "ilha",
      module: 99 /* ESNext */,
      moduleResolution: 100 /* Bundler */,
      target: 99 /* ESNext */,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  },
}) as ShikiTransformer;

export function docsCodeTransformers(
  extra: ShikiTransformer[] = [],
  options: { classTokens?: boolean } = {},
): ShikiTransformer[] {
  return defaultCodeTransformers({
    classTokens: options.classTokens ?? true,
    beforeTitleTransformers: [twoslashTransformer, ...extra],
  });
}
