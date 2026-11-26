import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";

import type * as Component from "../component.ts";
import type * as MessageLog from "../message-log.ts";
/**
 * Shared state: owners (`shares`) and readers (`reads`), `$.send` and
 * `$.reads`, owner lookup by definition through hidden path prefixes, the
 * runtime missing-owner error, `onChange` rounds, `collects` and the
 * 100-round loop guards. Ported from Effect UI's `internal/shared.ts` and
 * `internal/shared-run.ts`, adapted to the island kernel: owners are found by
 * longest live path prefix (not a tree walk), readers subscribe through the
 * owner's signal atom, and rounds/collects settle in a microtask once the
 * render pass has nothing left to render.
 *
 * `SharedRecord` values are compared with {@link sharedEqual}: shallow for
 * plain records, `Equal.equals` otherwise.
 *
 * @internal
 */
import { isKeptParked } from "./kept-run.ts";
import type { InstanceRecord } from "./kernel.ts";
import type * as Kernel from "./kernel.ts";

// Set once by the kernel module, which owns dispatch and recording.
let dispatch: typeof Kernel.dispatch = () => {
  throw new Error("shared-run used before the kernel bound dispatch");
};
let failOutside: typeof Kernel.failOutside = () => {
  throw new Error("shared-run used before the kernel bound failOutside");
};
let kernelHasLog: typeof Kernel.kernelHasLog = () => false;
let recordEntry: typeof Kernel.recordEntry = () => {
  // Bound by the kernel module before any shared slice runs.
};

/**
 * Give shared state the kernel's dispatch and recording. Called once by
 * the kernel module.
 *
 * @internal
 */
export const bindSharedRunKernel = (hooks: {
  readonly dispatch: typeof Kernel.dispatch;
  readonly failOutside: typeof Kernel.failOutside;
  readonly kernelHasLog: typeof Kernel.kernelHasLog;
  readonly recordEntry: typeof Kernel.recordEntry;
}): void => {
  ({ dispatch, failOutside, kernelHasLog, recordEntry } = hooks);
};

/**
 * One normalized `reads` entry: the local name `h.reads`, `p.reads` and
 * `$.reads` read the owner under, plus the optional report and `onChange`.
 *
 * @internal
 */
export interface ReadEntry {
  /** The local name the reader reads the owner under. */
  readonly name: string;
  /** The owner's definition (`"self"` resolves to the reader's own). */
  readonly owner: Component.DefinitionAny;
  readonly optional: boolean;
  readonly report:
    | ((
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- report reads the owner's Model and props; the owner schema checks them at the boundary.
        model: unknown,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- report reads the owner's Model and props; the owner schema checks them at the boundary.
        props: unknown,
        id: (name: string, key?: string | number) => string
        // oxlint-disable-next-line anti-slop/no-unknown-returns -- the report value is collected and parsed by the owner's collects schema.
      ) => unknown)
    | undefined;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- onChange carries the owner's latest value to a message; the reader's update validates it at run time.
  readonly onChange: ((value: unknown) => void) | undefined;
}

const noReads: readonly ReadEntry[] = [];
const readsCache = new WeakMap<object, readonly ReadEntry[]>();
const sharesCache = new WeakMap<object, NormalizedShares | undefined>();
/** Whether `value` is callable (owner shorthands and bare value functions arrive untyped). */
const isCallableValue = (value: unknown): value is (...args: never[]) => void =>
  typeof value === "function";

/** Whether `value` is a non-null object (declared shapes arrive unvalidated). */
const isObjectValue = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- shared values are heterogeneous by construction; each owner's schema states its contract.
const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Whether `value` reads string keys as schemas (TaggedUnion case tables arrive unvalidated). */
const isSchemaRecord = (
  value: unknown
): value is Record<string, Schema.Schema<unknown>> =>
  typeof value === "object" && value !== null;

/**
 * The normalized `shares` of an owner definition.
 *
 * @internal
 */
export interface NormalizedShares {
  readonly value: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- shares value reads the owner's Model and props; the shares schema checks them at the boundary.
    model: unknown,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- shares value reads the owner's Model and props; the shares schema checks them at the boundary.
    props: unknown,
    reads: MessageLog.SharedRecord
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- shares value is encoded by the optional schema, best-effort structural without it.
  ) => unknown;
  readonly schema: Schema.Schema<unknown> | undefined;
  readonly receives: readonly string[] | undefined;
  readonly collects:
    | {
        readonly schema: Schema.Schema<unknown>;
        // oxlint-disable-next-line anti-slop/no-unknown-returns -- collected reports are parsed by the collects schema into a message.
        readonly onChange: (reports: readonly unknown[]) => unknown;
      }
    | undefined;
  /** The messages the owner receives, for the log: `receives` filtered out of `message`. */
  readonly receivesSchema: Schema.Top;
  /** The Schema the log encodes the shared value through, when `schema` is set. */
  readonly sharesSchema: Schema.Top | undefined;
}
export const readsOf = (
  definition: Component.DefinitionAny
): readonly ReadEntry[] => {
  const declared = definition.reads;
  if (declared === undefined) {
    return noReads;
  }
  let reads = readsCache.get(declared);
  if (reads === undefined) {
    reads = Object.entries(declared).map(([name, entry]): ReadEntry => {
      if (isCallableValue(entry)) {
        return {
          name,
          onChange: undefined,
          optional: false,
          // SAFETY: authors register real components as reads shorthands; the erased definition names the owner the lookup compares by.
          owner: entry.definition as Component.DefinitionAny,
          report: undefined,
        };
      }
      // SAFETY: authors register real components as reads owners; the erased definition names the owner the lookup compares by.
      const owner =
        entry.owner === "self"
          ? definition
          : (entry.owner.definition as Component.DefinitionAny);
      return {
        name,
        onChange: entry.onChange,
        optional: entry.optional === true,
        owner,
        report: entry.report,
      };
    });
    readsCache.set(declared, reads);
  }
  return reads;
};

/**
 * A definition's normalized `shares`, or `undefined` when it shares
 * nothing. Accepts the shorthand (a bare `value` function) and the full
 * `{ value, schema?, receives?, collects? }` form.
 *
 * @internal
 */
const filterReceives = (
  message: Schema.Schema<unknown>,
  receives: readonly string[]
): Schema.Top => {
  try {
    // TaggedUnion schemas carry their case schemas in `cases`, keyed by tag.
    if (!("cases" in message)) {
      // SAFETY: schemas without a case table encode the whole message; the cast only names the Top form the record stores.
      return message as Schema.Top;
    }
    const cases: unknown = message.cases;
    if (!isSchemaRecord(cases)) {
      // SAFETY: schemas without a case table encode the whole message; the cast only names the Top form the record stores.
      return message as Schema.Top;
    }
    const picked = receives.flatMap((tag) => {
      const member = cases[tag];
      return member === undefined ? [] : [member];
    });
    const [only] = picked;
    if (picked.length === 1 && only !== undefined) {
      // SAFETY: the single case schema encodes exactly the received tag; the cast only names the Top form the record stores.
      return only as Schema.Top;
    }
    if (picked.length === 0) {
      return Schema.Never;
    }
    // SAFETY: every member is a case schema of the TaggedUnion; the chain only names the constraint tuple Union takes.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the built union has no single-step assertion to the Top form the record stores.
    return Schema.Union(
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the picked case schemas have no single-step assertion to the constraint tuple.
      picked as unknown as readonly Schema.Constraint[]
    ) as unknown as Schema.Top;
  } catch {
    // SAFETY: a throwing case read falls back to the whole message; the cast only names the Top form the record stores.
    return message as Schema.Top;
  }
};

export const sharesOf = (
  definition: Component.DefinitionAny
): NormalizedShares | undefined => {
  const declared = definition.shares;
  if (declared === undefined) {
    return undefined;
  }
  if (!isCallableValue(declared) && !isObjectValue(declared)) {
    return undefined;
  }
  const cached = sharesCache.get(declared);
  if (cached !== undefined) {
    return cached;
  }
  const objectForm: Component.SharesObject<unknown, unknown> = isCallableValue(
    declared
  )
    ? { value: declared }
    : declared;
  const { receives } = objectForm;
  const receivesSchema: Schema.Top =
    receives === undefined || receives.length === 0
      ? Schema.Never
      : filterReceives(definition.message, receives);
  const normalized: NormalizedShares = {
    collects: objectForm.collects,
    receives: objectForm.receives,
    receivesSchema,
    schema: objectForm.schema,
    // SAFETY: the log encodes the value through this schema when set; the cast only names the Top form the record stores.
    sharesSchema: objectForm.schema as Schema.Top | undefined,
    value: objectForm.value,
  };
  sharesCache.set(declared, normalized);
  return normalized;
};
/**
 * Throws for a definition whose `reads` gives one owner two `onChange`s (a
 * reader gets one message per change of an owner; aliases of an owner with
 * one `onChange` among them are fine), for a `"self"` entry that isn't
 * optional, and for a `"self"` entry in a component that shares nothing.
 * Called by `make`, so bad declarations fail fast instead of at render.
 *
 * @internal
 */
export const checkReads = (definition: Component.DefinitionAny): void => {
  const declared = definition.reads;
  if (declared === undefined) {
    return;
  }
  const ownerOfEntry = (
    entry: Component.ReadsEntry
  ): Component.DefinitionAny => {
    if (entry.owner === "self") {
      return definition;
    }
    // SAFETY: authors register real components as reads owners; the erased definition names the owner the lookup compares by.
    return entry.owner.definition as Component.DefinitionAny;
  };
  const handled = new Map<Component.DefinitionAny, string>();
  for (const [key, entry] of Object.entries(declared)) {
    if (isCallableValue(entry)) {
      continue;
    }
    if (entry.owner === "self") {
      if (definition.shares === undefined) {
        throw new Error(
          `${definition.name} reads its own kind under ${key}, so it must share state: add shares`
        );
      }
      if (entry.optional !== true) {
        throw new Error(
          `${definition.name} reads its own kind under ${key}, and the outermost one has none above it: add optional: true`
        );
      }
    }
    if (entry.onChange === undefined) {
      continue;
    }
    const owner = ownerOfEntry(entry);
    const before = handled.get(owner);
    if (before !== undefined) {
      throw new Error(
        `${definition.name} lists ${owner.name} under ${before} and ${key}, each with an onChange. A reader gets one message per change of an owner: keep one onChange.`
      );
    }
    handled.set(owner, key);
  }
};

/**
 * Whether two shared values (or reports) are equal: `Object.is`, then
 * shallow for plain records, `Equal.equals` otherwise (so a `Date` compares
 * by value, not as a keyless record).
 *
 * @internal
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- shared values are heterogeneous by construction; equality is structural with an Equal.equals fallback.
export const sharedEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) {
    return true;
  }
  if (!isUnknownRecord(a) || !isUnknownRecord(b)) {
    return Equal.equals(a, b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Equal.equals(a, b);
  }
  const protoA = Object.getPrototypeOf(a);
  const protoB = Object.getPrototypeOf(b);
  if (protoA !== Object.prototype && protoA !== null) {
    return Equal.equals(a, b);
  }
  if (protoB !== Object.prototype && protoB !== null) {
    return Equal.equals(a, b);
  }
  for (const key of Object.keys(a)) {
    if (!Object.hasOwn(b, key)) {
      return false;
    }
    const x = a[key];
    const y = b[key];
    if (!Object.is(x, y) && !sharedEqual(x, y)) {
      return false;
    }
  }
  return Object.keys(a).length === Object.keys(b).length;
};

const escapeId = (value: string): string =>
  value.replaceAll(
    /[^A-Za-z0-9]/gu,
    (char) => `_${(char.codePointAt(0) ?? 0).toString(36)}_`
  );

/**
 * The `id` a reader's `report` builds on: the same derivation as
 * `h.id`/`p.id` for the reader's path.
 *
 * @internal
 */
export const reportIdOf =
  (readerPath: string) =>
  (name: string, key?: string | number | undefined): string =>
    `${escapeId(readerPath)}-${escapeId(name)}${key === undefined ? "" : `-${escapeId(String(key))}`}`;

interface FoundOwner {
  readonly _tag: "owner";
  readonly record: InstanceRecord;
}

interface FoundOther {
  readonly _tag: "other";
  readonly record: InstanceRecord;
}

type Found = FoundOwner | FoundOther | undefined;

interface OwnerSlot {
  value: unknown;
  hasValue: boolean;
  /** The log `seq` of the `Update` (or mount) that last changed the value. */
  seq: number | undefined;
  collected: unknown;
  hasCollected: boolean;
}

/**
 * An owner's runtime slot: the last computed value, the log `seq` that
 * changed it, and the collects baseline.
 */
const ownerSlotOf = (rec: InstanceRecord): OwnerSlot => {
  // SAFETY: the kernel stores the owner's slot under this key after the first refresh; readers never write it.
  let slot = rec.extensions.get("shared.owner") as OwnerSlot | undefined;
  if (slot === undefined) {
    slot = {
      collected: undefined,
      hasCollected: false,
      hasValue: false,
      seq: undefined,
      value: undefined,
    };
    rec.extensions.set("shared.owner", slot);
  }
  return slot;
};

/**
 * The nearest live owner above `rec` whose definition is the same object
 * as `owner`, by longest live path prefix. When only a different component
 * with the same name is above, answers it instead so the error can name it.
 *
 * @internal
 */
export const nearestOwner = (
  rec: InstanceRecord,
  owner: Component.DefinitionAny
): Found => {
  const prefix = `${rec.path}/`;
  let match: InstanceRecord | undefined;
  let sameName: InstanceRecord | undefined;
  for (const candidate of rec.kernel.records.values()) {
    if (candidate.status !== "live") {
      continue;
    }
    if (sharesOf(candidate.definition) === undefined) {
      continue;
    }
    if (!prefix.startsWith(`${candidate.path}/`)) {
      continue;
    }
    if (
      candidate.definition === owner &&
      (match === undefined || candidate.path.length > match.path.length)
    ) {
      match = candidate;
    } else if (
      candidate.definition.name === owner.name &&
      (sameName === undefined || candidate.path.length > sameName.path.length)
    ) {
      sameName = candidate;
    }
  }
  if (match !== undefined) {
    return { _tag: "owner", record: match };
  }
  if (sameName !== undefined) {
    return { _tag: "other", record: sameName };
  }
  return undefined;
};

const absentMessage = (
  rec: InstanceRecord,
  owner: Component.DefinitionAny
): string => {
  const prefix = `${rec.path}/`;
  let sameName: InstanceRecord | undefined;
  for (const candidate of rec.kernel.records.values()) {
    if (candidate.status !== "live") {
      continue;
    }
    if (sharesOf(candidate.definition) === undefined) {
      continue;
    }
    if (!prefix.startsWith(`${candidate.path}/`)) {
      continue;
    }
    if (
      candidate.definition.name === owner.name &&
      (sameName === undefined || candidate.path.length > sameName.path.length)
    ) {
      sameName = candidate;
    }
  }
  return sameName === undefined
    ? `and no ${owner.name} is above it`
    : `but a different component with the same name is above it at ${sameName.path}`;
};

/**
 * What an owner shares: `shares.value(model, props, reads)` with the
 * owner's own reads resolved above it. Throws when the owner's `value`
 * throws; a missing required owner fails the reader first, at bind time.
 *
 * @internal
 */
export const ownerValueOf = (
  definition: Component.DefinitionAny,
  model: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- the owner's erased Model; the shares schema validates it at the boundary.
  props: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- the owner's erased props; the shares schema validates them at the boundary.
  lookup: (owner: Component.DefinitionAny) => unknown // oxlint-disable-line anti-slop/no-unknown-returns -- the lookup resolves the owner's erased value; the shares schema encodes it.
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- ownerValueOf resolves the owner's erased value; the shares schema encodes it.
): unknown => {
  const shares = sharesOf(definition);
  if (shares === undefined) {
    return undefined;
  }
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the reads record is heterogeneous by construction; each owner's schema states its contract.
  const out: Record<string, unknown> = {};
  for (const read of readsOf(definition)) {
    out[read.name] = lookup(read.owner);
  }
  return shares.value(model, props, out);
};

interface ReaderSlot {
  seen: Map<
    Component.DefinitionAny,
    { record: InstanceRecord; value: unknown }
  >;
}

const readerSlotOf = (rec: InstanceRecord): ReaderSlot => {
  // SAFETY: the kernel stores the reader's slot under this key after the first readsRecord; owners never write it.
  let slot = rec.extensions.get("shared.reader") as ReaderSlot | undefined;
  if (slot === undefined) {
    slot = { seen: new Map() };
    rec.extensions.set("shared.reader", slot);
  }
  return slot;
};

interface SharedQueue {
  rounds: InstanceRecord[];
  queuedRounds: Set<InstanceRecord>;
  dues: Set<InstanceRecord>;
  passes: Map<InstanceRecord, number>;
  scheduled: boolean;
}

const queues = new WeakMap<object, SharedQueue>();

const queueOf = (rec: InstanceRecord): SharedQueue => {
  const { kernel } = rec;
  let queue = queues.get(kernel);
  if (queue === undefined) {
    queue = {
      dues: new Set(),
      passes: new Map(),
      queuedRounds: new Set(),
      rounds: [],
      scheduled: false,
    };
    queues.set(kernel, queue);
  }
  return queue;
};

const maxRounds = 100;

const countPass = (
  passes: Map<InstanceRecord, number>,
  owner: InstanceRecord,
  where: "shares" | "send",
  message: string
): boolean => {
  const passed = (passes.get(owner) ?? 0) + 1;
  passes.set(owner, passed);
  if (passed <= maxRounds) {
    return true;
  }
  failOutside(owner, where, new Error(`${owner.path}${message}`));
  return false;
};

const readerRecords = function* readerRecords(
  owner: InstanceRecord
): Generator<InstanceRecord> {
  const prefix = `${owner.path}/`;
  for (const candidate of owner.kernel.records.values()) {
    if (candidate.status !== "live") {
      continue;
    }
    if (candidate === owner) {
      continue;
    }
    if (!candidate.path.startsWith(prefix)) {
      continue;
    }
    if (readsOf(candidate.definition).length === 0) {
      continue;
    }
    yield candidate;
  }
};
const matchOnChange = (
  owner: InstanceRecord,
  reader: InstanceRecord
):
  | {
      readonly read: ReadEntry;
      readonly onChange: NonNullable<ReadEntry["onChange"]>;
    }
  | undefined => {
  for (const read of readsOf(reader.definition)) {
    if (read.onChange === undefined) {
      continue;
    }
    if (read.owner !== owner.definition) {
      continue;
    }
    const bound = nearestOwner(reader, read.owner);
    if (
      bound === undefined ||
      bound._tag !== "owner" ||
      bound.record !== owner
    ) {
      continue;
    }
    return { onChange: read.onChange, read };
  }
  return undefined;
};

const roundReader = (
  owner: InstanceRecord,
  reader: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- roundReader carries the owner's erased value to the reader's onChange; the shares schema encodes it.
  value: unknown,
  seq: number,
  passes: Map<InstanceRecord, number>,
  counted: { current: boolean }
): boolean => {
  if (reader.status !== "live") {
    return true;
  }
  const matched = matchOnChange(owner, reader);
  if (matched === undefined) {
    return true;
  }
  // SAFETY: readerSlotOf is the sole writer of this key; a missing slot means the reader never bound.
  const readerSlot = reader.extensions.get("shared.reader") as
    | ReaderSlot
    | undefined;
  const previous = readerSlot?.seen.get(owner.definition);
  if (
    previous !== undefined &&
    previous.record === owner &&
    sharedEqual(previous.value, value)
  ) {
    return true;
  }
  if (!counted.current) {
    counted.current = true;
    if (
      !countPass(
        passes,
        owner,
        "shares",
        ` sent its readers' onChange or its own collects.onChange ${maxRounds} times in one flush. A reader whose onChange or report answers the shared value with a change of it loops: answer with a value that settles.`
      )
    ) {
      return false;
    }
  }
  readerSlot?.seen.set(owner.definition, { record: owner, value });
  let message: unknown;
  try {
    message = matched.onChange(value);
  } catch (error) {
    failOutside(reader, "shared", error);
    return true;
  }
  if (message !== undefined && reader.status === "live") {
    dispatch(
      reader,
      { _tag: "Shared", name: matched.read.name, path: owner.path, seq },
      message
    );
  }
  return owner.status === "live";
};

const roundOwner = (
  owner: InstanceRecord,
  passes: Map<InstanceRecord, number>
): void => {
  if (owner.status !== "live") {
    return;
  }
  // SAFETY: ownerSlotOf is the sole writer of this key; a missing slot means the value was never computed.
  const slot = owner.extensions.get("shared.owner") as OwnerSlot | undefined;
  if (slot === undefined || !slot.hasValue) {
    return;
  }
  const { value } = slot;
  const seq = slot.seq ?? -1;
  const counted = { current: false };
  // oxlint-disable-next-line unicorn/no-useless-spread -- the snapshot freezes the reader set; dispatch mounts records while rounding.
  for (const reader of [...readerRecords(owner)]) {
    if (!roundReader(owner, reader, value, seq, passes, counted)) {
      return;
    }
  }
};

/**
 * Whether a reader is hidden from collects: a kept (parked) child.
 * Parked readers contribute no reports while hidden.
 *
 * @internal
 */
export const isHiddenReader = (reader: InstanceRecord): boolean =>
  isKeptParked(reader);
const collectOwner = (
  owner: InstanceRecord,
  passes: Map<InstanceRecord, number>
): void => {
  const shares = sharesOf(owner.definition);
  if (shares?.collects === undefined) {
    return;
  }
  if (owner.status !== "live") {
    return;
  }
  const reports: unknown[] = [];
  // oxlint-disable-next-line unicorn/no-useless-spread -- the snapshot freezes the reader set; dispatch mounts records while collecting.
  for (const reader of [...readerRecords(owner)]) {
    if (reader.status !== "live") {
      continue;
    }
    if (isHiddenReader(reader)) {
      continue;
    }
    for (const read of readsOf(reader.definition)) {
      if (read.report === undefined) {
        continue;
      }
      if (read.owner !== owner.definition) {
        continue;
      }
      const found = nearestOwner(reader, read.owner);
      if (
        found === undefined ||
        found._tag !== "owner" ||
        found.record !== owner
      ) {
        continue;
      }
      try {
        reports.push(
          read.report(reader.model(), reader.props, reportIdOf(reader.path))
        );
      } catch (error) {
        failOutside(reader, "shared", error);
        return;
      }
    }
  }
  const slot = ownerSlotOf(owner);
  let message: unknown;
  try {
    if (!slot.hasCollected) {
      slot.collected = shares.collects.onChange([]);
      slot.hasCollected = true;
    }
    message = shares.collects.onChange(reports);
  } catch (error) {
    failOutside(owner, "shares", error);
    return;
  }
  if (slot.hasCollected && sharedEqual(slot.collected, message)) {
    return;
  }
  slot.collected = message;
  slot.hasCollected = true;
  if (
    !countPass(
      passes,
      owner,
      "shares",
      ` sent its readers' onChange or its own collects.onChange ${maxRounds} times in one flush. A reader whose onChange or report answers the shared value with a change of it loops: answer with a value that settles.`
    )
  ) {
    return;
  }
  dispatch(owner, { _tag: "Collected" }, message);
};

const scheduleShared = (rec: InstanceRecord): void => {
  const queue = queueOf(rec);
  if (queue.scheduled) {
    return;
  }
  queue.scheduled = true;
  queueMicrotask(() => {
    queue.scheduled = false;
    // oxlint-disable-next-line eslint/no-use-before-define -- runShared follows below so the queue drains before rescheduling; the microtask always runs after module evaluation.
    runShared(rec, queue);
  });
};

const runShared = (rec: InstanceRecord, queue: SharedQueue): void => {
  for (const owner of queue.rounds.splice(0)) {
    queue.queuedRounds.delete(owner);
    roundOwner(owner, queue.passes);
    if (owner.status !== "live") {
      continue;
    }
  }
  if (queue.rounds.length > 0) {
    scheduleShared(rec);
    return;
  }
  // oxlint-disable-next-line unicorn/no-useless-spread -- the snapshot freezes the due set; collectOwner deletes from it while running.
  for (const owner of [...queue.dues]) {
    queue.dues.delete(owner);
    collectOwner(owner, queue.passes);
  }
  queue.passes.clear();
};
const queueRound = (owner: InstanceRecord): void => {
  const queue = queueOf(owner);
  if (!queue.queuedRounds.has(owner)) {
    queue.queuedRounds.add(owner);
    queue.rounds.push(owner);
  }
  scheduleShared(owner);
};

const dueCollect = (owner: InstanceRecord): void => {
  const shares = sharesOf(owner.definition);
  if (shares?.collects === undefined) {
    return;
  }
  const queue = queueOf(owner);
  if (!queue.dues.has(owner)) {
    queue.dues.add(owner);
    scheduleShared(owner);
  }
};

// oxlint-disable-next-line anti-slop/no-unknown-returns -- ownerValueNow resolves the owner's cached or computed value; the shares schema encodes it.
const ownerValueNow = (owner: InstanceRecord): unknown => {
  // SAFETY: ownerSlotOf is the sole writer of this key; a missing slot means the value was never computed.
  const slot = owner.extensions.get("shared.owner") as OwnerSlot | undefined;
  if (slot !== undefined && slot.hasValue) {
    return slot.value;
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- ownerValueNow and computeOwnerValue recurse through the slot cache; neither can come first.
  return computeOwnerValue(owner);
};

// oxlint-disable-next-line anti-slop/no-unknown-returns -- computeOwnerValue resolves the owner's erased value; the shares schema encodes it.
const computeOwnerValue = (owner: InstanceRecord): unknown =>
  ownerValueOf(owner.definition, owner.model(), owner.props, (candidate) => {
    const found = nearestOwner(owner, candidate);
    if (found === undefined || found._tag === "other") {
      return;
    }
    return ownerValueNow(found.record);
  });
/**
 * Resolve one read for `rec`: the nearest live owner's current value, or
 * `undefined` for an absent optional owner. A missing required owner fails
 * the reader with the inventory's message. Touches the owner's signal so
 * the reader re-renders when the owner reports a new value.
 *
 * @internal
 */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- readOne resolves the owner's erased value; the shares schema encodes it.
export const readOne = (rec: InstanceRecord, read: ReadEntry): unknown => {
  const found = nearestOwner(rec, read.owner);
  if (found === undefined) {
    if (read.optional) {
      return undefined;
    }
    failOutside(
      rec,
      "shared",
      new Error(
        `${rec.path} reads the shared state of ${read.owner.name}, ${absentMessage(rec, read.owner)}`
      )
    );
    return undefined;
  }
  if (found._tag === "other") {
    if (read.optional) {
      return undefined;
    }
    failOutside(
      rec,
      "shared",
      new Error(
        `${rec.path} reads the shared state of ${read.owner.name}, ${absentMessage(rec, read.owner)}`
      )
    );
    return undefined;
  }
  const owner = found.record;
  if (!owner.fiber.closed) {
    owner.signal();
  }
  return ownerValueNow(owner);
};

/**
 * The shared values `h.reads`, `p.reads` and `$.reads` see: the owners'
 * values as this render (or update) runs. A reader that sends to its owner
 * still sees the old value in the same update. Records the binding's fresh
 * value without reporting it, and marks owners whose readers report for a
 * collects pass once the pass settles.
 *
 * @internal
 */
export const readsRecord = (rec: InstanceRecord): MessageLog.SharedRecord => {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the reads record is heterogeneous by construction; each owner's schema states its contract.
  const out: Record<string, unknown> = {};
  const slot = readerSlotOf(rec);
  for (const read of readsOf(rec.definition)) {
    const value = readOne(rec, read);
    out[read.name] = value;
    if (rec.status !== "live") {
      continue;
    }
    const found = nearestOwner(rec, read.owner);
    if (found !== undefined && found._tag === "owner") {
      const previous = slot.seen.get(read.owner);
      if (previous === undefined || previous.record !== found.record) {
        slot.seen.set(read.owner, { record: found.record, value });
      }
    }
    if (
      read.report !== undefined &&
      found !== undefined &&
      found._tag === "owner"
    ) {
      dueCollect(found.record);
    }
  }
  return out;
};

/**
 * Recompute an owner's shared value at render time, once its props are
 * final, so readers never see a value built from stale props. When the
 * value changed: store it, bump the owner's signal so subscribed readers
 * re-render, queue an `onChange` round, and mark collects due. A throw in
 * `shares.value` fails the instance with source `"shares"`.
 *
 * @internal
 */
export const refreshOwner = (
  rec: InstanceRecord,
  seq?: number | undefined
): void => {
  if (sharesOf(rec.definition) === undefined) {
    return;
  }
  let value: unknown;
  try {
    value = computeOwnerValue(rec);
  } catch (error) {
    failOutside(rec, "shares", error);
    return;
  }
  const slot = ownerSlotOf(rec);
  if (slot.hasValue && sharedEqual(slot.value, value)) {
    return;
  }
  slot.value = value;
  slot.hasValue = true;
  if (seq !== undefined) {
    slot.seq = seq;
  }
  if (!rec.fiber.closed) {
    rec.signal.update((n) => n + 1);
  }
  queueRound(rec);
};

/**
 * Mark the owners a rendering reader reports to for a collects pass once
 * the pass settles. Reports read the reader's latest Model and props.
 *
 * @internal
 */
export const dueReports = (rec: InstanceRecord): void => {
  if (rec.status !== "live") {
    return;
  }
  for (const read of readsOf(rec.definition)) {
    if (read.report === undefined) {
      continue;
    }
    const found = nearestOwner(rec, read.owner);
    if (found !== undefined && found._tag === "owner") {
      dueCollect(found.record);
    }
  }
};

/**
 * The baseline a collects comparison starts from: `onChange([])` at owner
 * mount, so the first reports send only when they differ from empty.
 *
 * @internal
 */
export const baselineCollects = (rec: InstanceRecord): void => {
  const shares = sharesOf(rec.definition);
  if (shares?.collects === undefined) {
    return;
  }
  const slot = ownerSlotOf(rec);
  try {
    slot.collected = shares.collects.onChange([]);
    slot.hasCollected = true;
  } catch (error) {
    failOutside(rec, "shares", error);
  }
};

/**
 * Apply the `$.send` calls of one update, in issue order, after the Model
 * is set and before emits are delivered. More than 100 send rounds from one
 * sender in one flush fails the sender. Sends to an absent optional owner
 * are dropped and logged `SendDropped`; sends to an absent required owner
 * fail the sender with the inventory's message.
 *
 * @internal
 */
export const applySends = (
  rec: InstanceRecord,
  sends: readonly Component.StepSend[],
  seq: number,
  counts: Map<InstanceRecord, number>,
  deliver: (owner: InstanceRecord, message: unknown) => void // oxlint-disable-line anti-slop/no-unknown-parameters -- the delivered send payload is validated by the receiving owner's update at run time.
): void => {
  if (sends.length === 0) {
    return;
  }
  const passed = (counts.get(rec) ?? 0) + 1;
  counts.set(rec, passed);
  if (passed > maxRounds) {
    failOutside(
      rec,
      "send",
      new Error(
        `${rec.path} sent to its owners ${maxRounds} times in one flush. Updates that answer each other loop: answer a send with state, or send from a user event.`
      )
    );
    return;
  }
  for (const [index, send] of sends.entries()) {
    if (rec.status !== "live") {
      return;
    }
    // `$.send` takes the owner component; resolve the wrapper to its
    // definition, which is what the lookup and the log compare by. The
    // Schema generics erase at runtime, as they do for every record.
    // SAFETY: authors send to real components; the erased definition names the owner the lookup compares by.
    const target: Component.DefinitionAny =
      send.owner === "self"
        ? rec.definition
        : (send.owner.definition as Component.DefinitionAny);
    const found = nearestOwner(rec, target);
    if (found !== undefined && found._tag === "owner") {
      deliver(found.record, send.message);
      continue;
    }
    const optional = readsOf(rec.definition).some(
      (read) => read.optional && read.owner === target
    );
    if (optional) {
      if (kernelHasLog(rec.kernel)) {
        recordEntry(rec, {
          _tag: "SendDropped",
          issued: { index, seq },
          owner: target.name,
        });
      }
      continue;
    }
    failOutside(
      rec,
      "send",
      new Error(
        `${rec.path} sent to ${target.name}, ${absentMessage(rec, target)}`
      )
    );
    return;
  }
};

/**
 * Forget shared slice state when a record closes: readers drop their seen
 * values, owners leave the lookup (they are gone from `kernel.records`
 * already). Queued rounds and dues for a closed owner are skipped when
 * they run.
 *
 * @internal
 */
export const leaveShared = (rec: InstanceRecord): void => {
  rec.extensions.delete("shared.reader");
  rec.extensions.delete("shared.owner");
};
