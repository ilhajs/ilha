/**
 * The shared-state runtime behind Story and Scene steps: `shared`,
 * `sent`, `collected`, `given`'s `shared`, `$.send` recording, `$.reads`,
 * `reports`, and the `reads` view helper. No owners mount: values come
 * from the steps, or from an owner's defaults when all its props are
 * optional.
 */
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";

import { initStepOf, makeInitApi } from "../component.ts";
import type { ReadsDecl, ReadsEntry, SharesDecl } from "../component.ts";
import { specsOf } from "../internal/layer-run.ts";
import type { SharedRecord } from "../message-log.ts";
import type { Engine, EngineInternals } from "./engine.ts";
import type { Slices } from "./parts.ts";
import { registerTestExtension } from "./steps.ts";
import type { ExtensionContext } from "./steps.ts";

/** Whether `value` is a non-null object. */
const isObject = <T>(value: T): value is T & object =>
  typeof value === "object" && value !== null;

/** A callable over erased values. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- erased callables take and return schema-erased values.
type ErasedFn = (...args: readonly unknown[]) => unknown;

/** Whether `value` is callable. */
const isCallable = <T>(value: T): value is T & ErasedFn =>
  typeof value === "function";

/** Whether `value` is a string. */
const isString = <T>(value: T): value is T & string =>
  typeof value === "string";

/** A `provide` `onFailure` handler over an erased failure. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- failures are schema-erased until the handler decodes them; results dispatch as messages.
type OnFailure = (failure: unknown) => unknown;

/** The erased synchronous Schema decode shape. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- erased Schemas decode from unknown by construction.
type DecodeSync = (schema: unknown) => (input: unknown) => unknown;

/** The erased component implementation shape `defaultValue` needs: `init`. */
interface ErasedInit {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- init takes the erased api and props and returns an erased step or model.
  readonly init: (api: unknown, props: unknown) => unknown;
}

/** The shared-state slice's engine state, under `slices["shared"]`. */
export interface SharedState {
  /** The value each owner shares, by owner component reference. */
  readonly values: Map<unknown, unknown>;
  /** The last delivered value per read, by local read name. */
  readonly previous: Map<string, unknown>;
  /** Whether a value was ever delivered per local read name. */
  readonly seen: Set<string>;
  /** The last `collected` message, for change detection. */
  collected: unknown;
  /** Whether `collected` ever delivered. */
  hasCollected: boolean;
}

const freshState = (): SharedState => ({
  collected: undefined,
  hasCollected: false,
  previous: new Map(),
  seen: new Set(),
  values: new Map(),
});

/** The shared-state slice's state, creating it on first use. */
export const sharedStateOf = (slices: Slices): SharedState => {
  // SAFETY: only SharedState values are stored under "shared"; freshState creates it on first use.
  const existing = slices["shared"] as SharedState | undefined;
  if (existing !== undefined) {
    return existing;
  }
  const state = freshState();
  slices["shared"] = state;
  return state;
};

/** One resolved read: its local name, owner component, and declaration. */
interface ResolvedRead {
  readonly local: string;
  readonly owner: object;
  readonly entry: ReadsEntry | undefined;
  readonly optional: boolean;
}

/** The definition with its optional shared-state declarations. */
interface Decl {
  readonly reads?: unknown;
  readonly shares?: unknown;
  readonly props?: Schema.Schema<unknown> | undefined;
}

// SAFETY: test definitions carry the slice declarations above; the base type only names the Schemas.
const declOf = (engine: Engine): Decl =>
  engine.state.component.definition as Decl;

/** The component's reads with their owners resolved. */
const resolvedReads = (engine: Engine): readonly ResolvedRead[] => {
  // SAFETY: `reads` declarations map local names to entries or owners; missing means no reads.
  const reads = (declOf(engine).reads ?? {}) as ReadsDecl;
  return Object.entries(reads).map(([local, decl]) => {
    if (isObject(decl) && "owner" in decl) {
      // SAFETY: entries carry `owner`; `in` confirmed the shape above.
      const entry = decl as ReadsEntry;
      return {
        entry,
        local,
        optional: entry.optional ?? false,
        // SAFETY: entries name an owner component; "self" resolves at use.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the owner can be the "self" string at the type level; identity is preserved.
        owner: entry.owner as unknown as object,
      };
    }
    // SAFETY: a non-entry declaration is the owner component itself.
    return { entry: undefined, local, optional: false, owner: decl as object };
  });
};

/** The owner's definition name for failure messages. */
// oxlint-disable-next-line anti-slop/no-object-parameters -- owners are erased components; narrowed with `in` below.
const ownerName = (owner: object): string => {
  if ("definitionName" in owner && isString(owner.definitionName)) {
    return owner.definitionName;
  }
  return "an owner";
};

/** The default value an owner shares, or `undefined` when it has none. */
// oxlint-disable-next-line anti-slop/no-object-parameters, anti-slop/no-unknown-returns -- owners are erased components; defaults are schema-erased until decoded.
const defaultValue = (_engine: Engine, owner: object): unknown => {
  // SAFETY: owner components carry their definition; anything else has none.
  const holder = owner as { readonly definition?: unknown };
  // SAFETY: test definitions carry optional props Schemas and shares declarations.
  const definition = holder.definition as
    | {
        readonly props?: Schema.Schema<unknown> | undefined;
        readonly shares?: unknown;
      }
    | undefined;
  if (definition === undefined) {
    return undefined;
  }
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- props start empty and are replaced by the decoded value below.
  let props: unknown = {};
  if (definition.props !== undefined) {
    try {
      // SAFETY: erased Schemas decode from unknown by construction; failures fall through to undefined below.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the Schema class type is unrelated to the decode function shape.
      props = (Schema.decodeUnknownSync as unknown as DecodeSync)(
        definition.props
      )({});
    } catch {
      return undefined;
    }
  }
  // SAFETY: shares declarations are a bare function or the full object form; missing means no shares.
  const shares = definition.shares as SharesDecl<unknown, unknown> | undefined;
  if (shares === undefined) {
    return undefined;
  }
  // SAFETY: owner components carry their implementation; anything else shares nothing.
  const { implementation } = owner as {
    readonly implementation?: ErasedInit | undefined;
  };
  if (implementation === undefined) {
    return undefined;
  }
  const api = makeInitApi<unknown, unknown, never>(props, (model) =>
    initStepOf<unknown, never>(model)
  );
  let model: unknown = props;
  try {
    // SAFETY: init returns an erased step or a bare model; the shape is checked below.
    const out = implementation.init(api, props) as { readonly model?: unknown };
    model = isObject(out) && "model" in out ? out.model : out;
  } catch {
    return undefined;
  }
  try {
    if (isObject(shares) && "value" in shares) {
      return shares.value(model, props, {});
    }
    if (isCallable(shares)) {
      return shares(model, props, {});
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/** The current value of one read: the step value, else the owner's default. */
const readValue = (
  engine: Engine,
  state: SharedState,
  read: ResolvedRead
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- read values are schema-erased until the component decodes them.
): unknown => {
  if (state.values.has(read.owner)) {
    return state.values.get(read.owner);
  }
  return defaultValue(engine, read.owner);
};

/** The `$.reads` and `h.reads` record of current shared values. */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- shared values are schema-erased until the component decodes them.
export const readsForUpdate = (engine: Engine): SharedRecord => {
  const state = sharedStateOf(engine.state.slices);
  const out: Slices = {};
  for (const read of resolvedReads(engine)) {
    const value = readValue(engine, state, read);
    if (value === undefined && !read.optional) {
      throw new Error(
        `${engine.module}.reads: the owner ${ownerName(read.owner)} has no value: set it with shared`
      );
    }
    out[read.local] = value;
  }
  return out;
};

/** What the component reports to each owner it `reads` with `report`. */
export const sharedReports = (
  engine: Engine
): readonly { readonly owner: string; readonly report: unknown }[] => {
  const out: { readonly owner: string; readonly report: unknown }[] = [];
  for (const read of resolvedReads(engine)) {
    const report = read.entry?.report;
    if (!isCallable(report)) {
      continue;
    }
    try {
      out.push({
        owner: ownerName(read.owner),
        report: report(
          engine.state.model,
          engine.state.props,
          (name: string) => `${name}`
        ),
      });
    } catch {
      continue;
    }
  }
  return out;
};

/**
 * Sets the value an owner shares, delivering every `onChange` whose value
 * changed. A message step when it delivers, an acting step otherwise.
 */
export const sharedSet = (
  engine: Engine,
  step: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- shared owners and values are schema-erased until decoded.
  owner: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- shared owners and values are schema-erased until decoded.
  value: unknown
): boolean => {
  if (!isObject(owner) && !isCallable(owner)) {
    throw new Error(
      `${step}: shared takes an owner component, not ${JSON.stringify(owner)}`
    );
  }
  const state = sharedStateOf(engine.state.slices);
  state.values.set(owner, value);
  let delivered = false;
  for (const read of resolvedReads(engine)) {
    if (read.owner !== owner) {
      continue;
    }
    const onChange = read.entry?.onChange;
    if (!isCallable(onChange)) {
      continue;
    }
    const previous = state.seen.has(read.local)
      ? state.previous.get(read.local)
      : defaultValue(engine, read.owner);
    if (state.seen.has(read.local) && Equal.equals(previous, value)) {
      continue;
    }
    if (!state.seen.has(read.local) && read.optional) {
      state.seen.add(read.local);
      state.previous.set(read.local, value);
      continue;
    }
    state.seen.add(read.local);
    state.previous.set(read.local, value);
    let message: unknown;
    try {
      message = onChange(value);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `${step}: the onChange of the read "${read.local}" threw: ${messageText}`,
        { cause: error }
      );
    }
    if (message !== undefined) {
      engine.deliver(message);
      delivered = true;
    }
  }
  return delivered;
};

/** Writes `given`'s `shared` pairs with no `onChange`. */
export const sharedGiven = (
  slices: Slices,
  pairs: readonly (readonly [unknown, unknown])[]
): void => {
  const state = sharedStateOf(slices);
  for (const [owner, value] of pairs) {
    state.values.set(owner, value);
  }
};

/** Records a step's `$.send` calls as unacknowledged sends. */
export const noteStepSends = (
  engine: Engine,
  sends: readonly { readonly owner: unknown; readonly message: unknown }[]
): void => {
  for (const send of sends) {
    // SAFETY: step sends name "self" or an owner component; ownerName only reads the definition name.
    const owner =
      send.owner === "self"
        ? engine.state.component.definitionName
        : ownerName(send.owner as object);
    engine.state.sent.push({ message: send.message, owner });
  }
};

/** Acknowledges the oldest `$.send` to `owner`. */
export const sharedSent = (
  engine: Engine,
  step: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- send owners and messages are schema-erased until decoded.
  owner: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- send owners and messages are schema-erased until decoded.
  message: unknown
): void => {
  let wanted: string;
  if (owner === "self") {
    wanted = engine.state.component.definitionName;
  } else if (isObject(owner)) {
    wanted = ownerName(owner);
  } else {
    wanted = String(owner);
  }
  const index = engine.state.sent.findIndex((send) => {
    if (send.owner !== wanted) {
      const byRef =
        isObject(owner) &&
        resolvedReads(engine).some(
          (read) => read.owner === owner && ownerName(read.owner) === send.owner
        );
      if (!byRef) {
        return false;
      }
    }
    return Equal.equals(send.message, message);
  });
  if (index === -1) {
    throw new Error(
      `${step}: no unacknowledged send to ${wanted} matches ${JSON.stringify(message)}${
        engine.state.sent.length === 0
          ? `: nothing was sent`
          : `; unacknowledged sends:\n  - ${engine.state.sent.map((send) => `${send.owner}: ${JSON.stringify(send.message)}`).join("\n  - ")}`
      }`
    );
  }
  engine.state.sent.splice(index, 1);
};

/**
 * Runs an owner's `shares.collects.onChange` and delivers when the result
 * differs from the last one. Returns whether a message was delivered.
 */
export const sharedCollected = (
  engine: Engine,
  step: string,
  reports: readonly unknown[]
): boolean => {
  // SAFETY: collects declarations carry onChange by construction; missing means no collects.
  const shares = declOf(engine).shares as
    | SharesDecl<unknown, unknown>
    | undefined;
  const collects =
    isObject(shares) && "collects" in shares ? shares.collects : undefined;
  if (collects === undefined || !isCallable(collects.onChange)) {
    throw new Error(
      `${step}: collected takes an owner component with shares.collects, but ${engine.state.component.definitionName} has none`
    );
  }
  const state = sharedStateOf(engine.state.slices);
  let message: unknown;
  try {
    message = collects.onChange(reports);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    throw new Error(`${step}: the collects onChange threw: ${messageText}`, {
      cause: error,
    });
  }
  if (state.hasCollected && Equal.equals(state.collected, message)) {
    return false;
  }
  state.hasCollected = true;
  state.collected = message;
  if (message !== undefined) {
    engine.deliver(message);
  }
  return message !== undefined;
};

/** The `provide` `onFailure` handlers on an implementation, innermost first. */
export const provideOnFailures = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- provide implementations are erased layers; handlers return dispatched messages.
  implementation: unknown
): readonly OnFailure[] => {
  const handlers: OnFailure[] = [];
  for (const spec of specsOf(implementation).toReversed()) {
    if (spec.onFailure !== undefined) {
      // SAFETY: specsOf exposes onFailure handlers; only present handlers run, innermost first.
      handlers.push(spec.onFailure as OnFailure);
    }
  }
  return handlers;
};

/** Registers the shared-state slice's `h` helper with the engine. */
export const registerSharedSlice = (): void => {
  registerTestExtension({
    helper: (ctx: ExtensionContext) => {
      // SAFETY: the test engine implements the extension context; slices recover internals through it.
      const internals = ctx as EngineInternals;
      // SAFETY: EngineInternals carries the engine state and deliver; the slice uses only those.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Engine's private fields make single-step assertion incomparable.
      const engine = internals as unknown as Engine;
      return { reads: readsForUpdate(engine) };
    },
    name: "shared",
  });
};
