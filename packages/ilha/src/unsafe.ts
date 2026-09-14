import { isObject } from "./shared.ts";
import type { UnsafeHtml } from "./types.ts";

/**
 * Mark a string as pre-rendered HTML and paint it without escaping.
 * Use it for markup you built or sanitized yourself — SVG from an external
 * library, Markdown rendered to HTML, embed codes. Never pass untrusted
 * user input: unlike interpolated strings, this content is not escaped and
 * scripts inserted this way do not run, but event attributes and other
 * markup still apply.
 */
export const unsafe = (html: string): UnsafeHtml => ({
  $$ilhaUnsafe: 1,
  html,
});

export const isUnsafeHtml = <T>(x: T): x is T & UnsafeHtml => {
  if (!isObject(x)) {
    return false;
  }
  // SAFETY: $$ilhaUnsafe brand is installed by unsafe() on every raw view.
  return (x as { readonly $$ilhaUnsafe?: unknown }).$$ilhaUnsafe === 1;
};
