/**
 * The mounts slice behind Scene's `mounted` and `expectMount`: `h.mount`
 * records every issued mount per render, and steps settle or acknowledge
 * them. A render without a running mount stops it; removing one nothing
 * acknowledged throws. Stream mounts take one value per `mounted` step
 * and never end that way.
 */
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";

import * as Mount from "../mount.ts";
import type { Engine } from "./engine.ts";
import type { Slices } from "./parts.ts";
import type { MountTarget } from "./scene.ts";
import { registerTestExtension } from "./steps.ts";
import type { ExtensionContext } from "./steps.ts";

/** One mount the current view declares. */
export interface MountEntry {
  readonly issued: Mount.Any;
  readonly path: string;
  acked: boolean;
  ended: boolean;
}

/** The mounts slice's engine state, under `slices["mounts"]`. */
export interface MountsState {
  /** Mounts the latest render declares, in order. */
  readonly running: MountEntry[];
  /** Issued mounts recorded during the render in progress. */
  readonly issuing: Mount.Any[];
}

const freshState = (): MountsState => ({ issuing: [], running: [] });

/** Whether `value` is a non-null object. */
const isObject = <T>(value: T): value is T & object =>
  typeof value === "object" && value !== null;

/** Whether `value` can be called. The result type is set by inference at each use. */
const isCallable = <T, R>(
  value: T
): value is T & ((...args: readonly unknown[]) => R) =>
  typeof value === "function";

/** The mount a ref was created for, or `undefined`. */
const mountOfRef = <T extends object>(ref: T): Mount.Any | undefined => {
  if ("~ilha/model/mount" in ref) {
    const issued = ref["~ilha/model/mount"];
    return Mount.isMount(issued) ? issued : undefined;
  }
  return undefined;
};

/** The slice's view of an engine: its slice table. */
interface Host {
  readonly slices: Slices;
  readonly module?: string | undefined;
}

/** Reads the slice table off an engine. */
const hostOf = (engine: {
  readonly state: { readonly slices: Readonly<Slices> };
}): Host => ({
  // SAFETY: extension callbacks expose the engine's live slice table as readonly; the mounts slice owns its entry.
  slices: engine.state.slices as Slices,
});

/** The mounts slice's state, creating it on first use. */
const mountsStateOf = (slices: Slices): MountsState => {
  // SAFETY: a present "mounts" entry was stored as MountsState below; absent entries are created now.
  const existing = slices["mounts"] as MountsState | undefined;
  if (existing !== undefined) {
    return existing;
  }
  const state = freshState();
  slices["mounts"] = state;
  return state;
};

/** Compares mount args with the args Schema equivalence, structurally otherwise. */
const argsEqual = (
  issued: Mount.Any,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- mount args are arbitrary user values; compared with the mount's own schema equivalence.
  args: unknown
): boolean => {
  try {
    // SAFETY: argsSchema is the schema this mount was issued with; the equivalence compares its decoded args.
    const equivalence = Schema.toEquivalence(
      issued.argsSchema as Schema.Schema<never>
    ) as (left: never, right: never) => boolean;
    // SAFETY: the equivalence takes the mount's own decoded args; never only satisfies its erased parameter types.
    return equivalence(issued.args as never, args as never);
  } catch {
    return Equal.equals(issued.args, args);
  }
};

/** Whether a running mount matches a `mounted`/`expectMount` target. */
const matchesMount = (issued: Mount.Any, target: MountTarget): boolean => {
  if (Mount.isDefinition(target)) {
    return issued.name === target.name;
  }
  if (!Mount.isMount(target)) {
    return false;
  }
  return issued.name === target.name && argsEqual(issued, target.args);
};

/** A readable name for a target in failures. */
const describeMount = (target: MountTarget): string => {
  if (Mount.isDefinition(target)) {
    return `the mount "${target.name}"`;
  }
  if (Mount.isMount(target)) {
    return `the mount "${target.name}(${JSON.stringify(target.args)})"`;
  }
  return "a mount";
};

/** Every issued mount the view places, in document order. */
const collectMountRefs = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- views nest arbitrary values; visit narrows each node below.
  view: unknown,
  refs: readonly Mount.Any[]
): readonly Mount.Any[] => {
  const out: Mount.Any[] = [];
  const visit = (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- view nodes nest arbitrary values; narrowed with `in`, Array.isArray and isCallable below.
    node: unknown
  ): void => {
    if (!isObject(node)) {
      return;
    }
    if ("$$ilha" in node || "props" in node || "children" in node) {
      if (
        "props" in node &&
        isObject(node.props) &&
        "ref" in node.props &&
        isCallable(node.props.ref)
      ) {
        const issued = mountOfRef(node.props.ref);
        if (issued !== undefined && refs.includes(issued)) {
          out.push(issued);
        }
      }
      if ("children" in node && node.children !== undefined) {
        visit(node.children);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (Symbol.iterator in node && isCallable(node[Symbol.iterator])) {
      // SAFETY: the callable Symbol.iterator makes this an iterable of child views; scenes only place views here.
      for (const item of node as Iterable<unknown>) {
        visit(item);
      }
    }
  };
  visit(view);
  return out;
};

/** Collects the latest render's mounts and reconciles stopped ones. */
export const refreshMounts = (
  engine: Engine,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the latest render's view nests arbitrary values; collectMountRefs narrows each node.
  view: unknown
): void => {
  // SAFETY: slices holds one state per slice name; the "mounts" entry is created as MountsState in mountsStateOf.
  const state = mountsStateOf(engine.state.slices as Slices);
  const refs = state.issuing.splice(0);
  const found = collectMountRefs(view, refs);
  const next: MountEntry[] = [];
  for (const issued of found) {
    const kept = state.running.find(
      (entry) =>
        !entry.ended &&
        entry.issued.name === issued.name &&
        Equal.equals(entry.issued.args, issued.args)
    );
    next.push(kept ?? { acked: false, ended: false, issued, path: "" });
  }
  for (const entry of state.running) {
    if (entry.ended || next.includes(entry)) {
      continue;
    }
    if (!entry.acked) {
      throw new Error(
        `${engine.module}.mounts: the step removed the mount "${entry.issued.name}" nothing acknowledged: settle it with mounted or acknowledge it with expectMount`
      );
    }
  }
  const ended = state.running.filter(
    (entry) => entry.ended && !next.includes(entry)
  );
  state.running.length = 0;
  state.running.push(...next, ...ended);
};

/** Ends the one matching mount and sends the view's mapped message. */
export const mountMounted = (
  engine: Engine,
  step: string,
  target: MountTarget,
  result: readonly unknown[]
): void => {
  // SAFETY: slices holds one state per slice name; the "mounts" entry is created as MountsState in mountsStateOf.
  const state = mountsStateOf(engine.state.slices as Slices);
  const matches = state.running.filter(
    (entry) => !entry.ended && matchesMount(entry.issued, target)
  );
  if (matches.length === 0) {
    const names = state.running
      .filter((entry) => !entry.ended)
      .map((entry) => entry.issued.name);
    throw new Error(
      `${step}: no running mount matches ${describeMount(target)}${
        names.length === 0
          ? `: the view declares no mounts`
          : `; running mounts:\n  - ${names.join("\n  - ")}`
      }`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${step}: several mounts match ${describeMount(target)}: match the args as well, as mounted takes them`
    );
  }
  // SAFETY: the two checks above leave exactly one match.
  const entry = matches[0] as MountEntry;
  if (result.length === 0) {
    throw new Error(
      `${step}: mounted takes the mount's result: ${describeMount(target)} ends with one value`
    );
  }
  let message: unknown;
  try {
    // SAFETY: mounted takes this mount's result; resolve maps the mount's own result type.
    message = entry.issued.resolve(result[0] as never);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${step}: resolving ${describeMount(target)} threw: ${messageText}`,
      { cause: error }
    );
  }
  if (!entry.issued.stream) {
    entry.ended = true;
  }
  engine.deliver(message);
};

/** Acknowledges exactly one running mount as intentionally pending. */
export const mountExpectMount = (
  engine: Engine,
  step: string,
  target: MountTarget
): void => {
  // SAFETY: slices holds one state per slice name; the "mounts" entry is created as MountsState in mountsStateOf.
  const state = mountsStateOf(engine.state.slices as Slices);
  const matches = state.running.filter(
    (entry) => !entry.ended && matchesMount(entry.issued, target)
  );
  if (matches.length === 0) {
    throw new Error(
      `${step}: no running mount matches ${describeMount(target)}: only a running mount can be acknowledged`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${step}: several mounts match ${describeMount(target)}: match the args as well, as expectMount takes them`
    );
  }
  // SAFETY: the two checks above leave exactly one match.
  const entry = matches[0] as MountEntry;
  entry.acked = true;
};

/** Work in flight blocking a message step: unacknowledged running mounts. */
export const mountInFlight = (host: Host): readonly string[] =>
  mountsStateOf(host.slices)
    .running.filter((entry) => !entry.ended && !entry.acked)
    .map(
      (entry) =>
        `the mount "${entry.issued.name}" is running: settle it with mounted or acknowledge it with expectMount`
    );

/** Every pending mount item, kept or acknowledged: the end check and `given` can't leave it. */
export const mountAllPending = (host: Host): readonly string[] =>
  mountsStateOf(host.slices)
    .running.filter((entry) => !entry.ended)
    .map((entry) => `the mount "${entry.issued.name}" is still running`);

/** Registers the mounts slice's checks and `h.mount` helper with the engine. */
export const registerMountsSlice = (): void => {
  registerTestExtension({
    allPending: (state) => mountAllPending(hostOf(state)),
    checkGiven: (state) => mountAllPending(hostOf(state)),
    helper: (ctx: ExtensionContext) => ({
      mount: (issued: Mount.Any) => {
        // SAFETY: the mounts extension owns the "mounts" entry; it starts empty on first use.
        const existing = ctx.slice("mounts") as MountsState | undefined;
        const state = existing ?? freshState();
        if (existing === undefined) {
          ctx.setSlice("mounts", state);
        }
        state.issuing.push(issued);
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- each mount needs its own ref identity; hoisting would share the mount field across mounts.
        const ref = (): void => {
          // Each mount needs its own ref identity for collectMountRefs.
        };
        return Object.assign(ref, { "~ilha/model/mount": issued });
      },
    }),
    inFlight: (state) => mountInFlight(hostOf(state)),
    name: "mounts",
  });
};
