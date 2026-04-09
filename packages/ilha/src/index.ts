import { signal, effect, setActiveSub } from "alien-signals";

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
const SLOT_ACCESSOR = Symbol("ilha.slotAccessor");
const SIGNAL_ACCESSOR = Symbol("ilha.signalAccessor");

const SLOT_ATTR = "data-ilha-slot";
const PROPS_ATTR = "data-ilha-props";
const STATE_ATTR = "data-ilha-state";

interface RawHtml {
  [RAW]: true;
  value: string;
}

// ---------------------------------------------
// Slot accessor
// ---------------------------------------------

export interface SlotAccessor<TProps = Record<string, unknown>> {
  (props?: TProps): RawHtml;
  toString(): string;
  [SLOT_ACCESSOR]: true;
}

function makeSlotAccessor(render: (props?: Record<string, unknown>) => string): SlotAccessor<any> {
  const fn = (props?: Record<string, unknown>): RawHtml => ({ [RAW]: true, value: render(props) });
  fn.toString = () => render(undefined);
  (fn as unknown as Record<symbol, boolean>)[SLOT_ACCESSOR] = true;
  return fn as unknown as SlotAccessor;
}

function isSlotAccessor(v: unknown): v is SlotAccessor<any> {
  return typeof v === "function" && SLOT_ACCESSOR in (v as object);
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

// Resolves any interpolated value to an HTML string.
// Arrays are joined with "" — each item is recursively resolved.
// This means string[] is escaped per-item, RawHtml[] is passed through raw,
// and mixed arrays work correctly. No comma-joining ever occurs.
function interpolateValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(interpolateValue).join("");
  if (typeof v === "object" && RAW in (v as object)) return (v as RawHtml).value;
  if (isSlotAccessor(v)) return v.toString();
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
      if (skipFirst) {
        skipFirst = false;
        return;
      }

      ac.abort();
      ac = new AbortController();
      const currentAc = ac;
      const result = entry.fn({ state, input, signal: currentAc.signal });

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

type ExternalSignal<T = unknown> = { (): T; (value: T): void };

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
  (props?: Partial<TInput>): string | Promise<string>;
  toString(props?: Partial<TInput>): string;
  mount(host: Element, props?: Partial<TInput>): () => void;
  hydratable(props: Partial<TInput>, options: HydratableOptions): Promise<string>;
}

type InferIslandInput<T> = T extends Island<infer TInput, any> ? TInput : Record<string, unknown>;
type AnyIsland = Island<any, any>;
type SlotMap = Record<string, AnyIsland>;

type SlotsProxy<TSlots extends SlotMap> = {
  readonly [K in keyof TSlots]: SlotAccessor<Partial<InferIslandInput<TSlots[K]>>>;
};

type RenderContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
  TSlots extends SlotMap,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  slots: SlotsProxy<TSlots>;
};

type EffectContext<TInput, TStateMap extends Record<string, unknown>> = {
  state: IslandState<TStateMap>;
  input: TInput;
  host: Element;
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

export type HandlerContext<TInput, TStateMap extends Record<string, unknown>> = {
  state: IslandState<TStateMap>;
  input: TInput;
  host: Element;
  target: Element;
  event: Event;
};

// ---------------------------------------------
// .on() event autocomplete types
// ---------------------------------------------

type HTMLEventName = keyof HTMLElementEventMap & string;
type Modifier = "once" | "capture" | "passive";
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
> = {
  state: IslandState<TStateMap>;
  input: TInput;
  host: Element;
  target: TEventName extends keyof HTMLElementEventMap
    ? HTMLElementEventMap[TEventName]["target"] extends Element | null
      ? NonNullable<HTMLElementEventMap[TEventName]["target"]>
      : Element
    : Element;
  event: TEventName extends keyof HTMLElementEventMap ? HTMLElementEventMap[TEventName] : Event;
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
  };
}

interface OnEntry<TInput, TStateMap extends Record<string, unknown>> {
  selector: string;
  event: string;
  options: AddEventListenerOptions;
  handler: (ctx: HandlerContext<TInput, TStateMap>) => void | Promise<void>;
}

interface EffectEntry<TInput, TStateMap extends Record<string, unknown>> {
  fn: (ctx: EffectContext<TInput, TStateMap>) => (() => void) | void;
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
  _TSlots extends SlotMap,
> {
  schema: StandardSchemaV1 | null;
  states: StateEntry<TInput>[];
  deriveds: DerivedEntry<TInput, TStateMap>[];
  ons: OnEntry<TInput, TStateMap>[];
  effects: EffectEntry<TInput, TStateMap>[];
  onMounts: OnMountEntry<TInput, TStateMap, TDerivedMap>[];
  slots: Record<string, AnyIsland>;
  transition: TransitionOptions | null;
  binds: BindEntry<TStateMap>[];
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
  TSlots extends SlotMap = Record<string, never>,
> {
  readonly _cfg: BuilderConfig<TInput, TStateMap, TDerivedMap, TSlots>;

  constructor(cfg: BuilderConfig<TInput, TStateMap, TDerivedMap, TSlots>) {
    this._cfg = cfg;
  }

  input<S extends StandardSchemaV1>(
    schema: S,
  ): IlhaBuilder<
    StandardSchemaV1.InferOutput<S> & Record<string, unknown>,
    Record<string, never>,
    Record<string, never>,
    Record<string, never>
  > {
    return new IlhaBuilder({
      schema,
      states: [],
      deriveds: [],
      ons: [],
      effects: [],
      onMounts: [],
      slots: {},
      transition: null,
      binds: [],
    });
  }

  state<V = undefined, K extends string = string>(
    key: K,
    init?: StateInit<TInput, V> | undefined,
  ): IlhaBuilder<TInput, MergeState<TStateMap, K, V>, TDerivedMap, TSlots> {
    const cfg = this._cfg;
    return new IlhaBuilder({
      ...cfg,
      states: [...cfg.states, { key, init: init as StateInit<TInput, unknown> }],
    } as unknown as BuilderConfig<TInput, MergeState<TStateMap, K, V>, TDerivedMap, TSlots>);
  }

  derived<K extends string, V>(
    key: K,
    fn: DerivedFn<TInput, TStateMap, V>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap & Record<K, V>, TSlots> {
    const cfg = this._cfg;
    return new IlhaBuilder({
      ...cfg,
      deriveds: [...cfg.deriveds, { key, fn: fn as DerivedFn<TInput, TStateMap, unknown> }],
    } as unknown as BuilderConfig<TInput, TStateMap, TDerivedMap & Record<K, V>, TSlots>);
  }

  bind(
    selector: string,
    stateKey: keyof TStateMap & string,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots>;
  bind<T>(
    selector: string,
    externalSignal: ExternalSignal<T>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots>;
  bind(
    selector: string,
    target: (keyof TStateMap & string) | ExternalSignal,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots> {
    return new IlhaBuilder({
      ...this._cfg,
      binds: [...this._cfg.binds, { selector, target }],
    });
  }

  on<S extends OnSelectorString>(
    selectorOrCombined: S,
    handler: (
      ctx: S extends `${string}@${infer E}:${string}`
        ? HandlerContextFor<TInput, TStateMap, E>
        : S extends `${string}@${infer E}`
          ? HandlerContextFor<TInput, TStateMap, E>
          : HandlerContext<TInput, TStateMap>,
    ) => void | Promise<void>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots>;
  on(
    selectorOrCombined: string,
    handler: (ctx: HandlerContext<TInput, TStateMap>) => void | Promise<void>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots>;
  on(
    selectorOrCombined: string,
    handler: (ctx: HandlerContext<TInput, TStateMap>) => void | Promise<void>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots> {
    const parsed = parseOnArgs(selectorOrCombined);
    return new IlhaBuilder({
      ...this._cfg,
      ons: [
        ...this._cfg.ons,
        {
          selector: parsed.selector,
          event: parsed.eventType,
          options: parsed.options,
          handler: handler as (ctx: HandlerContext<TInput, TStateMap>) => void | Promise<void>,
        },
      ],
    });
  }

  effect(
    fn: (ctx: EffectContext<TInput, TStateMap>) => (() => void) | void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots> {
    return new IlhaBuilder({ ...this._cfg, effects: [...this._cfg.effects, { fn }] });
  }

  onMount(
    fn: (ctx: OnMountContext<TInput, TStateMap, TDerivedMap>) => (() => void) | void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots> {
    return new IlhaBuilder({ ...this._cfg, onMounts: [...this._cfg.onMounts, { fn }] });
  }

  slot<K extends string, I extends AnyIsland>(
    name: K,
    island: I,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots & Record<K, I>> {
    return new IlhaBuilder({
      ...this._cfg,
      slots: { ...this._cfg.slots, [name]: island },
    } as unknown as BuilderConfig<TInput, TStateMap, TDerivedMap, TSlots & Record<K, I>>);
  }

  transition(opts: TransitionOptions): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots> {
    return new IlhaBuilder({ ...this._cfg, transition: opts });
  }

  render(
    fn: (ctx: RenderContext<TInput, TStateMap, TDerivedMap, TSlots>) => string | RawHtml,
  ): Island<TInput, TStateMap> {
    const {
      schema,
      states,
      deriveds,
      ons,
      effects,
      onMounts,
      slots: slotDefs,
      transition,
      binds,
    } = this._cfg;

    function resolveInput(props?: Partial<TInput>): TInput {
      const value = props ?? {};
      if (!schema) return value as TInput;
      return validateSchema(schema, value) as TInput;
    }

    function makeSlotsProxy(ssr: boolean, host?: Element): SlotsProxy<TSlots> {
      return new Proxy(
        {},
        {
          get(_, prop: string) {
            const name = String(prop);
            if (!slotDefs[name]) return makeSlotAccessor(() => "");
            if (ssr) {
              return makeSlotAccessor((props?: Record<string, unknown>) => {
                const json = props ? ` ${PROPS_ATTR}='${escapeHtml(JSON.stringify(props))}'` : "";
                return `<div ${SLOT_ATTR}="${escapeHtml(name)}"${json}>${slotDefs[name]!.toString(props)}</div>`;
              });
            }
            return makeSlotAccessor((props?: Record<string, unknown>) => {
              const liveSlot = host?.querySelector(`[${SLOT_ATTR}="${escapeHtml(name)}"]`);
              if (liveSlot) return liveSlot.outerHTML;
              const json = props ? ` ${PROPS_ATTR}='${escapeHtml(JSON.stringify(props))}'` : "";
              return `<div ${SLOT_ATTR}="${escapeHtml(name)}"${json}></div>`;
            });
          },
        },
      ) as SlotsProxy<TSlots>;
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
      const slots = makeSlotsProxy(true);

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
        return unwrapHtml(
          fn({ state, derived: derived as IslandDerived<TDerivedMap>, input, slots }),
        );
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
      ).then((resolved) => {
        const derived: Record<string, DerivedValue<unknown>> = {};
        for (const r of resolved) derived[r.key] = r.envelope;
        return unwrapHtml(
          fn({ state, derived: derived as IslandDerived<TDerivedMap>, input, slots }),
        );
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

      const slotCleanups = new Map<string, () => void>();
      const slotEls = new Map<string, Element>();

      function mountSlots() {
        for (const [name, childIsland] of Object.entries(slotDefs)) {
          const slotEl = host.querySelector(`[${SLOT_ATTR}="${name}"]`);
          if (!slotEl) continue;

          if (slotEls.get(name) === slotEl) continue;

          slotEls.set(name, slotEl);
          slotCleanups.get(name)?.();

          let slotProps: Record<string, unknown> | undefined;
          const rawProps = slotEl.getAttribute(PROPS_ATTR) ?? slotEl.getAttribute("data-props");
          if (rawProps) {
            try {
              slotProps = JSON.parse(rawProps) as Record<string, unknown>;
            } catch {
              warn(`Failed to parse props on [${SLOT_ATTR}="${name}"] — invalid JSON ignored.`);
            }
          }

          slotCleanups.set(name, childIsland.mount(slotEl, slotProps));
        }
      }

      type ListenerEntry = {
        target: Element;
        type: string;
        fn: EventListener;
        options: AddEventListenerOptions;
        entry: OnEntry<TInput, TStateMap>;
      };
      const listeners: ListenerEntry[] = [];
      const firedOnce = new Set<OnEntry<TInput, TStateMap>>();

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
              const result = entry.handler({ state, input, host, target: eventTarget, event });
              if (result instanceof Promise) result.catch(console.error);
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

      const slots = makeSlotsProxy(false, host);

      // Skip initial render if hydrating and content already exists from SSR.
      // The effect will handle future updates; we just need to attach listeners
      // to the existing SSR content.
      const hasExistingContent = hydrated && host.childNodes.length > 0;
      if (!hasExistingContent) {
        host.innerHTML = unwrapHtml(fn({ state, derived, input, slots }));
      }
      attachListeners();

      let stopBindings = applyBindings(host, binds as BindEntry<TStateMap>[], state);
      cleanups.push(() => stopBindings());

      mountSlots();
      cleanups.push(() => slotCleanups.forEach((unmount) => unmount()));

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
        const html = unwrapHtml(fn({ state, derived, input, slots }));
        if (!initialized) {
          initialized = true;
          return;
        }

        detachListeners();
        stopBindings();

        const tpl = document.createElement("template");
        tpl.innerHTML = `<div>${html}</div>`;
        morphInner(host, tpl.content.firstElementChild as Element);

        attachListeners();
        stopBindings = applyBindings(host, binds as BindEntry<TStateMap>[], state);
        mountSlots();
      });
      cleanups.push(stopRender);
      cleanups.push(detachListeners);

      for (const entry of effects) {
        let userCleanup: (() => void) | void;
        const stopEffect = effect(() => {
          if (userCleanup) {
            userCleanup();
            userCleanup = undefined;
          }
          userCleanup = entry.fn({ state, input, host });
        });
        cleanups.push(() => {
          stopEffect();
          if (userCleanup) userCleanup();
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

    const island = function (props?: Partial<TInput>): string | Promise<string> {
      return renderToString(props);
    } as Island<TInput, TStateMap>;

    island.toString = (props?: Partial<TInput>) => renderToString(props, true) as string;

    island.mount = (host: Element, props?: Partial<TInput>): (() => void) =>
      mountIsland(host, props);

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
  Record<string, never>,
  Record<string, never>
> = {
  schema: null,
  states: [],
  deriveds: [],
  ons: [],
  effects: [],
  onMounts: [],
  slots: {},
  transition: null,
  binds: [],
};

const rootBuilder = new IlhaBuilder(EMPTY_CFG);

const ilha = Object.assign(rootBuilder, {
  html: ilhaHtml,
  raw: ilhaRaw,
  mount: mountAll,
  from: ilhaFrom,
  context: ilhaContext,
});

export function type<TInput, TOutput = TInput>(
  coerce?: (input: TInput) => TOutput,
): StandardSchemaV1<TInput, TOutput> {
  return {
    "~standard": {
      version: 1,
      vendor: "ilha",
      validate(value: unknown) {
        return {
          value: coerce ? coerce(value as TInput) : (value as TOutput),
        };
      },
    },
  };
}

export const html = ilhaHtml;
export const raw = ilhaRaw;
export const mount = mountAll;
export const from = ilhaFrom;
export const context = ilhaContext;
export default ilha;
