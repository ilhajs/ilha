import { describe, expect, it } from "bun:test";

import { z } from "zod";

import {
  ilha,
  action,
  batch,
  css,
  derived,
  effect,
  html,
  json,
  onError,
  onUncaughtError,
  context,
  persist,
  state,
  untrack,
  type ActionAccessor,
  type DerivedAccessor,
  type EffectContext,
  type EffectOnceContext,
  type ErrorContext,
  type ErrorSource,
  type ExternalSignal,
  type HydratableOptions,
  type Island,
  type IslandComponent,
  morph,
  type NativeEventHandler,
  type PersistOptions,
  type PersistStorage,
  type RawHtml,
  type SignalAccessor,
  type StateAccessor,
} from "./index";
import { jsx, Fragment } from "./jsx-runtime";
import "../happydom.ts";

/**
 * Compile-time type anchors for the ilha public API.
 *
 * Every imperative anchor lives inside this NEVER-INVOKED function:
 * TypeScript still type-checks every line (including `@ts-expect-error`
 * negative assertions), but nothing executes at module scope — so the same
 * file is safe under `bun test` and under `tsc`.
 */
function ilhaTypeAnchors(): void {
  // ─── json() / css() safe content helpers ─────────────────────────────────

  const typeCheckedJson: RawHtml = json({ a: "</script>", b: [1, 2] });
  void typeCheckedJson;
  const typeCheckedCss: RawHtml = css("a{color:red}");
  void typeCheckedCss;
  // @ts-expect-error css() accepts a string only — it is an escapement, not a serializer
  css(42);

  // ─── Signal accessors ─────────────────────────────────────────────────────

  const typeCheckedNativeHandler: NativeEventHandler<InputEvent> = (event, { signal }) => {
    const inputEvent: InputEvent = event;
    const abortSignal: AbortSignal = signal;
    void inputEvent;
    void abortSignal;
  };

  // ExternalSignal is an alias of SignalAccessor — the contract type for
  // `bind:*` template plumbing. Verify the alias is bidirectional.
  // SAFETY: null-as assertions are type-level only; nothing is constructed or
  // dereferenced at runtime.
  const aliasCheckA: SignalAccessor<number> = null as unknown as ExternalSignal<number>;
  // SAFETY: same type-level check in the reverse direction.
  const aliasCheckB: ExternalSignal<number> = null as unknown as SignalAccessor<number>;
  void aliasCheckA;
  void aliasCheckB;

  const typeCheckedExternalSignal: SignalAccessor<number> = context("types.signal.num", 0);
  typeCheckedExternalSignal((previous) => previous + 1);
  // @ts-expect-error updater must return the signal value type
  typeCheckedExternalSignal(() => "wrong");

  const typeCheckedNestedSignal = context("types.signal", { profile: { name: "Ilha", age: 1 } });
  const typeCheckedSelectedByFunction: SignalAccessor<string> = typeCheckedNestedSignal.select(
    (state) => state.profile.name,
  );
  const typeCheckedSelectedByPath: SignalAccessor<string> = typeCheckedNestedSignal.select(
    "profile",
    "name",
  );
  typeCheckedSelectedByPath("Ilha.js");
  // @ts-expect-error selected path resolves to string
  const typeCheckedWrongSelectedPath: SignalAccessor<number> = typeCheckedNestedSignal.select(
    "profile",
    "name",
  );
  void typeCheckedSelectedByFunction;
  void typeCheckedWrongSelectedPath;

  const nextCallback = () => "next";
  const typeCheckedFunctionSignal = context<() => string>("types.signal.fn", () => "initial");
  // @ts-expect-error function values must be returned from an updater wrapper
  typeCheckedFunctionSignal(nextCallback);
  typeCheckedFunctionSignal(() => nextCallback);

  const typeCheckedNullableFunctionSignal = context<(() => string) | null>(
    "types.signal.fnnull",
    null,
  );
  // @ts-expect-error function members of unions must also use an updater wrapper
  typeCheckedNullableFunctionSignal(nextCallback);
  typeCheckedNullableFunctionSignal(() => nextCallback);
  typeCheckedNullableFunctionSignal(null);

  // ─── Islands: typed props ────────────────────────────────────────────────

  const TypeCheckedDirectIsland = ilha(() => html`<p>Direct island</p>`);
  const typeCheckedDirectHtml: string = TypeCheckedDirectIsland.toString();
  const typeCheckedDirectAsyncHtml: Promise<string> = TypeCheckedDirectIsland.toStringAsync();
  void typeCheckedDirectAsyncHtml;
  const typeCheckedDirectUnmount: () => void = TypeCheckedDirectIsland.mount(
    document.createElement("div"),
  );
  void TypeCheckedDirectIsland.hydratable({} as Record<string, never>, {
    name: "TypeCheckedDirectIsland",
  });
  const typeCheckedIslandKey: ReturnType<typeof TypeCheckedDirectIsland.key> =
    TypeCheckedDirectIsland.key("k");
  void typeCheckedIslandKey;

  const TypeCheckedTypedPropsIsland = ilha<{ label: string }>(({ label }) => {
    const text: string = label;
    return html`<p>${text}</p>`;
  });
  TypeCheckedTypedPropsIsland({ label: "Inbox" });
  // @ts-expect-error typed props reject undeclared keys
  TypeCheckedTypedPropsIsland({ label: "Inbox", extra: true });
  // @ts-expect-error typed props retain their declared types
  TypeCheckedTypedPropsIsland({ label: 42 });
  // @ts-expect-error island components must return HTML
  ilha(() => 42);

  const TypeCheckedComponentType: IslandComponent<{ name: string }> = ({ name }) =>
    html`<p>${name}</p>`;
  const TypeCheckedComponentIsland: Island<{ name: string }> = ilha(TypeCheckedComponentType);

  // ─── Islands: schema inference ───────────────────────────────────────────

  const typeCheckedSchema = z.object({
    name: z.string().default("World"),
    count: z.number().default(0),
  });

  const TypeCheckedSchemaIsland = ilha(typeCheckedSchema, ({ name, count }) => {
    const label: string = name;
    const n: number = count;
    return html`<p>${label}:${n}</p>`;
  });
  TypeCheckedSchemaIsland({ name: "Ada", count: 1 });
  // @ts-expect-error schema types reject wrong value types
  TypeCheckedSchemaIsland({ name: "Ada", count: "many" });
  const typeCheckedSchemaSsr: string = TypeCheckedSchemaIsland.toString({ name: "Ada", count: 2 });
  void typeCheckedSchemaSsr;

  // Schema form accepts coercion through its input type (zod default).
  const TypeCheckedSchemaInputIsland = ilha(
    z.object({ name: z.string().default("World") }),
    ({ name }) => html`<p>hello ${name}</p>`,
  );
  TypeCheckedSchemaInputIsland({ name: "Ada" });

  // ─── state() ─────────────────────────────────────────────────────────────

  const TypeCheckedStateIsland = ilha(() => {
    const count: StateAccessor<number> = state(0);
    count();
    count(1);
    count((previous) => previous + 1);
    // @ts-expect-error state writes must match the value type
    count("one");
    const lazy: StateAccessor<number> = state(() => 1);
    void lazy;
    return html`<p>${count()}</p>`;
  });

  // ─── derived() ───────────────────────────────────────────────────────────

  const TypeCheckedDerivedIsland = ilha(() => {
    const count = state(0);
    const doubled: DerivedAccessor<number> = derived(() => count() * 2);
    const value: number | undefined = doubled();
    const loading: boolean = doubled.loading;
    const resolved: number | undefined = doubled.value;
    const error: Error | undefined = doubled.error;
    void loading;
    void resolved;
    void error;
    void value;
    return html`<p>${doubled()}</p>`;
  });

  const TypeCheckedAsyncDerivedIsland = ilha(() => {
    const id = state("one");
    const user: DerivedAccessor<{ name: string }> = derived(async ({ signal }) => {
      const response = await fetch(`/users/${id()}`, { signal });
      return response.json();
    });
    const name: { name: string } | undefined = user.value;
    void name;
    return html`<p>${user.loading ? "loading" : "done"}</p>`;
  });

  const TypeCheckedGeneratorDerivedIsland = ilha(() => {
    const messages: DerivedAccessor<string> = derived(async function* ({ signal }) {
      for await (const message of connect(signal)) {
        yield message;
      }
    });
    const next: string | undefined = messages();
    void next;
    return html`<ul>
      ${messages() ?? ""}
    </ul>`;
  });

  async function* connect(signal: AbortSignal): AsyncGenerator<string> {
    void signal;
    yield "hi";
  }

  // ─── action() ────────────────────────────────────────────────────────────

  const TypeCheckedActionsIsland = ilha(() => {
    const count = state(0);
    const increment = action((amount: number) => {
      count((previous) => previous + amount);
      return count();
    });
    const save = action(async (form: string) => {
      await fetch("/save", { method: "POST", body: form });
      return form.length;
    });
    const noPayload = action((_payload: undefined, { signal }: EffectContext) => {
      void signal;
      return 1;
    });

    increment(2);
    // @ts-expect-error the action payload type is enforced
    increment("two");
    save("form");
    // @ts-expect-error the async action payload type is enforced
    save(12);
    noPayload();

    // @ts-expect-error actions declared with a payload require it
    increment();
    // @ts-expect-error actions with explicit payloads are callable with the payload type only
    noPayload(5);

    const pending: boolean = save.pending;
    const data: number | undefined = save.data;
    const error: Error | undefined = save.error;
    void pending;
    void data;
    void error;

    const typedSave: ActionAccessor<string, number> = save;
    void typedSave;
    const typedIncrement: ActionAccessor<number, number> = increment;
    void typedIncrement;
    const typedNoPayload: ActionAccessor<undefined, number> = noPayload;
    void typedNoPayload;

    const boundIncrement = increment.with(1);
    const nativeCallback: NativeEventHandler<PointerEvent> = boundIncrement;
    const componentCallback: (checked: boolean) => void = boundIncrement;
    void nativeCallback;
    void componentCallback;

    return html`<button onclick=${() => increment(1)}>${count()}</button>`;
  });

  // ─── effect() / effect.once() / onError() ────────────────────────────────

  const TypeCheckedEffectsIsland = ilha(() => {
    const count = state(0);

    effect(() => {
      void count();
      return () => {
        // cleanup before rerun or unmount
      };
    });

    effect(({ signal }: EffectContext) => {
      const abortSignal: AbortSignal = signal;
      void abortSignal.aborted;
    });

    effect.once(({ host, signal, hydrated }: EffectOnceContext) => {
      const hostElement: Element = host;
      const abortSignal: AbortSignal = signal;
      const wasHydrated: boolean = hydrated;
      void hostElement;
      void abortSignal;
      void wasHydrated;
      return () => {
        // runs on unmount
      };
    });

    onError(({ error, source, host }: ErrorContext) => {
      const err: Error = error;
      const reason: ErrorSource = source;
      const element: Element = host;
      void err;
      void reason;
      void element;
    });

    return html`<p>${count()}</p>`;
  });

  const typeCheckedErrorSource: ErrorSource = "action";
  void typeCheckedErrorSource;
  const typeCheckedOnUncaught: () => void = onUncaughtError((error, source) => {
    const e: Error = error;
    const s: ErrorSource = source;
    void e;
    void s;
  });

  // ─── Island methods ──────────────────────────────────────────────────────

  const TypeCheckedMethodsIsland = ilha<{ name: string }>(({ name }) => html`<p>${name}</p>`);

  const typeCheckedToString: string = TypeCheckedMethodsIsland.toString({ name: "Ada" });
  const typeCheckedToAsync: Promise<string> = TypeCheckedMethodsIsland.toStringAsync({
    name: "Ada",
  });
  const typeCheckedMount: () => void = TypeCheckedMethodsIsland.mount(
    document.createElement("div"),
    { name: "Ada" },
  );
  const typeCheckedHydratable: Promise<string> = TypeCheckedMethodsIsland.hydratable(
    { name: "Ada" },
    { name: "Ada", as: "span", snapshot: { state: false, derived: true }, skipOnMount: true },
  );
  const typeCheckedHydratableOptions: HydratableOptions = {
    name: "x",
    snapshot: true,
  };
  void typeCheckedHydratableOptions;
  void typeCheckedHydratable;
  const typeCheckedKeyed = TypeCheckedMethodsIsland.key("stable")({ name: "Ada" });
  void typeCheckedKeyed;
  void TypeCheckedMethodsIsland.define("ada-label", { observe: ["name"] });

  // Keyed island callables carry through to island props
  const TypeCheckedKeyedIsland = ilha<{ value: number }>(({ value }) => html`<b>${value}</b>`);
  // @ts-expect-error keyed islands still enforce prop types
  TypeCheckedKeyedIsland.key("k")({ value: "no" });
  TypeCheckedKeyedIsland.key("k")({ value: 1 });
  // @ts-expect-error keys must be strings
  TypeCheckedKeyedIsland.key(12);

  // ─── JSX composition ─────────────────────────────────────────────────────

  const typeCheckedJsx = jsx(Fragment, {
    children: [
      jsx(TypeCheckedMethodsIsland, { name: "Ada" }),
      jsx("span", { className: "x", children: "child" }),
    ],
  });

  // ─── Top-level helpers ───────────────────────────────────────────────────

  const typeCheckedBatchReturn: number = batch(() => {
    typeCheckedExternalSignal(1);
    return typeCheckedExternalSignal();
  });

  const typeCheckedUntrackReturn: number = untrack(() => typeCheckedExternalSignal());

  const typeCheckedPersistOptions: PersistOptions<number> = {
    storage: {} as PersistStorage,
    crossTab: false,
    serialize: String,
    deserialize: (raw) => Number(raw),
  };
  const typeCheckedPersistUnsubscribe: () => void = persist(typeCheckedExternalSignal, "key");
  const typeCheckedPersistOptionsUnsubscribe: () => void = persist(
    typeCheckedExternalSignal,
    "key",
    typeCheckedPersistOptions,
  );
  // @ts-expect-error mismatch between signal value type and options serialize callback
  persist<number>(typeCheckedExternalSignal, "key", { serialize: (value: string) => value });
  // @ts-expect-error persist requires a signal accessor, not a plain value
  persist(5, "key");

  const typeCheckedMorph: typeof morph = morph;
  const typeCheckedMorphHost = document.createElement("div");
  morph(typeCheckedMorphHost, "<p>morphed</p>");

  // Standalone effect returns a stop function; island effect() registers a slot.
  // The union return type is deliberate: the same call shape cannot be
  // discriminated at the call site, so document it instead of masking it.
  const typeCheckedStandaloneEffect: () => void = effect(() => {}) as () => void;
  const TypeCheckedStandaloneEffectInside = ilha(() => {
    const stopOrVoid: void | (() => void) = effect(() => {});
    void stopOrVoid;
    return html`<p>ok</p>`;
  });
  // The standalone cast is intentional: at module scope effect() always returns
  // a stop function (see the JSDoc @returns contract on `effect`).
  void typeCheckedStandaloneEffect;

  // island() call returns the IslandCall composition rather than HTML
  const typeCheckedComposition: ReturnType<typeof TypeCheckedMethodsIsland> =
    TypeCheckedMethodsIsland({ name: "Ada" });
  void typeCheckedComposition;
  // Consume anchor values so noUnusedLocals stays satisfied.
  void TypeCheckedActionsIsland;
  void TypeCheckedAsyncDerivedIsland;
  void TypeCheckedComponentIsland;
  void TypeCheckedDerivedIsland;
  void TypeCheckedEffectsIsland;
  void TypeCheckedGeneratorDerivedIsland;
  void TypeCheckedStandaloneEffectInside;
  void TypeCheckedStateIsland;
  void typeCheckedBatchReturn;
  void typeCheckedDirectHtml;
  void typeCheckedDirectUnmount;
  void typeCheckedJsx;
  void typeCheckedMorph;
  void typeCheckedMount;
  void typeCheckedNativeHandler;
  void typeCheckedOnUncaught;
  void typeCheckedPersistOptionsUnsubscribe;
  void typeCheckedPersistUnsubscribe;
  void typeCheckedToAsync;
  void typeCheckedToString;
  void typeCheckedUntrackReturn;
}

void ilhaTypeAnchors;

// ─── Runtime smoke ────────────────────────────────────────────────────────

describe("types.test anchors", () => {
  it("exposes callable public surface", () => {
    expect(typeof ilha).toBe("function");
    expect(typeof state).toBe("function");
  });
});
