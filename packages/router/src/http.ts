/**
 * Standalone HTTP response helper for custom server handlers.
 */

import type { SerializedHead } from "./head";

export interface HttpResponseOptions {
  status?: number;
  headers?: HeadersInit;
  /**
   * CSP nonce for inline scripts. When set (and `contentSecurityPolicy` is
   * not), a conservative default CSP is emitted with `'nonce-${nonce}'` for
   * `script-src` — pass the same nonce to head `<script nonce=…>` tags.
   */
  cspNonce?: string;
  /** Full `Content-Security-Policy` string; overrides the nonce-derived default. */
  contentSecurityPolicy?: string;
}

/**
 * Build an HTTP `Response` for SSR output with sensible security headers:
 * `Content-Type: text/html`, `X-Content-Type-Options: nosniff`,
 * `Referrer-Policy`, `Cache-Control: no-store`, and an optional CSP. This is
 * a low-level helper — prefer {@link RouterBuilder.respond} for the full
 * render+head+headers pipeline.
 */
export function httpResponse(body: string | null, options: HttpResponseOptions = {}): Response {
  const headers = new Headers(options.headers);
  if (body != null && !headers.has("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  if (!headers.has("x-content-type-options")) headers.set("x-content-type-options", "nosniff");
  if (!headers.has("referrer-policy")) headers.set("referrer-policy", "no-referrer");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  const csp =
    options.contentSecurityPolicy ??
    (options.cspNonce
      ? `default-src 'self'; script-src 'self' 'nonce-${options.cspNonce}'; ` +
        `style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; ` +
        `base-uri 'self'; frame-ancestors 'self'`
      : undefined);
  if (csp) headers.set("content-security-policy", csp);
  return new Response(body, { status: options.status ?? 200, headers });
}

export const EMPTY_HEAD: SerializedHead = { headTags: "", htmlAttrs: "", bodyAttrs: "" };

/**
 * Options for {@link RouterBuilder.respond}.
 */
