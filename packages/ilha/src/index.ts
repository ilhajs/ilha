import { signal, effect, setActiveSub } from "alien-signals";

// ─────────────────────────────────────────────
// Standard Schema V1 (inlined, type-only)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

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

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dedentString(str: string): string {
  const lines = str.split("\n");
  while (lines.length && lines[0]!.trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (!lines.length) return "";
  const indent = Math.min(
    ...lines.filter((l) => l.trim() !== "").map((l) => l.match(/^(\s*)/)![1]!.length),
  );
  return lines.map((l) => l.slice(indent)).join("\n");
}

// ─────────────────────────────────────────────
// Symbols & constants
// ─────────────────────────────────────────────

const RAW = Symbol("ilha.raw");
const SLOT_ACCESSOR = Symbol("ilha.slotAccessor");
const SIGNAL_ACCESSOR = Symbol("ilha.signalAccessor");

const SLOT_ATTR = "data-ilha-slot";
const SLOT_PROPS_ATTR = "data-ilha-props";
const STATE_ATTR = "data-ilha-state";

interface RawHtml {
  [RAW]: true;
  value: string;
}

// ─────────────────────────────────────────────
// Slot accessor
// ─────────────────────────────────────────────

export interface SlotAccessor {
  (props?: Record<string, unknown>): RawHtml;
  toString(): string;
  [SLOT_ACCESSOR]: true;
}

function makeSlotAccessor(render: (props?: Record<string, unknown>) => string): SlotAccessor {
  const fn = (props?: Record<string, unknown>): RawHtml => ({ [RAW]: true, value: render(props) });
  fn.toString = () => render(undefined);
  (fn as unknown as Record<symbol, boolean>)[SLOT_ACCESSOR] = true;
  return fn as unknown as SlotAccessor;
}

function isSlotAccessor(v: unknown): v is SlotAccessor {
  return typeof v === "function" && SLOT_ACCESSOR in (v as object);
}

// ─────────────────────────────────────────────
// Signal accessor
//
// Uses (...args: [value: T]): void for the setter to prevent TS from
// intersecting the two call signatures into (value: never): void
// when T contains undefined.
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────

function ilhaRaw(value: string): RawHtml {
  return { [RAW]: true, value };
}

function ilhaHtml(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = "";
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v == null) continue;
      if (typeof v === "object" && RAW in (v as object)) {
        result += (v as RawHtml).value;
      } else if (isSlotAccessor(v)) {
        result += v.toString();
      } else if (isSignalAccessor(v)) {
        result += escapeHtml(v());
      } else if (typeof v === "function") {
        result += escapeHtml((v as () => unknown)());
      } else {
        result += escapeHtml(v);
      }
    }
  }
  return dedentString(result);
}

// ─────────────────────────────────────────────
// Context registry
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Derived
// ─────────────────────────────────────────────

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

function makePlainDerived<TDerivedMap extends Record<string, unknown>>(
  entries: DerivedEntry<unknown, Record<string, unknown>>[],
  state: Record<string, unknown>,
  input: unknown,
): IslandDerived<TDerivedMap> {
  const derived: Record<string, DerivedValue<unknown>> = {};
  for (const entry of entries) {
    const result = entry.fn({ state: state as never, input, signal: new AbortController().signal });
    if (result instanceof Promise) {
      derived[entry.key] = { loading: true, value: undefined, error: undefined };
    } else {
      derived[entry.key] = { loading: false, value: result, error: undefined };
    }
  }
  return derived as IslandDerived<TDerivedMap>;
}

function buildDerivedSignals<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
>(
  entries: DerivedEntry<TInput, TStateMap>[],
  state: IslandState<TStateMap>,
  input: TInput,
): { proxy: IslandDerived<TDerivedMap>; stop: () => void } {
  const envelopes = new Map<string, ReturnType<typeof signal<DerivedValue<unknown>>>>();
  const stops: Array<() => void> = [];

  for (const entry of entries) {
    const env = signal<DerivedValue<unknown>>({
      loading: true,
      value: undefined,
      error: undefined,
    });
    envelopes.set(entry.key, env);
    let ac = new AbortController();

    const stopEffect = effect(() => {
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

// ─────────────────────────────────────────────
// Bind
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────

export type SignalAccessor<T> = MarkedSignalAccessor<T>;

// MergeState: homomorphic remap that drops K and adds Record<K, V>.
// -?: strips any optionality inherited from TStateMap so the resulting
// IslandState properties are always required (never T | undefined at the
// property level — undefined lives inside T when desired).
// V is NOT widened here; the caller controls whether V includes undefined.
type MergeState<TStateMap extends Record<string, unknown>, K extends string, V> = {
  [P in keyof TStateMap as P extends K ? never : P]-?: TStateMap[P];
} & Record<K, V>;

export type IslandState<TStateMap extends Record<string, unknown>> = {
  readonly [K in keyof TStateMap]-?: SignalAccessor<TStateMap[K]>;
};

export interface Island<
  TInput = Record<string, unknown>,
  _TStateMap extends Record<string, unknown> = Record<string, unknown>,
> {
  (props?: Partial<TInput>): string | Promise<string>;
  toString(props?: Partial<TInput>): string;
  mount(host: Element, props?: Partial<TInput>): () => void;
}

type AnyIsland = Island<Record<string, unknown>, Record<string, unknown>>;
type SlotMap = Record<string, AnyIsland>;

type SlotsProxy<TSlots extends SlotMap> = {
  readonly [K in keyof TSlots]: SlotAccessor;
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

export type OnMountContext<TInput, TStateMap extends Record<string, unknown>> = {
  state: IslandState<TStateMap>;
  input: TInput;
  host: Element;
};

export type HandlerContext<TInput, TStateMap extends Record<string, unknown>> = {
  state: IslandState<TStateMap>;
  input: TInput;
  host: Element;
  target: Element;
  event: Event;
};

// ─────────────────────────────────────────────
// .on() event autocomplete types
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// State init type
// ─────────────────────────────────────────────

type StateInit<TInput, V> = V | ((input: TInput) => V);

interface StateEntry<TInput> {
  key: string;
  init: StateInit<TInput, unknown>;
}

// ─────────────────────────────────────────────
// Event modifier parsing
// ─────────────────────────────────────────────

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

interface OnMountEntry<TInput, TStateMap extends Record<string, unknown>> {
  fn: (ctx: OnMountContext<TInput, TStateMap>) => (() => void) | void;
}

interface TransitionOptions {
  enter?: (host: Element) => Promise<void> | void;
  leave?: (host: Element) => Promise<void> | void;
}

export interface MountOptions {
  root?: Element;
  hydrate?: boolean;
  lazy?: boolean;
}

export interface MountResult {
  unmount: () => void;
}

// ─────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────

class IlhaBuilder<
  TInput extends Record<string, unknown>,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<string, never>,
  TSlots extends SlotMap = Record<string, never>,
> {
  readonly _schema: StandardSchemaV1 | null;
  readonly _states: StateEntry<TInput>[];
  readonly _deriveds: DerivedEntry<TInput, TStateMap>[];
  readonly _ons: OnEntry<TInput, TStateMap>[];
  readonly _effects: EffectEntry<TInput, TStateMap>[];
  readonly _onMounts: OnMountEntry<TInput, TStateMap>[];
  readonly _slots: Record<string, AnyIsland>;
  readonly _transition: TransitionOptions | null;
  readonly _binds: BindEntry<TStateMap>[];

  constructor(
    schema: StandardSchemaV1 | null,
    states: StateEntry<TInput>[],
    deriveds: DerivedEntry<TInput, TStateMap>[],
    ons: OnEntry<TInput, TStateMap>[],
    effects: EffectEntry<TInput, TStateMap>[],
    onMounts: OnMountEntry<TInput, TStateMap>[],
    slots: Record<string, AnyIsland>,
    transition: TransitionOptions | null,
    binds: BindEntry<TStateMap>[],
  ) {
    this._schema = schema;
    this._states = states;
    this._deriveds = deriveds;
    this._ons = ons;
    this._effects = effects;
    this._onMounts = onMounts;
    this._slots = slots;
    this._transition = transition;
    this._binds = binds;
  }

  input<S extends StandardSchemaV1>(
    schema: S,
  ): IlhaBuilder<
    StandardSchemaV1.InferOutput<S> & Record<string, unknown>,
    Record<string, never>,
    Record<string, never>,
    Record<string, never>
  > {
    return new IlhaBuilder<
      StandardSchemaV1.InferOutput<S> & Record<string, unknown>,
      Record<string, never>,
      Record<string, never>,
      Record<string, never>
    >(schema, [], [], [], [], [], {}, null, []);
  }

  // V = undefined default means omitting init gives SignalAccessor<undefined>.
  // V is stored as-is in MergeState — callers include | undefined in V when needed:
  //   .state<any>("editor", undefined)            → SignalAccessor<any>
  //   .state<Foo | undefined>("editor")           → SignalAccessor<Foo | undefined>
  //   .state("count", 0)                          → SignalAccessor<number>
  //   .state<"a"|"b">("tab", "a")                 → SignalAccessor<"a"|"b">
  state<V = undefined, K extends string = string>(
    key: K,
    init?: StateInit<TInput, V> | undefined,
  ): IlhaBuilder<TInput, MergeState<TStateMap, K, V>, TDerivedMap, TSlots> {
    return new IlhaBuilder<TInput, MergeState<TStateMap, K, V>, TDerivedMap, TSlots>(
      this._schema,
      [...this._states, { key, init: init as StateInit<TInput, unknown> }],
      this._deriveds as unknown as DerivedEntry<TInput, MergeState<TStateMap, K, V>>[],
      this._ons as unknown as OnEntry<TInput, MergeState<TStateMap, K, V>>[],
      this._effects as unknown as EffectEntry<TInput, MergeState<TStateMap, K, V>>[],
      this._onMounts as unknown as OnMountEntry<TInput, MergeState<TStateMap, K, V>>[],
      this._slots,
      this._transition,
      this._binds as unknown as BindEntry<MergeState<TStateMap, K, V>>[],
    );
  }

  derived<K extends string, V>(
    key: K,
    fn: DerivedFn<TInput, TStateMap, V>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap & Record<K, V>, TSlots> {
    return new IlhaBuilder<TInput, TStateMap, TDerivedMap & Record<K, V>, TSlots>(
      this._schema,
      this._states,
      [...this._deriveds, { key, fn: fn as DerivedFn<TInput, TStateMap, unknown> }],
      this._ons,
      this._effects,
      this._onMounts,
      this._slots,
      this._transition,
      this._binds,
    );
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
    return new IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots>(
      this._schema,
      this._states,
      this._deriveds,
      this._ons,
      this._effects,
      this._onMounts,
      this._slots,
      this._transition,
      [...this._binds, { selector, target }],
    );
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
    return new IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots>(
      this._schema,
      this._states,
      this._deriveds,
      [
        ...this._ons,
        {
          selector: parsed.selector,
          event: parsed.eventType,
          options: parsed.options,
          handler: handler as (ctx: HandlerContext<TInput, TStateMap>) => void | Promise<void>,
        },
      ],
      this._effects,
      this._onMounts,
      this._slots,
      this._transition,
      this._binds,
    );
  }

  effect(
    fn: (ctx: EffectContext<TInput, TStateMap>) => (() => void) | void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots> {
    return new IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots>(
      this._schema,
      this._states,
      this._deriveds,
      this._ons,
      [...this._effects, { fn }],
      this._onMounts,
      this._slots,
      this._transition,
      this._binds,
    );
  }

  onMount(
    fn: (ctx: OnMountContext<TInput, TStateMap>) => (() => void) | void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots> {
    return new IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots>(
      this._schema,
      this._states,
      this._deriveds,
      this._ons,
      this._effects,
      [...this._onMounts, { fn }],
      this._slots,
      this._transition,
      this._binds,
    );
  }

  slot<K extends string>(
    name: K,
    island: AnyIsland,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots & Record<K, AnyIsland>> {
    return new IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots & Record<K, AnyIsland>>(
      this._schema,
      this._states,
      this._deriveds,
      this._ons,
      this._effects,
      this._onMounts,
      { ...this._slots, [name]: island },
      this._transition,
      this._binds,
    );
  }

  transition(opts: TransitionOptions): IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots> {
    return new IlhaBuilder<TInput, TStateMap, TDerivedMap, TSlots>(
      this._schema,
      this._states,
      this._deriveds,
      this._ons,
      this._effects,
      this._onMounts,
      this._slots,
      opts,
      this._binds,
    );
  }

  render(
    fn: (ctx: RenderContext<TInput, TStateMap, TDerivedMap, TSlots>) => string,
  ): Island<TInput, TStateMap> {
    const schema = this._schema;
    const states = this._states;
    const deriveds = this._deriveds;
    const ons = this._ons;
    const effects = this._effects;
    const onMounts = this._onMounts;
    const slotDefs = this._slots;
    const transition = this._transition;
    const binds = this._binds;

    function resolveInput(props?: Partial<TInput>): TInput {
      const value = props ?? {};
      if (!schema) return value as TInput;
      return validateSchema(schema, value) as TInput;
    }

    function makeSlotsProxy(ssr: boolean): SlotsProxy<TSlots> {
      return new Proxy(
        {},
        {
          get(_, prop: string) {
            const name = String(prop);
            if (!slotDefs[name]) return makeSlotAccessor(() => "");
            if (ssr) {
              return makeSlotAccessor((props?: Record<string, unknown>) =>
                slotDefs[name]!.toString(props),
              );
            }
            return makeSlotAccessor((props?: Record<string, unknown>) => {
              const json = props ? ` data-props='${escapeHtml(JSON.stringify(props))}'` : "";
              return `<div data-ilha-slot="${escapeHtml(name)}"${json}></div>`;
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

    function renderToString(props?: Partial<TInput>): string | Promise<string> {
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

      if (!hasAsync) {
        const derived: Record<string, DerivedValue<unknown>> = {};
        for (const r of results)
          derived[r.key] = { loading: false, value: r.result as unknown, error: undefined };
        return fn({ state, derived: derived as IslandDerived<TDerivedMap>, input, slots });
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
        return fn({ state, derived: derived as IslandDerived<TDerivedMap>, input, slots });
      });
    }

    function renderToStringSyncOnly(props?: Partial<TInput>): string {
      const input = resolveInput(props);
      const state = buildPlainState(input);
      const slots = makeSlotsProxy(true);
      const derived = makePlainDerived<TDerivedMap>(
        deriveds as DerivedEntry<unknown, Record<string, unknown>>[],
        state as unknown as Record<string, unknown>,
        input,
      );
      return fn({ state, derived, input, slots });
    }

    function mountIsland(host: Element, props?: Partial<TInput>): () => void {
      const input = resolveInput(props);

      let snapshot: Record<string, unknown> | undefined;
      const rawState = host.getAttribute(STATE_ATTR);
      if (rawState) {
        try {
          snapshot = JSON.parse(rawState) as Record<string, unknown>;
        } catch {
          console.warn("[ilha] Failed to parse data-ilha-state");
        }
      }

      const state = buildSignalState(input, snapshot);
      const cleanups: Array<() => void> = [];

      if (transition?.enter) {
        const result = transition.enter(host);
        if (result instanceof Promise) result.catch(console.error);
      }

      const { proxy: derived, stop: stopDerived } = buildDerivedSignals<
        TInput,
        TStateMap,
        TDerivedMap
      >(deriveds as DerivedEntry<TInput, TStateMap>[], state, input);
      cleanups.push(stopDerived);

      const slotEls = new Map<string, Element>();

      function snapshotSlots() {
        slotEls.clear();
        for (const name of Object.keys(slotDefs)) {
          const existing = host.querySelector(`[${SLOT_ATTR}="${name}"]`);
          if (existing) slotEls.set(name, existing);
        }
      }

      function restoreSlots() {
        for (const [name, slotEl] of slotEls) {
          const placeholder = host.querySelector(`[${SLOT_ATTR}="${name}"]`);
          if (placeholder) placeholder.replaceWith(slotEl);
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

      const slots = makeSlotsProxy(false);

      host.innerHTML = fn({ state, derived, input, slots });
      attachListeners();

      let stopBindings = applyBindings(host, binds as BindEntry<TStateMap>[], state);
      cleanups.push(() => stopBindings());

      for (const [name, childIsland] of Object.entries(slotDefs)) {
        const slotEl = host.querySelector(`[${SLOT_ATTR}="${name}"]`);
        if (!slotEl) continue;
        slotEls.set(name, slotEl);

        let slotProps: Record<string, unknown> | undefined;
        const ilhaProps = slotEl.getAttribute(SLOT_PROPS_ATTR);
        const dataProps = slotEl.getAttribute("data-props");
        if (ilhaProps) {
          try {
            slotProps = JSON.parse(ilhaProps) as Record<string, unknown>;
          } catch {
            console.warn(`[ilha] Failed to parse ${SLOT_PROPS_ATTR} on [${SLOT_ATTR}="${name}"]`);
          }
        } else if (dataProps) {
          try {
            slotProps = JSON.parse(dataProps) as Record<string, unknown>;
          } catch {
            console.warn(`[ilha] Failed to parse data-props on [${SLOT_ATTR}="${name}"]`);
          }
        }

        cleanups.push(childIsland.mount(slotEl, slotProps));
      }

      for (const entry of onMounts) {
        const prevSub = setActiveSub(undefined);
        let userCleanup: (() => void) | void;
        try {
          userCleanup = entry.fn({ state, input, host });
        } finally {
          setActiveSub(prevSub);
        }
        if (userCleanup) cleanups.push(userCleanup);
      }

      let initialized = false;
      const stopRender = effect(() => {
        const html = fn({ state, derived, input, slots });
        if (!initialized) {
          initialized = true;
          return;
        }
        snapshotSlots();
        detachListeners();
        stopBindings();
        host.innerHTML = html;
        restoreSlots();
        attachListeners();
        stopBindings = applyBindings(host, binds as BindEntry<TStateMap>[], state);
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

      return () => {
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

    island.toString = (props?: Partial<TInput>) => renderToStringSyncOnly(props);
    island.mount = (host: Element, props?: Partial<TInput>) => mountIsland(host, props);

    return island;
  }
}

// ─────────────────────────────────────────────
// ilha.from
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// ilha.mount — auto-discovery
// ─────────────────────────────────────────────

type IslandRegistry = Record<string, AnyIsland>;

function mountAll(registry: IslandRegistry, options: MountOptions = {}): MountResult {
  const root = options.root ?? document.body;
  const lazy = options.lazy ?? false;
  const hydrate = options.hydrate ?? false;
  const unmounts: Array<() => void> = [];

  function activateEl(host: Element) {
    const name = host.getAttribute("data-ilha");
    if (!name) return;
    const island = registry[name];
    if (!island) return;

    let props: Record<string, unknown> = {};
    const rawProps = host.getAttribute("data-props");
    if (rawProps) {
      try {
        props = JSON.parse(rawProps) as Record<string, unknown>;
      } catch {
        console.warn(`[ilha] Failed to parse data-props on [data-ilha="${name}"]`);
      }
    }

    if (hydrate) {
      const snapshot = host.innerHTML;
      const unmount = island.mount(host, props);
      if (!host.innerHTML) host.innerHTML = snapshot;
      unmounts.push(unmount);
    } else {
      unmounts.push(island.mount(host, props));
    }
  }

  const els = Array.from(root.querySelectorAll("[data-ilha]"));

  if (lazy && typeof IntersectionObserver !== "undefined") {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activateEl(entry.target);
          io.unobserve(entry.target);
        }
      }
    });
    els.forEach((el) => io.observe(el));
    unmounts.push(() => io.disconnect());
  } else {
    els.forEach(activateEl);
  }

  return { unmount: () => unmounts.forEach((u) => u()) };
}

// ─────────────────────────────────────────────
// Default export
// ─────────────────────────────────────────────

const rootBuilder = new IlhaBuilder<
  Record<string, unknown>,
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>(null, [], [], [], [], [], {}, null, []);

const ilha = Object.assign(rootBuilder, {
  html: ilhaHtml,
  raw: ilhaRaw,
  mount: mountAll,
  from: ilhaFrom,
  context: ilhaContext,
});

export const html = ilhaHtml;
export const raw = ilhaRaw;
export const mount = mountAll;
export const from = ilhaFrom;
export const context = ilhaContext;
export default ilha;
