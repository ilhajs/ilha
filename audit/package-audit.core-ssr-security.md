# Security Audit — `packages/ilha` (SSR, serialization, hydration, trust boundaries)

**Scope:** `packages/ilha/src/index.ts` (core), `jsx-runtime.ts`, `internal.ts`, plus `security.test.ts`, `jsx-runtime.test.tsx`, `nesting-stress.test.ts`. Read-only; no files changed.

## Review summary

The core is defensively engineered where it counts. Snapshot/props parsing is hardened at every attribute boundary; HTML escaping is complete for the contexts it targets; the JSX runtime applies attribute-name validation, event-handler stripping, `srcdoc` refusal, and a URL-scheme filter. The gaps I found are context-asymmetries and trust-boundary assumptions rather than a mis-escaped sink.

---

## Findings

### F1 — Medium (both SSR & client): `html`` template path has no URL-scheme filter, unlike the JSX runtime

- **Evidence:** The JSX runtime drops any `href`/`src`/`action`/`formaction`/`cite`/`data`/`poster` whose value fails `isSafeUrl` (blocks `javascript:`, dangerous `data:` subtypes, `vbscript:`, with control-char normalization) — `jsx-runtime.ts:77-85` and `jsx-runtime.ts:244-252`.
- The `html`` template path performs **no** scheme check. The default interpolation simply HTML-escapes: `interpolateValue`→`return escapeHtml(v)`at`index.ts:1410`, reached from the non-bind/non-event branch `result += chunk + interpolateValue(value)`at`index.ts:1740`and`index.ts:1801`.
- **Attack input:** `const x = "javascript:alert(1)"; html`<a href="${x}">click</a>``
- **Resulting sink:** `escapeHtml("javascript:alert(1)")` is a no-op (no `&<>"'`), so the template emits `<a href="javascript:alert(1)">click</a>`. Same output on SSR (`Island.toString`) and on client re-render/morph. Clicking executes in the navigable-to page context.
- **Affected runtime:** both SSR and client render, for every URL attribute interpolated through `html``.
- **Why it matters here specifically:** the project explicitly chose to harden this exact sink in JSX (multiple tests: "blocks javascript: href", "blocks control-char data:text/html src", "drops srcdoc"), so an author reasonably assumes the same default for `html``. The two rendering surfaces give meaningfully different security postures for the same data shape. (`data-props`/`data-ilha-props` attrs are the safe counterpart: an attacker-controlled string prop survives revival as a plain string and stays escaped when the child interpolates it — see Guarantee G2.)
- **Minimum fix:** in `ilhaHtml`, scan the trailing static chunk for a URL attribute name in the currently-open tag (mirror the existing `BIND_PREFIX_RE`/`EVENT_PREFIX_RE` trailing-chunk scanning) and apply the `isSafeUrl` predicate before emitting, dropping the attribute/value for unsafe schemes. Shorter alternative: document explicitly that `html`` URL attributes are **not** scheme-filtered (JSX is the safe path), so the boundary is a stated contract rather than an imputed default.

### F2 — Low (server): capture-invoking user event handlers executes real side effects during every manifest render

- **Evidence:** `captureHandlerActions` at `index.ts:993` invokes the user's forwarding closure with a sentinel event to record `action(...)` calls; called whenever `ctx.manifest === true` (SSR frame renders + nested `ISLAND_SSR_MANIFEST` / `ISLAND_RENDER_STATE` paths). The action SSR branch (`index.ts:3011`+) intercepts the `action()` call but code _around_ it runs: `result = handler(sentinelEvent, sentinelContext)`.
- **Attack/repro stance:** a handler that reads `event` and performs work (e.g. `onclick={() => fetch("/api/x")}`) will run that `fetch` server-side on every frame render. It is author code, and the codebase already flags this in a `ponytail:` comment (handlers must be pure "call one action" thunks). Not directly exploitable by an outside attacker, but a real footgun: side effects around the action call execute on the server repeatedly, with a synthesized event.
- **Affected runtime:** server only.
- **Minimum mitigation:** keep the documented contract ("forwarding closures may only call actions replayable over RPC"); consider static-scanning the closure instead of invoking it (the same `ponytail:` note's stated upgrade path). No urgent change.

### F3 — Low (client, defense-in-depth): `data-ilha-props`/`data-props` RawHtml revival is an implicit trust boundary

- **Evidence:** `reviveSlotProps`/`reviveSlotPropValue` (`index.ts:403-421`) convert any attribute value shaped `{ "__ilha": "raw", "value": "<...>" }` into a `RawHtml` value, which becomes an unescaped raw prop. This is intentional and tested (`nesting-stress.test.ts:187` "revives tagged __ilha raw markers from attr props"). `mountSlots` reads the attribute from the live DOM (`index.ts` mount path: `slotEl.getAttribute(PROPS_ATTR) ?? slotEl.getAttribute("data-props")`).
- **Attack input / repro:** if an attacker can influence a host's `data-ilha-slot`+`data-ilha-props` attribute (e.g. the app reflects untrusted JSON wholesale into a prop, or reflected content lands un-escaped in the page), a value `{"__ilha":"raw","value":"<img onerror=...>"}` is revived to `RawHtml` and rendered unescaped → XSS when the child interpolates it.
- **Affected runtime:** client (hydration/mount).
- **Assessment:** This is the _same trust domain as the rest of the server-issued HTML_ — under normal SSR the attribute is author-generated, JSON-escaped, and only attains the raw marker shape if the author intentionally passed a `raw()` prop. Reaching it requires an already-compromised HTML surface. I record it as a **documented trust boundary**, not an exploitable-by-default bug. `safeParseSnapshot` correctly hardens parsing (size/depth/type/unsafe-keys) but does not — and cannot — authenticate content.
- **Minimum hardening (optional):** scope raw-marker revival to slot ids whose props were authored in the same render (not arbitrary nested attrs), or document in AGENTS.md that `data-ilha-props`/`data-props` attributes are trusted server-authored input.

### F4 — Low (both, footgun): escaping does not neutralize script/style inner contexts

- **Evidence:** `html`` interpolating into a literal `<script>`/`<style>`block only HTML-escapes (F1's`interpolateValue`, `index.ts:1410`). HTML entity escaping is the wrong encoding for JS/CSS data.
- **Attack input:** `html`<script>const x = ${userInput}</script>`` with `userInput = "\";alert(1)//"` → `escapeHtml` leaves `"`/`;` intact → literal JS statement injection. Conversely `</style>` breakout is protected because `<` → `&lt;` breaks the closing tag (style data does not decode entities), so style is the safer side.
- **Affected runtime:** both.
- **Assessment:** author misuse pattern (writing untrusted data into raw script text); the library does not claim any script/style context handling and `raw()` is the only supported raw path. Recorded as a footgun to document, not a defect of the default escaping.

### F5 — Low (correctness, both, not XSS): `hydratable()` serializes full props un-filtered

- **Evidence:** `island.hydratable` emits `PROPS_ATTR}='${escapeHtml(JSON.stringify(resolvedProps))}'` (index.ts hydratable block) using the raw props, unlike the slot path which runs `slotPropsForAttr` (`index.ts:1115` drops functions/symbols/`children`). `JSON.stringify` silently drops function/symbol props.
- **Impact:** a function/`RawHtml`/non-JSON prop is lost in the attribute, so the client-hydrated input differs from the SSR-rendered input → hydration divergence / morph churn, and any RoundRect-divergent state. Not directly an injection vector (revival stays string-typed). Recorded for completeness/minimality of the fix surface.

---

## Correctly-enforced guarantees (no action — verified to avoid false positives)

- **G1 — Complete HTML escaping for its targets.** `escapeHtml` (`index.ts:823`) escapes `& < > " '`. Used for text interpolation (`index.ts:1410`), double-quoted bind reflection (`value="…"`), and single-quoted `data-ilha-props`/`data-ilha-state` attrs (`&`-first escaping prevents entity double-decode breaks). `escapeAttrValue` (`jsx-runtime.ts:255`) handles the injected `data-key`. Tests confirm state/props render `&lt;script&gt;` with no live `<script>`/`<img>`.
- **G2 — Props do not become raw through normal interpolation.** An attacker-controlled **string** prop survives `encodeSlotPropValue`/`reviveSlotProps` as a plain string and stays escaped when the child renders it (security.test.ts "props interpolated through child slots escape HTML"). Only an explicit `raw()`/`{__ilha:"raw"}` shape revives to raw (see F3 — intentional boundary).
- **G3 — JSX URL scheme filter is solid.** `SAFE_URL_RE` (`jsx-runtime.ts:78`) is case-insensitive, strips ASCII control chars (tab/NL/CR/NUL) before testing, and blocks `javascript:`/`vbscript:` plus the script-capable `data:` subtypes (`text/html`, `text/xml`, `application/xhtml+xml`, `image/svg`). Tests cover camelCase aliases (`formAction`), leading whitespace, embedded control chars, and `data:image/svg+xml`. Residual (accepted): non-script `data:` subtypes (`text/plain`, `application/octet-stream`) and `blob:` are allowed, deliberately, for image/content use.
- **G4 — JSX attribute-name hardening.** `SAFE_NAME_RE` drops invalid names; string `on*` spreads are dropped (`jsx-runtime.ts:230-235`); `srcdoc`/`srcDoc` refused outright (`jsx-runtime.ts:259-260`) because entity-escaping can't neutralize it; `__proto__`/`constructor`/`prototype` dropped; style-object serialization rejects `{};<>`/`expression(`/`javascript:` values (`jsx-runtime.ts:153`).
- **G5 — Snapshot/props parse hardening at every boundary.** `safeParseSnapshot` (`index.ts:176`) caps size at 256 KB and depth at 32, requires a plain object, and `stripUnsafeKeys` removes `__proto__`/`constructor`/`prototype` recursively — applied on `data-ilha-props` (host + slot), `data-ilha-state`, and mount-all discovery. JSON.parse has no reviver (no accessor/gadget risk). security.test.ts covers oversized, deep, version-mismatched, non-object/array, and pollution payloads.
- **G6 — Slot tag names validated.** `assertValidSlotTagName` (`index.ts`) restricts `.as()`/`hydratable` `as` to `[a-z][a-z0-9-]*`, so a slot host cannot be `<script>`. Slot ids are HTML-escaped into `data-ilha-slot`; CSS selectors never interpolate the id (only `getAttribute` equality), so no selector injection.
- **G7 — Async slot markers can’t be forged.** `asyncSlotMarker` escapes `id` and embeds `<`-containing comment that escaped interpolations cannot reproduce; substitution is exact-string split/join (`index.ts:1187`).
- **G8 — No dynamic code paths.** No `eval`, `new Function`, or `document.write` anywhere in `src/`.

---

## Residual risks / notes

- F3 (RawHtml attr revival) is the only "trust the attribute" surface; keep it covered by the documented server-authored boundary. Add a note in docs/AGENTS if stricter.
- F2 handler capture is server-side code execution by author design; keep the "pure thunk" contract.
- F4 script-context author misuse should be documented alongside `raw()`.
- Cross-package: `serializeServerManifest` (captured action args → markup) is delegated to `@ilha/router`'s adapter (`internal.ts`); its escaping is out of `packages/ilha` scope but should be audited in that package.

## Acceptance
