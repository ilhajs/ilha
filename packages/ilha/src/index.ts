import { signal, effect, setActiveSub, startBatch, endBatch } from "alien-signals";

// ---------------------------------------------
// Standard Schema V1 (inlined, type-only)
// ---------------------------------------------

interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

declare namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: Types<Input, Output> | undefined;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
  }
  type Result<Output> = SuccessResult<Output> | FailureResult;
  interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  interface PathSegment {
    readonly key: PropertyKey;
  }
  interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}

// ---------------------------------------------
// Dev-mode warning helper
// ---------------------------------------------

const __DEV__ = typeof process !== "undefined" ? process.env?.["NODE_ENV"] !== "production" : true;

function warn(msg: string): void {
  if (__DEV__) console.warn(`[ilha] ${msg}`);
}

// ---------------------------------------------
// Simplified morph engine
// ---------------------------------------------

function syncAttributes(from: Element, to: Element): void {
  for (const { name, value } of to.attributes) {
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  }
  for (const { name } of Array.from(from.attributes)) {
    if (!to.hasAttribute(name)) from.removeAttribute(name);
  }
}

function morphChildren(fromParent: Element, toParent: Element): void {
  const fromNodes = Array.from(fromParent.childNodes);
  const toNodes = Array.from(toParent.childNodes);

  for (let i = fromNodes.length - 1; i >= toNodes.length; i--) {
    fromNodes[i]!.remove();
  }

  for (let i = 0; i < toNodes.length; i++) {
    const toNode = toNodes[i]!;
    const fromNode = fromNodes[i];

    if (!fromNode) {
      fromParent.appendChild(toNode.cloneNode(true));
      continue;
    }

    if (fromNode.nodeType !== toNode.nodeType) {
      fromParent.replaceChild(toNode.cloneNode(true), fromNode);
      continue;
    }

    if (fromNode.nodeType === 3 || fromNode.nodeType === 8) {
      if (fromNode.nodeValue !== toNode.nodeValue) {
        fromNode.nodeValue = toNode.nodeValue;
      }
      continue;
    }

    if (fromNode.nodeType === 1) {
      const fromEl = fromNode as Element;
      const toEl = toNode as Element;

      if (fromEl.localName !== toEl.localName || fromEl.namespaceURI !== toEl.namespaceURI) {
        fromParent.replaceChild(toEl.cloneNode(true), fromEl);
        continue;
      }

      if (
        fromEl.localName === "input" &&
        (fromEl as HTMLInputElement).type !== (toEl as HTMLInputElement).type
      ) {
        fromParent.replaceChild(toEl.cloneNode(true), fromEl);
        continue;
      }

      syncAttributes(fromEl, toEl);

      if (fromEl.localName === "textarea") {
        const newText = toEl.textContent ?? "";
        if (fromEl.textContent !== newText) fromEl.textContent = newText;
        (fromEl as HTMLTextAreaElement).value = (fromEl as HTMLTextAreaElement).defaultValue;
      } else {
        morphChildren(fromEl, toEl);
      }
    }
  }
}

function morphInner(from: Element, to: Element): void {
  if (from.localName !== to.localName || from.namespaceURI !== to.namespaceURI)
    throw new Error("[ilha] morph: elements must match");
  morphChildren(from, to);
}

// ---------------------------------------------
// Internal helpers
// ---------------------------------------------

function validateSchema<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
): StandardSchemaV1.InferOutput<S> {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) throw new Error("[ilha] Async schemas are not supported.");
  if (result.issues)
    throw new Error(
      `[ilha] Validation failed:\n${result.issues.map((i) => `  - ${i.message}`).join("\n")}`,
    );
  return result.value as StandardSchemaV1.InferOutput<S>;
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ESC[c]!);
}

function dedentString(str: string): string {
  if (str.length === 0 || str[0] !== "\n") return str;
  const lines = str.split("\n");
  while (lines.length && lines[0]!.trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (!lines.length) return "";
  const indent = Math.min(
    ...lines.filter((l) => l.trim() !== "").map((l) => l.match(/^(\s*)/)![1]!.length),
  );
  return lines.map((l) => l.slice(indent)).join("\n");
}

// ---------------------------------------------
// Symbols & constants
// ---------------------------------------------

const RAW = Symbol("ilha.raw");
const SIGNAL_ACCESSOR = Symbol("ilha.signalAccessor");
const ISLAND = Symbol("ilha.island");
const ISLAND_CALL = Symbol("ilha.islandCall");

const SLOT_ATTR = "data-ilha-slot";
const PROPS_ATTR = "data-ilha-props";
const STATE_ATTR = "data-ilha-state";
const CSS_ATTR = "data-ilha-css";

// ---------------------------------------------
// CSS scoping
// ---------------------------------------------
//
// Wrap the user's CSS in an @scope rule bounded by the island host (upper) and
// any nested island root (lower). This gives us:
//   - Selectors resolved against the host's descendants only
//   - Low-specificity selectors that don't win cascade wars with utilities
//   - A donut hole at every `[data-ilha]` descendant so parent styles don't
//     leak into child islands
//
// The resulting <style> element is emitted as the first child of the host on
// every render. Because it's deterministically the same node on both `from`
// and `to` sides of the morph, `morphChildren` sees a matching <style> and
// leaves it alone — no flicker, no re-parse, no special-case code in the morph.
function buildScopedStyle(css: string): string {
  return `<style ${CSS_ATTR}>@scope (:scope) to ([data-ilha]){${css}}</style>`;
}

export interface RawHtml {
  [RAW]: true;
  value: string;
}

// ---------------------------------------------
// Render-time composition: island interpolation
// ---------------------------------------------
//
// Islands are directly interpolatable inside html``. When interpolateValue sees
// an Island (or an IslandCall, produced by calling an Island as a function or
// via .key()), it:
//   1. Generates a stable slot id — either user-supplied via .key() or
//      positional based on appearance order within the current render frame.
//   2. Records { id -> { island, props } } in the active RenderContext so the
//      parent's mount pass can look it up and mount the child onto the slot.
//   3. Emits <div data-ilha-slot="{id}" data-ilha-props="...">{child SSR}</div>
//      — the data-* attributes let hydration recover props without the map.
//
// Nested islands: each island's renderToString pushes its own RenderContext
// onto the stack, so child-of-child interpolations are scoped to the correct
// parent. The stack is thread-safe because rendering is synchronous (derived
// resolution happens before fn() is called, not during).

interface IslandCall {
  [ISLAND_CALL]: true;
  island: AnyIsland;
  props: Record<string, unknown> | undefined;
  key: string | undefined;
}

interface IslandRenderCtx {
  // Slot id -> island to mount, populated during interpolation.
  slots: Map<string, { island: AnyIsland; props: Record<string, unknown> | undefined }>;
  // Monotonic counter for positional keys (first bare ${Island} = "0", etc.).
  positional: number;
  // When set (client re-render), emitIslandSlot reuses the live child subtree's
  // outerHTML instead of re-running child SSR. This keeps morph from walking
  // into the child and clobbering state-managed DOM.
  liveHost: Element | undefined;
  // When set, emitIslandSlot will attempt async child-island rendering.
  // Populated during SSR when the parent itself is in async mode, so child
  // islands with async derived() can be properly awaited instead of emitting
  // loading markup.
  pending: Map<string, Promise<string>> | undefined;
}

const renderCtxStack: IslandRenderCtx[] = [];

function pushRenderCtx(liveHost?: Element, asyncChildren?: boolean): IslandRenderCtx {
  const ctx: IslandRenderCtx = {
    slots: new Map(),
    positional: 0,
    liveHost,
    pending: asyncChildren ? new Map() : undefined,
  };
  renderCtxStack.push(ctx);
  return ctx;
}

function popRenderCtx(): void {
  renderCtxStack.pop();
}

function currentRenderCtx(): IslandRenderCtx | undefined {
  return renderCtxStack[renderCtxStack.length - 1];
}

function isIsland(v: unknown): v is AnyIsland {
  return typeof v === "function" && ISLAND in (v as object);
}

function isIslandCall(v: unknown): v is IslandCall {
  // IslandCall objects are produced by in-interpolation calls (plain objects);
  // KeyedIsland callables produced by .key() are functions that ALSO carry the
  // ISLAND_CALL brand but need to be invoked (with no props) when interpolated
  // bare. Both paths converge in interpolateValue.
  return (
    (typeof v === "object" || typeof v === "function") && v !== null && ISLAND_CALL in (v as object)
  );
}

// Emit a slot marker for an island at this interpolation site.
// Records the slot in the active render context so mount can find it.
function emitIslandSlot(
  island: AnyIsland,
  props: Record<string, unknown> | undefined,
  key: string | undefined,
): string {
  const ctx = currentRenderCtx();

  // Assign id: user key wins; otherwise use positional index. Keys are
  // prefixed to avoid collision with positional ids in the same render.
  let id: string;
  if (key !== undefined) {
    id = `k:${key}`;
    if (ctx && __DEV__ && ctx.slots.has(id)) {
      warn(
        `Duplicate slot key "${key}" — two children with the same key in a ` +
          `single render will collide. Each .key() call must be unique.`,
      );
    }
  } else {
    id = ctx ? `p:${ctx.positional++}` : "p:0";
  }

  if (ctx) ctx.slots.set(id, { island, props });

  const propsAttr = props ? ` ${PROPS_ATTR}='${escapeHtml(JSON.stringify(props))}'` : "";

  // Client re-render path: emit an EMPTY stub. Post-morph, mountSlots rehomes
  // the preserved live slot element (with all its mounted children, listeners,
  // and state) into the stub's position. The morph therefore never walks into
  // a slot subtree — it just places a stub, and we swap the stub for the real
  // thing afterwards. New (not-yet-mounted) slots stay as stubs and get mounted
  // by mountSlots.
  if (ctx?.liveHost) {
    return `<div ${SLOT_ATTR}="${escapeHtml(id)}"${propsAttr}></div>`;
  }

  // SSR path: render the child's HTML inline.
  //
  // When async child rendering is enabled (ctx.pending is set — the parent
  // itself is in async SSR mode), pop the render context so island(props)
  // invokes renderToString (the SSR path) instead of returning an IslandCall.
  // This allows child islands with async derived() to be properly awaited
  // instead of emitting loading markup.
  if (ctx?.pending) {
    popRenderCtx();
    try {
      const result = island(props as Record<string, unknown>);

      if (result instanceof Promise) {
        // Store the pending render for later resolution by renderWithCtx.
        ctx.pending.set(id, result.then(String));
        // Emit a placeholder stub; resolveAsyncChildren will substitute the
        // resolved inner HTML after all children have been awaited.
        return `<div ${SLOT_ATTR}="${escapeHtml(id)}"${propsAttr}></div>`;
      }

      // Child rendered synchronously — inline its HTML as usual.
      return `<div ${SLOT_ATTR}="${escapeHtml(id)}"${propsAttr}>${result}</div>`;
    } finally {
      renderCtxStack.push(ctx);
    }
  }

  // Sync SSR path (no async children support). The child's renderToString
  // pushes its own render context so grandchildren are scoped correctly.
  const inner = island.toString(props);
  return `<div ${SLOT_ATTR}="${escapeHtml(id)}"${propsAttr}>${inner}</div>`;
}

// After the parent's render function has produced HTML with placeholder stubs
// for async children, await each pending child and substitute its resolved
// HTML into the parent's output. Returns the final HTML string.
async function resolveAsyncChildren(html: string, ctx: IslandRenderCtx): Promise<string> {
  for (const [id, promise] of ctx.pending!) {
    const inner = await promise;
    // The placeholder is an empty stub
    //   <div data-ilha-slot="…" data-ilha-props="…"></div>
    // Replace it with the same tag but containing the resolved inner HTML.
    const escaped = escapeHtml(id);
    // Guard against ReDoS from pathologically long slot ids.
    if (escaped.length > 500) {
      throw new Error(
        `Slot id exceeds safe length for regex replacement (${escaped.length} > 500).`,
      );
    }
    // Build a regex that matches the empty slot div for this id.
    // Pattern: <div ... data-ilha-slot="ESCAPED" ...></div>
    const attrPattern = escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const placeholder = new RegExp(`<div\\s[^>]*${SLOT_ATTR}="${attrPattern}"[^>]*></div>`, "g");
    html = html.replace(placeholder, (match) => {
      // Slice off `></div>` (last 6 chars) and insert inner HTML.
      return match.slice(0, -6) + `>${inner}</div>`;
    });
  }
  return html;
}

// ---------------------------------------------
// Signal accessor
// ---------------------------------------------

interface MarkedSignalAccessor<T> {
  (): T;
  (...args: [value: T]): void;
  [SIGNAL_ACCESSOR]: true;
}

function markSignalAccessor<T>(fn: { (): T; (value: T): void }): MarkedSignalAccessor<T> {
  (fn as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
  return fn as unknown as MarkedSignalAccessor<T>;
}

function isSignalAccessor(v: unknown): v is MarkedSignalAccessor<unknown> {
  return typeof v === "function" && SIGNAL_ACCESSOR in (v as object);
}

// ---------------------------------------------
// Public helpers
// ---------------------------------------------

function ilhaRaw(value: string): RawHtml {
  return { [RAW]: true, value };
}

// Plain passthrough tagged template for CSS. This exists purely for editor
// tooling — it lets authors tag their stylesheets as `css\`…\`` so LSPs and
// Prettier plugins can syntax-highlight and format the contents. No runtime
// magic: the result is just the interpolated string, identical to what you'd
// get from a plain template literal.
function ilhaCss(strings: TemplateStringsArray | string, ...values: (string | number)[]): string {
  if (typeof strings === "string") return strings;
  let result = "";
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) result += String(values[i]);
  }
  return result;
}

// Resolves any interpolated value to an HTML string.
// Arrays are joined with "" — each item is recursively resolved.
// This means string[] is escaped per-item, RawHtml[] is passed through raw,
// and mixed arrays work correctly. No comma-joining ever occurs.
function interpolateValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(interpolateValue).join("");
  if (typeof v === "object" && RAW in (v as object)) return (v as RawHtml).value;
  if (isIslandCall(v)) {
    // A KeyedIsland (e.g. `Item.key("a")`) is a callable branded IslandCall —
    // calling it with no props yields the concrete IslandCall. A plain
    // IslandCall (e.g. `Item({...})`) is already concrete.
    const call = typeof v === "function" ? (v as () => IslandCall)() : v;
    return emitIslandSlot(call.island, call.props, call.key);
  }
  if (isIsland(v)) return emitIslandSlot(v, undefined, undefined);
  if (isSignalAccessor(v)) return escapeHtml(v());
  if (typeof v === "function") return escapeHtml((v as () => unknown)());
  return escapeHtml(v);
}

// html`` now returns RawHtml instead of string so that arrays of html`` results
// (e.g. from .map()) can be passed directly as interpolated values in a parent
// html`` without triggering JS's default Array.toString() comma-joining.
function ilhaHtml(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  let result = "";
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) result += interpolateValue(values[i]);
  }
  return { [RAW]: true, value: dedentString(result) };
}

// Unwrap a RawHtml or plain string to a string — used at render boundaries.
function unwrapHtml(v: string | RawHtml): string {
  return typeof v === "object" && RAW in v ? v.value : v;
}

// ---------------------------------------------
// Context registry
// ---------------------------------------------

type ContextSignal<T> = { (): T; (value: T): void };
const contextRegistry = new Map<string, ContextSignal<unknown>>();

function ilhaContext<T>(key: string, initial: T): ContextSignal<T> {
  if (contextRegistry.has(key)) return contextRegistry.get(key) as ContextSignal<T>;
  const s = signal(initial);
  const accessor = (...args: unknown[]): unknown => {
    if (args.length === 0) return s();
    s(args[0] as T);
  };
  contextRegistry.set(key, accessor as ContextSignal<unknown>);
  return accessor as ContextSignal<T>;
}

// ---------------------------------------------
// Top-level reactive helpers
// ---------------------------------------------

/**
 * Create a free-standing reactive signal that lives outside any island.
 * Useful for sharing state across islands without prop drilling, or for
 * binding form inputs to module-level state via `.bind(selector, signal)`.
 *
 * The returned accessor is a getter when called with no arguments and a
 * setter when called with one. Reading it inside a `.derived()`, `.effect()`,
 * or `.render()` automatically subscribes the surrounding reactive scope —
 * so when the signal changes, dependents re-run as if it were local state.
 */
export function ilhaSignal<T>(initial: T): ExternalSignal<T> {
  const s = signal(initial);
  const accessor = (...args: unknown[]): unknown => {
    if (args.length === 0) return s();
    s(args[0] as T);
  };
  return accessor as ExternalSignal<T>;
}

/**
 * Run `fn` with reactive tracking suspended. Reading signals inside `fn`
 * returns their current value without subscribing the surrounding scope.
 * Use this in effects/deriveds when you want to peek at state without
 * causing a re-run on its changes.
 */
export function untrack<T>(fn: () => T): T {
  const prev = setActiveSub(undefined);
  try {
    return fn();
  } finally {
    setActiveSub(prev);
  }
}

/**
 * Run `fn` as an atomic batch — multiple signal writes inside the callback
 * produce a single propagation pass, so dependents (effects, deriveds,
 * island re-renders) see the final state and run once instead of once per
 * write. Returns whatever `fn` returns.
 *
 * Note: `.on()` handlers and `.effect()` runs are batched implicitly, so
 * you only need this when triggering multiple writes from outside an
 * island (e.g. from a top-level event listener or async callback).
 */
export function batch<T>(fn: () => T): T {
  startBatch();
  try {
    return fn();
  } finally {
    endBatch();
  }
}

// ---------------------------------------------
// Derived
// ---------------------------------------------

export interface DerivedValue<T> {
  loading: boolean;
  value: T | undefined;
  error: Error | undefined;
}

type DerivedFnContext<TInput, TStateMap extends Record<string, unknown>> = {
  state: IslandState<TStateMap>;
  input: TInput;
  signal: AbortSignal;
};

type DerivedFn<TInput, TStateMap extends Record<string, unknown>, V> = (
  ctx: DerivedFnContext<TInput, TStateMap>,
) => V | Promise<V>;

interface DerivedEntry<TInput, TStateMap extends Record<string, unknown>> {
  key: string;
  fn: DerivedFn<TInput, TStateMap, unknown>;
}

export type IslandDerived<TDerivedMap extends Record<string, unknown>> = {
  readonly [K in keyof TDerivedMap]: DerivedValue<TDerivedMap[K]>;
};

function buildDerivedSignals<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
>(
  entries: DerivedEntry<TInput, TStateMap>[],
  state: IslandState<TStateMap>,
  input: TInput,
  derivedSnapshot?: Record<string, DerivedValue<unknown>>,
): { proxy: IslandDerived<TDerivedMap>; stop: () => void } {
  const envelopes = new Map<string, ReturnType<typeof signal<DerivedValue<unknown>>>>();
  const stops: Array<() => void> = [];

  for (const entry of entries) {
    const initialEnvelope: DerivedValue<unknown> = derivedSnapshot?.[entry.key] ?? {
      loading: true,
      value: undefined,
      error: undefined,
    };
    const env = signal<DerivedValue<unknown>>(initialEnvelope);
    envelopes.set(entry.key, env);
    let ac = new AbortController();

    let skipFirst = derivedSnapshot != null && entry.key in derivedSnapshot;

    const stopEffect = effect(() => {
      ac.abort();
      ac = new AbortController();
      const currentAc = ac;
      const result = entry.fn({ state, input, signal: currentAc.signal });

      if (skipFirst) {
        skipFirst = false;
        if (result instanceof Promise) {
          result.catch(() => {
            // Suppress unhandled rejection for the skipped initial run.
            // The snapshot already provides the correct value; we only ran
            // entry.fn to establish reactive subscriptions.
          });
        }
        return;
      }

      if (!(result instanceof Promise)) {
        const prevSub = setActiveSub(undefined);
        env({ loading: false, value: result as unknown, error: undefined });
        setActiveSub(prevSub);
        return;
      }

      const prevSub = setActiveSub(undefined);
      const prevVal = env();
      env({ loading: true, value: prevVal.value, error: undefined });
      setActiveSub(prevSub);

      result
        .then((value) => {
          if (currentAc.signal.aborted) return;
          env({ loading: false, value, error: undefined });
        })
        .catch((err: unknown) => {
          if (currentAc.signal.aborted) return;
          env({
            loading: false,
            value: undefined,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        });
    });

    stops.push(() => {
      stopEffect();
      ac.abort();
    });
  }

  const proxy = new Proxy({} as IslandDerived<TDerivedMap>, {
    get(_, key: string) {
      const env = envelopes.get(key);
      if (!env) return { loading: false, value: undefined, error: undefined };
      return env();
    },
  });

  return { proxy, stop: () => stops.forEach((s) => s()) };
}

// ---------------------------------------------
// Bind
// ---------------------------------------------

export type ExternalSignal<T = unknown> = { (): T; (value: T): void };

interface BindEntry<TStateMap extends Record<string, unknown>> {
  selector: string;
  target: (keyof TStateMap & string) | ExternalSignal;
}

function resolveBindConfig(el: Element): {
  prop: "value" | "checked" | "valueAsNumber";
  event: string;
  read: (el: Element) => unknown;
  write: (el: Element, value: unknown) => void;
} {
  const tag = el.tagName.toLowerCase();
  const type = (el as HTMLInputElement).type?.toLowerCase() ?? "";

  if (tag === "input" && type === "checkbox") {
    return {
      prop: "checked",
      event: "change",
      read: (el) => (el as HTMLInputElement).checked,
      write: (el, v) => ((el as HTMLInputElement).checked = Boolean(v)),
    };
  }
  if (tag === "input" && type === "radio") {
    return {
      prop: "checked",
      event: "change",
      read: (el) => {
        const input = el as HTMLInputElement;
        return input.checked ? input.value : undefined;
      },
      write: (el, v) => {
        (el as HTMLInputElement).checked = String(v ?? "") === (el as HTMLInputElement).value;
      },
    };
  }
  if (tag === "input" && type === "number") {
    return {
      prop: "valueAsNumber",
      event: "input",
      read: (el) => (el as HTMLInputElement).valueAsNumber,
      write: (el, v) => ((el as HTMLInputElement).value = String(v ?? "")),
    };
  }
  return {
    prop: "value",
    event: tag === "select" ? "change" : "input",
    read: (el) => (el as HTMLInputElement).value,
    write: (el, v) => ((el as HTMLInputElement).value = String(v ?? "")),
  };
}

function applyBindings<TStateMap extends Record<string, unknown>>(
  host: Element,
  bindings: BindEntry<TStateMap>[],
  state: IslandState<TStateMap>,
): () => void {
  const cleanups: Array<() => void> = [];
  for (const binding of bindings) {
    const accessor: ExternalSignal =
      typeof binding.target === "function"
        ? binding.target
        : (state[binding.target as keyof TStateMap] as ExternalSignal);

    const targets =
      binding.selector === ""
        ? [host]
        : Array.from(host.querySelectorAll<Element>(binding.selector));

    if (__DEV__ && binding.selector !== "" && targets.length === 0) {
      warn(
        `bind(): selector "${binding.selector}" matched no elements inside the island host. ` +
          `Check that the element exists in your render output.`,
      );
    }

    for (const target of targets) {
      const { event, read, write } = resolveBindConfig(target);
      const isRadio =
        (target as HTMLInputElement).tagName.toLowerCase() === "input" &&
        (target as HTMLInputElement).type?.toLowerCase() === "radio";
      write(target, accessor());

      const listener = () => {
        const raw = read(target);
        if (isRadio && raw === undefined) return;
        const currentVal = accessor();
        let value: unknown;
        if (typeof currentVal === "number") {
          const n = Number(raw);
          value = isNaN(n) ? 0 : n;
        } else if (typeof currentVal === "boolean") {
          value = Boolean(raw);
        } else {
          value = raw;
        }
        (accessor as (v: unknown) => void)(value);
      };

      target.addEventListener(event, listener);
      cleanups.push(() => target.removeEventListener(event, listener));
    }
  }
  return () => cleanups.forEach((c) => c());
}

// ---------------------------------------------
// Core types
// ---------------------------------------------

export type SignalAccessor<T> = MarkedSignalAccessor<T>;

type MergeState<TStateMap extends Record<string, unknown>, K extends string, V> = {
  [P in keyof TStateMap as P extends K ? never : P]-?: TStateMap[P];
} & Record<K, V>;

export type IslandState<TStateMap extends Record<string, unknown>> = {
  readonly [K in keyof TStateMap]-?: SignalAccessor<TStateMap[K]>;
};

// ---------------------------------------------
// Hydratable options
// ---------------------------------------------

export interface HydratableOptions {
  name: string;
  as?: string;
  snapshot?: boolean | { state?: boolean; derived?: boolean };
  skipOnMount?: boolean;
}

// ---------------------------------------------
// Island interface
// ---------------------------------------------

export interface Island<
  TInput = Record<string, unknown>,
  _TStateMap extends Record<string, unknown> = Record<string, unknown>,
> {
  // Top-level call returns SSR HTML. Inside an html`` interpolation the call
  // is intercepted by the render context and produces an IslandCall (a
  // composition marker) instead — but from the caller's perspective the
  // return type is the SSR string union; interpolation handles the rest.
  (props?: Partial<TInput>): string | Promise<string>;
  toString(props?: Partial<TInput>): string;
  mount(host: Element, props?: Partial<TInput>): () => void;
  hydratable(props: Partial<TInput>, options: HydratableOptions): Promise<string>;
  // Create a keyed invocation for use inside html`` list rendering. The key
  // stabilises slot identity across re-renders where positional order is not
  // reliable (e.g. reorderable lists). Keys must be unique within a single
  // parent render.
  key(key: string): KeyedIsland<TInput>;
  [ISLAND]: true;
}

// Returned by Island.key() — a callable that accepts props and produces an
// IslandCall carrying the key through to interpolation.
export interface KeyedIsland<TInput> {
  (props?: Partial<TInput>): IslandCall;
  [ISLAND_CALL]: true;
}

type AnyIsland = Island<any, any>;

type RenderContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
};

type EffectContext<TInput, TStateMap extends Record<string, unknown>> = {
  state: IslandState<TStateMap>;
  input: TInput;
  host: Element;
  /**
   * AbortSignal that aborts when the effect re-runs (because a dependency
   * changed) or when the island unmounts. Pass to `fetch` or check
   * `signal.aborted` after `await` boundaries to bail out of stale work
   * without needing a manual cleanup function.
   */
  signal: AbortSignal;
};

export type OnMountContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<string, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  host: Element;
  hydrated: boolean;
};

export type HandlerContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<string, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  host: Element;
  target: Element;
  event: Event;
  /**
   * AbortSignal that fires when the island unmounts. If the handler's selector
   * was registered with the `:abortable` modifier, the signal is also aborted
   * when the same listener fires again on the same target (giving you free
   * race-cancellation for things like search-as-you-type fetches). Pass this
   * to `fetch`, `AbortController`-aware APIs, or check `signal.aborted`
   * after `await` boundaries to bail out of stale work.
   */
  signal: AbortSignal;
};

// ---------------------------------------------
// .on() event autocomplete types
// ---------------------------------------------

type HTMLEventName = keyof HTMLElementEventMap & string;
type Modifier = "once" | "capture" | "passive" | "abortable";
type WithModifiers<E extends string> =
  | E
  | `${E}:${Modifier}`
  | `${E}:${Modifier}:${Modifier}`
  | `${E}:${Modifier}:${Modifier}:${Modifier}`;

type OnSelectorString =
  | `@${WithModifiers<HTMLEventName>}`
  | `${string}@${WithModifiers<HTMLEventName>}`;

export type HandlerContextFor<
  TInput,
  TStateMap extends Record<string, unknown>,
  TEventName extends string,
  TDerivedMap extends Record<string, unknown> = Record<string, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  host: Element;
  target: TEventName extends keyof HTMLElementEventMap
    ? HTMLElementEventMap[TEventName]["target"] extends Element | null
      ? NonNullable<HTMLElementEventMap[TEventName]["target"]>
      : Element
    : Element;
  event: TEventName extends keyof HTMLElementEventMap ? HTMLElementEventMap[TEventName] : Event;
  /**
   * AbortSignal that fires when the island unmounts. If the handler's selector
   * was registered with the `:abortable` modifier, the signal is also aborted
   * when the same listener fires again on the same target.
   */
  signal: AbortSignal;
};

// ---------------------------------------------
// State init type
// ---------------------------------------------

type StateInit<TInput, V> = V | ((input: TInput) => V);

interface StateEntry<TInput> {
  key: string;
  init: StateInit<TInput, unknown>;
}

// ---------------------------------------------
// Event modifier parsing
// ---------------------------------------------

interface ParsedOn {
  selector: string;
  eventType: string;
  options: AddEventListenerOptions;
  abortable: boolean;
}

function parseOnArgs(selectorOrCombined: string): ParsedOn {
  const atIdx = selectorOrCombined.lastIndexOf("@");
  const selector = atIdx === -1 ? "" : selectorOrCombined.slice(0, atIdx);
  const rawEvent = atIdx === -1 ? selectorOrCombined : selectorOrCombined.slice(atIdx + 1);
  const parts = rawEvent.split(":");
  const eventType = parts[0]!;
  const modifiers = new Set(parts.slice(1));
  return {
    selector,
    eventType,
    options: {
      once: modifiers.has("once"),
      capture: modifiers.has("capture"),
      passive: modifiers.has("passive"),
    },
    abortable: modifiers.has("abortable"),
  };
}

/**
 * Combine multiple AbortSignals into one that aborts when any input aborts.
 * Uses native AbortSignal.any when available, falls back to a manual chain
 * otherwise (for older runtimes).
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (
    typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any ===
    "function"
  ) {
    return (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any(signals);
  }
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort((s as AbortSignal & { reason?: unknown }).reason);
      return controller.signal;
    }
    s.addEventListener(
      "abort",
      () => controller.abort((s as AbortSignal & { reason?: unknown }).reason),
      { once: true },
    );
  }
  return controller.signal;
}

interface OnEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<string, never>,
> {
  selector: string;
  event: string;
  options: AddEventListenerOptions;
  abortable: boolean;
  handler: (ctx: HandlerContext<TInput, TStateMap, TDerivedMap>) => void | Promise<void>;
}

interface EffectEntry<TInput, TStateMap extends Record<string, unknown>> {
  fn: (ctx: EffectContext<TInput, TStateMap>) => (() => void) | void;
}

/** Where the error originated. `"on"` covers sync throws and async rejections
 *  from `.on()` handlers; `"effect"` covers sync throws from `.effect()` runs
 *  (async work spawned inside an effect is not awaited by the runtime). */
export type ErrorSource = "on" | "effect";

export type ErrorContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<string, never>,
> = {
  error: Error;
  source: ErrorSource;
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  host: Element;
};

interface OnErrorEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
> {
  fn: (ctx: ErrorContext<TInput, TStateMap, TDerivedMap>) => void;
}

interface OnMountEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
> {
  fn: (ctx: OnMountContext<TInput, TStateMap, TDerivedMap>) => (() => void) | void;
}

interface TransitionOptions {
  enter?: (host: Element) => Promise<void> | void;
  leave?: (host: Element) => Promise<void> | void;
}

export interface MountOptions {
  root?: Element;
  lazy?: boolean;
}

export interface MountResult {
  unmount: () => void;
}

// ---------------------------------------------
// Builder config
// ---------------------------------------------

interface BuilderConfig<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
> {
  schema: StandardSchemaV1 | null;
  states: StateEntry<TInput>[];
  deriveds: DerivedEntry<TInput, TStateMap>[];
  ons: OnEntry<TInput, TStateMap, TDerivedMap>[];
  effects: EffectEntry<TInput, TStateMap>[];
  onMounts: OnMountEntry<TInput, TStateMap, TDerivedMap>[];
  onErrors: OnErrorEntry<TInput, TStateMap, TDerivedMap>[];
  transition: TransitionOptions | null;
  binds: BindEntry<TStateMap>[];
  css: string | null;
}

// ---------------------------------------------
// Dev-mode: track mounted hosts
// ---------------------------------------------

const _mountedHosts = __DEV__ ? new WeakSet<Element>() : null;

// ---------------------------------------------
// Builder
// ---------------------------------------------

class IlhaBuilder<
  TInput extends Record<string, unknown>,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<string, never>,
> {
  readonly _cfg: BuilderConfig<TInput, TStateMap, TDerivedMap>;

  constructor(cfg: BuilderConfig<TInput, TStateMap, TDerivedMap>) {
    this._cfg = cfg;
  }

  input<T extends Record<string, unknown>>(): IlhaBuilder<
    T,
    Record<string, never>,
    Record<string, never>
  >;
  input<S extends StandardSchemaV1>(
    schema: S,
  ): IlhaBuilder<
    StandardSchemaV1.InferOutput<S> & Record<string, unknown>,
    Record<string, never>,
    Record<string, never>
  >;
  input(schema?: StandardSchemaV1): IlhaBuilder<Record<string, unknown>, Record<string, never>> {
    return new IlhaBuilder({
      schema: schema ?? null,
      states: [],
      deriveds: [],
      ons: [],
      effects: [],
      onMounts: [],
      onErrors: [],
      transition: null,
      binds: [],
      css: null,
    });
  }

  state<V = undefined, K extends string = string>(
    key: K,
    init?: StateInit<TInput, V> | undefined,
  ): IlhaBuilder<TInput, MergeState<TStateMap, K, V>, TDerivedMap> {
    const cfg = this._cfg;
    return new IlhaBuilder({
      ...cfg,
      states: [...cfg.states, { key, init: init as StateInit<TInput, unknown> }],
    } as unknown as BuilderConfig<TInput, MergeState<TStateMap, K, V>, TDerivedMap>);
  }

  derived<K extends string, V>(
    key: K,
    fn: DerivedFn<TInput, TStateMap, V>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap & Record<K, V>> {
    const cfg = this._cfg;
    return new IlhaBuilder({
      ...cfg,
      deriveds: [...cfg.deriveds, { key, fn: fn as DerivedFn<TInput, TStateMap, unknown> }],
    } as unknown as BuilderConfig<TInput, TStateMap, TDerivedMap & Record<K, V>>);
  }

  bind(
    selector: string,
    stateKey: keyof TStateMap & string,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap>;
  bind<T>(
    selector: string,
    externalSignal: ExternalSignal<T>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap>;
  bind(
    selector: string,
    target: (keyof TStateMap & string) | ExternalSignal,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    return new IlhaBuilder({
      ...this._cfg,
      binds: [...this._cfg.binds, { selector, target }],
    });
  }

  on<S extends OnSelectorString>(
    selectorOrCombined: S,
    handler: (
      ctx: S extends `${string}@${infer E}:${string}`
        ? HandlerContextFor<TInput, TStateMap, E, TDerivedMap>
        : S extends `${string}@${infer E}`
          ? HandlerContextFor<TInput, TStateMap, E, TDerivedMap>
          : HandlerContext<TInput, TStateMap, TDerivedMap>,
    ) => void | Promise<void>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap>;
  on(
    selectorOrCombined: string,
    handler: (ctx: HandlerContext<TInput, TStateMap, TDerivedMap>) => void | Promise<void>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap>;
  on(
    selectorOrCombined: string,
    handler: (ctx: HandlerContext<TInput, TStateMap, TDerivedMap>) => void | Promise<void>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    const parsed = parseOnArgs(selectorOrCombined);
    return new IlhaBuilder({
      ...this._cfg,
      ons: [
        ...this._cfg.ons,
        {
          selector: parsed.selector,
          event: parsed.eventType,
          options: parsed.options,
          abortable: parsed.abortable,
          handler: handler as (
            ctx: HandlerContext<TInput, TStateMap, TDerivedMap>,
          ) => void | Promise<void>,
        },
      ],
    });
  }

  effect(
    fn: (ctx: EffectContext<TInput, TStateMap>) => (() => void) | void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    return new IlhaBuilder({ ...this._cfg, effects: [...this._cfg.effects, { fn }] });
  }

  onMount(
    fn: (ctx: OnMountContext<TInput, TStateMap, TDerivedMap>) => (() => void) | void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    return new IlhaBuilder({ ...this._cfg, onMounts: [...this._cfg.onMounts, { fn }] });
  }

  onError(
    fn: (ctx: ErrorContext<TInput, TStateMap, TDerivedMap>) => void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    return new IlhaBuilder({ ...this._cfg, onErrors: [...this._cfg.onErrors, { fn }] });
  }

  transition(opts: TransitionOptions): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    return new IlhaBuilder({ ...this._cfg, transition: opts });
  }

  css(
    strings: TemplateStringsArray | string,
    ...values: (string | number)[]
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    // Accept both tagged-template form and plain-string form. The tagged form
    // is the intended authoring style; plain-string keeps things flexible for
    // users who want to compose CSS externally.
    let source: string;
    if (typeof strings === "string") {
      source = strings;
    } else {
      let result = "";
      for (let i = 0; i < strings.length; i++) {
        result += strings[i];
        if (i < values.length) result += String(values[i]);
      }
      source = result;
    }

    if (__DEV__ && this._cfg.css !== null) {
      warn(
        `css(): called more than once on the same builder chain. ` +
          `The previous stylesheet has been discarded. ` +
          `Compose styles into a single .css() call instead.`,
      );
    }

    return new IlhaBuilder({ ...this._cfg, css: source });
  }

  render(
    fn: (ctx: RenderContext<TInput, TStateMap, TDerivedMap>) => string | RawHtml,
  ): Island<TInput, TStateMap> {
    const {
      schema,
      states,
      deriveds,
      ons,
      effects,
      onMounts,
      onErrors,
      transition,
      binds,
      css: cssSource,
    } = this._cfg;

    const stylePrefix = cssSource != null ? buildScopedStyle(cssSource) : "";

    function resolveInput(props?: Partial<TInput>): TInput {
      const value = props ?? {};
      if (!schema) return value as TInput;
      return validateSchema(schema, value) as TInput;
    }

    // Run fn inside a fresh render context so any interpolated ${Island}
    // records itself into ctx.slots. Returns the rendered HTML plus the
    // collected slot map. When liveHost is supplied (client re-render path),
    // already-mounted child subtrees are reused as-is instead of re-SSR'd.
    //
    // When asyncChildren is true and any child island has async derived(),
    // the returned value is a Promise that resolves once all children have
    // been awaited and their resolved HTML substituted into the parent output.
    function renderWithCtx(
      fn: () => string | RawHtml,
      liveHost?: Element,
    ): { html: string; slots: IslandRenderCtx["slots"] };
    function renderWithCtx(
      fn: () => string | RawHtml,
      liveHost: Element | undefined,
      asyncChildren: true,
    ): Promise<{ html: string; slots: IslandRenderCtx["slots"] }>;
    function renderWithCtx(
      fn: () => string | RawHtml,
      liveHost?: Element,
      asyncChildren?: boolean,
    ):
      | { html: string; slots: IslandRenderCtx["slots"] }
      | Promise<{ html: string; slots: IslandRenderCtx["slots"] }> {
      const ctx = pushRenderCtx(liveHost, asyncChildren);
      let isAsync = false;
      try {
        const html = unwrapHtml(fn());

        if (ctx.pending && ctx.pending.size > 0) {
          isAsync = true;
          // Children with async derived were found — await them and substitute
          // their resolved HTML into the parent output before returning.
          return (async () => {
            try {
              const resolvedHtml = await resolveAsyncChildren(html, ctx);
              return { html: resolvedHtml, slots: ctx.slots };
            } finally {
              popRenderCtx();
            }
          })();
        }

        return { html, slots: ctx.slots };
      } finally {
        if (!isAsync) {
          popRenderCtx();
        }
      }
    }

    function buildPlainState(input: TInput): IslandState<TStateMap> {
      const state: Record<string, unknown> = {};
      for (const entry of states) {
        const value =
          typeof entry.init === "function"
            ? (entry.init as (i: TInput) => unknown)(input)
            : entry.init;
        const accessor = markSignalAccessor((...args: unknown[]): unknown => {
          if (args.length === 0) return value;
        });
        state[entry.key] = accessor as SignalAccessor<unknown>;
      }
      return state as IslandState<TStateMap>;
    }

    function buildSignalState(
      input: TInput,
      snapshot?: Record<string, unknown>,
    ): IslandState<TStateMap> {
      const state: Record<string, unknown> = {};
      for (const entry of states) {
        const initial =
          snapshot && entry.key in snapshot
            ? snapshot[entry.key]
            : typeof entry.init === "function"
              ? (entry.init as (i: TInput) => unknown)(input)
              : entry.init;
        const s = signal(initial);
        const accessor = markSignalAccessor((...args: unknown[]): unknown => {
          if (args.length === 0) return s();
          s(args[0] as typeof initial);
        });
        state[entry.key] = accessor as SignalAccessor<unknown>;
      }
      return state as IslandState<TStateMap>;
    }

    function renderToString(props?: Partial<TInput>, sync = false): string | Promise<string> {
      const input = resolveInput(props);
      const state = buildPlainState(input);

      const results = deriveds.map((entry) => {
        try {
          return {
            key: entry.key,
            result: entry.fn({
              state: state as never,
              input,
              signal: new AbortController().signal,
            }),
          };
        } catch (err) {
          return { key: entry.key, result: Promise.reject(err) };
        }
      });

      const hasAsync = results.some((r) => r.result instanceof Promise);

      if (!hasAsync || sync) {
        const derived: Record<string, DerivedValue<unknown>> = {};
        for (const r of results) {
          if (r.result instanceof Promise) {
            derived[r.key] = { loading: true, value: undefined, error: undefined };
          } else {
            derived[r.key] = { loading: false, value: r.result as unknown, error: undefined };
          }
        }
        const { html } = renderWithCtx(() =>
          fn({ state, derived: derived as IslandDerived<TDerivedMap>, input }),
        );
        return stylePrefix + html;
      }

      return Promise.all(
        results.map(async (r) => {
          try {
            return {
              key: r.key,
              envelope: {
                loading: false,
                value: await Promise.resolve(r.result),
                error: undefined,
              } satisfies DerivedValue<unknown>,
            };
          } catch (err) {
            return {
              key: r.key,
              envelope: {
                loading: false,
                value: undefined,
                error: err instanceof Error ? err : new Error(String(err)),
              } satisfies DerivedValue<unknown>,
            };
          }
        }),
      ).then(async (resolved) => {
        const derived: Record<string, DerivedValue<unknown>> = {};
        for (const r of resolved) derived[r.key] = r.envelope;
        const { html } = await renderWithCtx(
          () => fn({ state, derived: derived as IslandDerived<TDerivedMap>, input }),
          undefined,
          true,
        );
        return stylePrefix + html;
      });
    }

    function mountIsland(host: Element, props?: Partial<TInput>): () => void {
      if (__DEV__ && _mountedHosts) {
        if (_mountedHosts.has(host)) {
          warn(
            `mount(): this element is already mounted. Call the previous unmount() first to avoid ` +
              `memory leaks and duplicate event listeners.\n` +
              `Element: ${host.outerHTML.slice(0, 120)}`,
          );
          return () => {};
        }
        _mountedHosts.add(host);
      }

      if (props === undefined) {
        const rawProps = host.getAttribute(PROPS_ATTR);
        if (rawProps) {
          try {
            props = JSON.parse(rawProps) as Partial<TInput>;
          } catch {
            warn("Failed to parse data-ilha-props — invalid JSON, falling back to empty props.");
          }
        }
      }

      const input = resolveInput(props);

      let snapshotRaw: Record<string, unknown> | undefined;
      const rawState = host.getAttribute(STATE_ATTR);
      if (rawState) {
        try {
          snapshotRaw = JSON.parse(rawState) as Record<string, unknown>;
        } catch {
          warn("Failed to parse data-ilha-state — invalid JSON, snapshot ignored.");
        }
      }

      const stateSnapshot = snapshotRaw
        ? (Object.fromEntries(
            Object.entries(snapshotRaw).filter(([k]) => k !== "_derived" && k !== "_skipOnMount"),
          ) as Record<string, unknown>)
        : undefined;

      const derivedSnapshotRaw = snapshotRaw?._derived as
        | Record<string, DerivedValue<unknown>>
        | undefined;

      let derivedSnapshot: Record<string, DerivedValue<unknown>> | undefined;
      if (derivedSnapshotRaw) {
        derivedSnapshot = {};
        for (const [k, v] of Object.entries(derivedSnapshotRaw)) {
          if (v.error && !(v.error instanceof Error)) {
            derivedSnapshot[k] = { ...v, error: new Error(String(v.error)) };
          } else {
            derivedSnapshot[k] = v;
          }
        }
      }

      const hydrated = snapshotRaw != null;
      const shouldSkipOnMount = hydrated && snapshotRaw?.["_skipOnMount"] === true;
      const state = buildSignalState(input, stateSnapshot);
      const cleanups: Array<() => void> = [];

      // Per-island AbortController. Aborted on unmount so handler signals
      // (and any downstream fetches/awaits) get cancelled cleanly.
      const unmountController = new AbortController();
      cleanups.push(() => unmountController.abort());

      if (transition?.enter) {
        const result = transition.enter(host);
        if (result instanceof Promise) result.catch(console.error);
      }

      const { proxy: derived, stop: stopDerived } = buildDerivedSignals<
        TInput,
        TStateMap,
        TDerivedMap
      >(deriveds as DerivedEntry<TInput, TStateMap>[], state, input, derivedSnapshot);
      cleanups.push(stopDerived);

      // Centralized error sink. Errors thrown by .on() handlers (sync or async)
      // and .effect() runs are routed through here. If any .onError() handlers
      // are registered, they run in declaration order; otherwise we fall back
      // to console.error so errors are never silently swallowed. An error
      // thrown by an onError handler itself is logged (we don't recurse).
      function reportError(err: unknown, source: ErrorSource): void {
        const error = err instanceof Error ? err : new Error(String(err));
        if (onErrors.length === 0) {
          console.error(error);
          return;
        }
        for (const entry of onErrors) {
          try {
            entry.fn({ error, source, state, derived, input, host });
          } catch (handlerErr) {
            console.error(handlerErr);
          }
        }
      }

      // Tracks slots currently mounted into the host: id -> { element, unmount }.
      // mountSlots reconciles this against the fresh slot map from each render.
      // Preservation of identity across re-renders happens in the render effect
      // (detach-before-morph, rehome-after-morph). This function's job is
      // purely: unmount removed slots, mount newly-added ones.
      const mountedSlots = new Map<string, { el: Element; unmount: () => void }>();

      function findSlot(id: string): Element | null {
        // Use CSS.escape when available (DOM environments always have it); fall
        // back to a simple attribute-safe escape for edge environments.
        const escaped =
          typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
        const candidates = host.querySelectorAll(`[${SLOT_ATTR}="${escaped}"]`);
        for (const candidate of candidates) {
          // Walk up from the candidate, ensuring we don't cross a [data-ilha]
          // child-island boundary. If we reach `host`, the slot belongs to us.
          let el: Element | null = candidate;
          while (el && el !== host) {
            if (el.hasAttribute("data-ilha")) break;
            el = el.parentElement;
          }
          if (el === host) return candidate;
        }
        return null;
      }

      function mountSlots(slotMap: IslandRenderCtx["slots"]) {
        // Unmount slots that are no longer present (conditionally removed).
        for (const [id, entry] of mountedSlots) {
          if (!slotMap.has(id)) {
            entry.unmount();
            mountedSlots.delete(id);
          }
        }

        // Mount new slot ids that aren't yet mounted.
        for (const [id, { island: childIsland, props }] of slotMap) {
          if (mountedSlots.has(id)) continue;

          const slotEl = findSlot(id);
          if (!slotEl) continue;

          // Props may have been encoded on the slot element during SSR/hydration
          // (data-ilha-props). Fall back to that if not supplied inline via the
          // slot map. Data-props is preserved as a secondary source for
          // hydration scenarios where the map isn't populated.
          let slotProps = props;
          if (slotProps === undefined) {
            const rawProps = slotEl.getAttribute(PROPS_ATTR) ?? slotEl.getAttribute("data-props");
            if (rawProps) {
              try {
                slotProps = JSON.parse(rawProps) as Record<string, unknown>;
              } catch {
                warn(`Failed to parse props on [${SLOT_ATTR}="${id}"] — invalid JSON ignored.`);
              }
            }
          }

          // Isolate child island mount from any outer subscriber (e.g. the
          // parent's render effect, when mountSlots is called mid-re-render).
          // Without this, the child's pre-effect render call reads its own
          // signals with the parent as active subscriber, subscribing the
          // parent to child-internal state and preventing the child's own
          // render effect from receiving updates.
          const prevSub = setActiveSub(undefined);
          let unmount: () => void;
          try {
            unmount = childIsland.mount(slotEl, slotProps);
          } finally {
            setActiveSub(prevSub);
          }
          mountedSlots.set(id, { el: slotEl, unmount });
        }
      }

      type ListenerEntry = {
        target: Element;
        type: string;
        fn: EventListener;
        options: AddEventListenerOptions;
        entry: OnEntry<TInput, TStateMap, TDerivedMap>;
      };
      const listeners: ListenerEntry[] = [];
      const firedOnce = new Set<OnEntry<TInput, TStateMap, TDerivedMap>>();

      function attachListeners() {
        for (const entry of ons) {
          if (entry.options.once && firedOnce.has(entry)) continue;
          const targets =
            entry.selector === "" ? [host] : Array.from(host.querySelectorAll(entry.selector));

          if (__DEV__ && entry.selector !== "" && targets.length === 0) {
            warn(
              `on(): selector "${entry.selector}" matched no elements at mount time. ` +
                `If the element is rendered later, this is expected — otherwise check your selector.`,
            );
          }

          targets.forEach((listenerTarget) => {
            // Per-(entry, target) "current invocation" controller. Only used
            // when entry.abortable is true; aborts the previous invocation's
            // signal when this listener fires again on the same target so
            // racy async handlers (search-as-you-type, etc.) bail out.
            let currentInvocationController: AbortController | null = null;

            const listener = (event: Event) => {
              if (entry.options.once) {
                firedOnce.add(entry);
                for (const l of listeners.filter((l) => l.entry === entry)) {
                  l.target.removeEventListener(l.type, l.fn, l.options);
                }
                listeners.splice(
                  0,
                  listeners.length,
                  ...listeners.filter((l) => l.entry !== entry),
                );
              }
              const eventTarget = (
                event.target instanceof Element ? event.target : listenerTarget
              ) as Element;

              // Build the signal passed to the handler. Always linked to the
              // unmount signal; if abortable, also linked to a per-invocation
              // controller that we abort on the next fire.
              let handlerSignal: AbortSignal;
              if (entry.abortable) {
                if (currentInvocationController) {
                  currentInvocationController.abort();
                }
                const invocationController = new AbortController();
                currentInvocationController = invocationController;
                handlerSignal = anySignal([unmountController.signal, invocationController.signal]);
              } else {
                handlerSignal = unmountController.signal;
              }

              // Batch the synchronous portion of the handler so multiple
              // state writes propagate as a single update. If the handler
              // returns a promise, the batch ends after the sync portion;
              // post-await writes batch themselves implicitly via signal
              // semantics (or can be wrapped in batch() if needed).
              let result: void | Promise<void>;
              startBatch();
              try {
                result = entry.handler({
                  state,
                  derived,
                  input,
                  host,
                  target: eventTarget,
                  event,
                  signal: handlerSignal,
                });
              } catch (err) {
                reportError(err, "on");
                endBatch();
                return;
              }
              endBatch();
              if (result instanceof Promise) {
                result.catch((err) => {
                  // AbortError is the expected outcome of cancellation —
                  // don't surface it. Anything else is a real handler error.
                  if (err && (err as { name?: string }).name === "AbortError") return;
                  reportError(err, "on");
                });
              }
            };
            const opts = { ...entry.options, once: false };
            listenerTarget.addEventListener(entry.event, listener, opts);
            listeners.push({
              target: listenerTarget,
              type: entry.event,
              fn: listener,
              options: opts,
              entry,
            });
          });
        }
      }

      function detachListeners() {
        for (const l of listeners) l.target.removeEventListener(l.type, l.fn, l.options);
        listeners.length = 0;
      }

      // Initial render. If hydrating over existing SSR output, we still need
      // to walk the render function once to collect the slot map (so mountSlots
      // knows which islands to mount into the existing [data-ilha-slot]
      // elements). In that case we pass the host as liveHost so emitIslandSlot
      // reuses the existing subtrees instead of re-SSR-ing children.
      const hasExistingContent = hydrated && host.childNodes.length > 0;
      const initial = renderWithCtx(
        () => fn({ state, derived, input }),
        hasExistingContent ? host : undefined,
      );
      if (!hasExistingContent) {
        host.innerHTML = stylePrefix + initial.html;
      }
      attachListeners();

      let stopBindings = applyBindings(host, binds as BindEntry<TStateMap>[], state);
      cleanups.push(() => stopBindings());

      mountSlots(initial.slots);
      cleanups.push(() => mountedSlots.forEach((entry) => entry.unmount()));

      if (!shouldSkipOnMount) {
        for (const entry of onMounts) {
          const prevSub = setActiveSub(undefined);
          let userCleanup: (() => void) | void;
          try {
            userCleanup = entry.fn({ state, derived, input, host, hydrated });
          } finally {
            setActiveSub(prevSub);
          }
          if (userCleanup) cleanups.push(userCleanup);
        }
      }

      let initialized = false;
      const stopRender = effect(() => {
        // Re-render produces empty stubs for every child island site (see
        // emitIslandSlot). The full strategy for preserving mounted children
        // across parent re-renders:
        //
        //   1. Render a fresh HTML template with empty slot stubs.
        //   2. In the LIVE host, replace each mounted slot element with an
        //      empty stub (same [data-ilha-slot] attr). The live element is
        //      detached and held in a local map.
        //   3. Morph the stubbed live DOM against the stubbed template. Because
        //      both sides now have structurally identical empty stubs at slot
        //      positions, morph can reorder/match them by position without
        //      walking into the child subtree (which was the source of state
        //      corruption when children reorder).
        //   4. After morph, find each stub by id and replace it with the
        //      preserved live element. Children keep their DOM, listeners,
        //      state, event bindings — untouched.
        //
        // Brand-new slot ids (added in this render) stay as stubs after morph;
        // mountSlots mounts their islands onto them.
        const { html: rendered, slots: newSlotMap } = renderWithCtx(
          () => fn({ state, derived, input }),
          host,
        );
        const html = stylePrefix + rendered;
        if (!initialized) {
          initialized = true;
          return;
        }

        detachListeners();
        stopBindings();

        // Unmount slots that are no longer present BEFORE morphInner mutates
        // the DOM. This ensures unmount hooks (transition.leave, effect
        // cleanups, etc.) execute while the elements are still connected.
        for (const [id, entry] of mountedSlots) {
          if (!newSlotMap.has(id)) {
            entry.unmount();
            mountedSlots.delete(id);
          }
        }

        // Detach preserved slot elements from the live DOM, replacing each
        // with an empty stub that matches what the template emitted.
        const preserved = new Map<string, Element>();
        for (const [id, entry] of mountedSlots) {
          if (!newSlotMap.has(id)) continue;
          if (!entry.el.isConnected) continue;
          const stub = document.createElement("div");
          stub.setAttribute(SLOT_ATTR, id);
          entry.el.replaceWith(stub);
          preserved.set(id, entry.el);
        }

        const tpl = document.createElement("template");
        tpl.innerHTML = `<div>${html}</div>`;
        morphInner(host, tpl.content.firstElementChild as Element);

        // Rehome preserved slots: swap post-morph stubs back to live elements.
        for (const [id, liveEl] of preserved) {
          const stub = findSlot(id);
          if (!stub) continue;
          stub.replaceWith(liveEl);
        }

        attachListeners();
        stopBindings = applyBindings(host, binds as BindEntry<TStateMap>[], state);
        mountSlots(newSlotMap);
      });
      cleanups.push(stopRender);
      cleanups.push(detachListeners);

      for (const entry of effects) {
        let userCleanup: (() => void) | void;
        let runController: AbortController | null = null;
        const stopEffect = effect(() => {
          if (userCleanup) {
            try {
              userCleanup();
            } catch (err) {
              reportError(err, "effect");
            }
            userCleanup = undefined;
          }
          // Abort the previous run's signal so any in-flight async work bails
          // before we kick off the next run. Race-cancel is the default for
          // effects (unlike .on(), which requires :abortable opt-in) because
          // dependency changes invariably make the previous run stale.
          if (runController) runController.abort();
          runController = new AbortController();
          const runSignal = anySignal([unmountController.signal, runController.signal]);
          // Batch writes inside the effect so multiple state mutations in a
          // single run propagate atomically.
          startBatch();
          try {
            userCleanup = entry.fn({ state, input, host, signal: runSignal });
          } catch (err) {
            reportError(err, "effect");
          } finally {
            endBatch();
          }
        });
        cleanups.push(() => {
          stopEffect();
          if (userCleanup) {
            try {
              userCleanup();
            } catch (err) {
              reportError(err, "effect");
            }
          }
          if (runController) runController.abort();
        });
      }

      let tornDown = false;
      return () => {
        if (tornDown) return;
        tornDown = true;
        if (__DEV__ && _mountedHosts) _mountedHosts.delete(host);
        if (transition?.leave) {
          const result = transition.leave(host);
          if (result instanceof Promise) {
            result.then(() => cleanups.forEach((c) => c())).catch(console.error);
            return;
          }
        }
        cleanups.forEach((c) => c());
      };
    }

    /**
     * Dual-mode island invocation:
     * - When called inside an `html` interpolation (i.e. {@link currentRenderCtx}
     *   is active), returns an {@link IslandCall} carrying props to be emitted
     *   as a child slot marker; {@link interpolateValue} consumes this marker.
     * - When called at the top level with no active render context, returns
     *   SSR HTML via {@link renderToString} (backward-compatible public API).
     *
     * The declared return type omits {@link IslandCall} because TypeScript
     * cannot narrow based on runtime stack state.
     */
    const island = function (props?: Partial<TInput>): string | Promise<string> | IslandCall {
      if (currentRenderCtx()) {
        return {
          [ISLAND_CALL]: true,
          island: island as AnyIsland,
          props: props as Record<string, unknown> | undefined,
          key: undefined,
        };
      }
      return renderToString(props);
    } as unknown as Island<TInput, TStateMap>;

    island.toString = (props?: Partial<TInput>) => renderToString(props, true) as string;

    island.mount = (host: Element, props?: Partial<TInput>): (() => void) =>
      mountIsland(host, props);

    // Create a keyed invocation for stable slot identity across re-renders
    // (useful in reorderable lists). Returns a callable that, when given
    // optional props, produces an IslandCall that interpolateValue recognises.
    island.key = (key: string): KeyedIsland<TInput> => {
      if (typeof key !== "string" || key.trim().length === 0) {
        throw new Error("island.key() requires a non-empty string.");
      }
      if (key.includes(":")) {
        throw new Error(`island.key() key cannot contain the slot separator ":" (got "${key}").`);
      }
      const keyed = ((props?: Partial<TInput>): IslandCall => ({
        [ISLAND_CALL]: true,
        island: island as AnyIsland,
        props: props as Record<string, unknown> | undefined,
        key,
      })) as unknown as KeyedIsland<TInput>;
      (keyed as unknown as Record<symbol, boolean>)[ISLAND_CALL] = true;
      return keyed;
    };

    (island as unknown as Record<symbol, boolean>)[ISLAND] = true;

    island.hydratable = async (
      props: Partial<TInput>,
      opts: HydratableOptions,
    ): Promise<string> => {
      const { name, as: tag = "div", snapshot = false, skipOnMount: explicitSkipOnMount } = opts;

      const resolvedProps = props ?? {};
      const inner = await renderToString(resolvedProps);
      const encodedProps = escapeHtml(JSON.stringify(resolvedProps));

      let stateAttr = "";

      if (snapshot !== false) {
        const doState = snapshot === true || (snapshot as { state?: boolean }).state !== false;
        const doDerived =
          snapshot === true || (snapshot as { derived?: boolean }).derived !== false;
        const doSkipOnMount = explicitSkipOnMount ?? (doState || doDerived);

        const snapshotData: Record<string, unknown> = {};
        const input = resolveInput(resolvedProps);
        const plainState = buildPlainState(input);

        if (doState) {
          for (const entry of states) {
            snapshotData[entry.key] = (
              plainState[entry.key as keyof typeof plainState] as () => unknown
            )();
          }
        }

        if (doDerived) {
          const derivedResults: Record<string, unknown> = {};
          for (const entry of deriveds) {
            try {
              const result = await Promise.resolve(
                entry.fn({
                  state: plainState as never,
                  input,
                  signal: new AbortController().signal,
                }),
              );
              derivedResults[entry.key] = { loading: false, value: result, error: undefined };
            } catch (err) {
              derivedResults[entry.key] = {
                loading: false,
                value: undefined,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }
          snapshotData["_derived"] = derivedResults;
        }

        if (doSkipOnMount) snapshotData["_skipOnMount"] = true;

        stateAttr = ` ${STATE_ATTR}='${escapeHtml(JSON.stringify(snapshotData))}'`;
      }

      return `<${tag} data-ilha="${escapeHtml(name)}" ${PROPS_ATTR}='${encodedProps}'${stateAttr}>${inner}</${tag}>`;
    };

    return island;
  }
}

// ---------------------------------------------
// ilha.from
// ---------------------------------------------

function ilhaFrom<TInput, TStateMap extends Record<string, unknown>>(
  selector: string | Element,
  island: Island<TInput, TStateMap>,
  props?: Partial<TInput>,
): (() => void) | null {
  const host = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!host) {
    console.warn(`[ilha] from(): element not found: ${selector}`);
    return null;
  }
  return island.mount(host, props);
}

// ---------------------------------------------
// ilha.mount — auto-discovery
// ---------------------------------------------

type IslandRegistry = Record<string, AnyIsland>;

function mountAll(registry: IslandRegistry, options: MountOptions = {}): MountResult {
  const root = options.root ?? document.body;
  const lazy = options.lazy ?? false;
  const unmounts: Array<() => void> = [];

  function activateEl(host: Element) {
    const name = host.getAttribute("data-ilha");
    if (!name) return;
    const island = registry[name];

    if (!island) {
      warn(
        `mount(): no island registered under the name "${name}". ` +
          `Available names: [${Object.keys(registry).join(", ")}]. ` +
          `Check the data-ilha attribute on the element.`,
      );
      return;
    }

    let props: Record<string, unknown> = {};
    const rawProps = host.getAttribute(PROPS_ATTR);
    if (rawProps) {
      try {
        props = JSON.parse(rawProps) as Record<string, unknown>;
      } catch {
        warn(`Failed to parse ${PROPS_ATTR} on [data-ilha="${name}"] — invalid JSON ignored.`);
      }
    }

    unmounts.push(island.mount(host, props));
  }

  const els = Array.from(root.querySelectorAll("[data-ilha]"));

  if (lazy && typeof IntersectionObserver !== "undefined") {
    let disposed = false;
    const io = new IntersectionObserver((entries) => {
      if (disposed) return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activateEl(entry.target);
          io.unobserve(entry.target);
        }
      }
    });
    els.forEach((el) => io.observe(el));
    unmounts.push(() => {
      disposed = true;
      io.disconnect();
    });
  } else {
    els.forEach(activateEl);
  }

  return { unmount: () => unmounts.forEach((u) => u()) };
}

// ---------------------------------------------
// Default export
// ---------------------------------------------

const EMPTY_CFG: BuilderConfig<
  Record<string, unknown>,
  Record<string, never>,
  Record<string, never>
> = {
  schema: null,
  states: [],
  deriveds: [],
  ons: [],
  effects: [],
  onMounts: [],
  onErrors: [],
  transition: null,
  binds: [],
  css: null,
};

const rootBuilder = new IlhaBuilder(EMPTY_CFG);

const ilha = Object.assign(rootBuilder, {
  html: ilhaHtml,
  raw: ilhaRaw,
  mount: mountAll,
  from: ilhaFrom,
  context: ilhaContext,
  signal: ilhaSignal,
  batch,
  untrack,
});

export const html = ilhaHtml;
export const raw = ilhaRaw;
export const css = ilhaCss;
export const mount = mountAll;
export const from = ilhaFrom;
export const context = ilhaContext;
export { ilhaSignal as signal };
export default ilha;
