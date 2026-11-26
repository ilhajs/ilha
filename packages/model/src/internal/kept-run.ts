/**
 * Keep-alive children: `h.keepAlive` and `h.keepAlive(alive, scope)`.
 * Children called with the scope `s` live as long as the author, parking
 * (subscriptions stopped, records kept) when they leave the view and
 * rebinding when drawn again. With a predicate, `alive` is asked on every
 * author render for each kept child.
 *
 * @internal
 */
import type { View, VNode } from "ilha";

import type * as Component from "../component.ts";
import type { InstanceRecord } from "./kernel.ts";
import type * as Kernel from "./kernel.ts";
import { definitionNameOf, segmentOf } from "./paths.ts";

// Set once by the kernel module, which owns recording and teardown.
let kernelHasLog: typeof Kernel.kernelHasLog = () => false;
let parkSubscriptions: typeof Kernel.parkSubscriptions = () => {
  throw new Error("kept-run used before the kernel bound parkSubscriptions");
};
let recordEntry: typeof Kernel.recordEntry = () => {
  // The kernel binds the recorder before first render.
};

/**
 * Give keep-alive the kernel's recording and teardown. Called once by the
 * kernel module.
 *
 * @internal
 */
export const bindKeptRunKernel = (hooks: {
  readonly kernelHasLog: typeof Kernel.kernelHasLog;
  readonly parkSubscriptions: typeof Kernel.parkSubscriptions;
  readonly recordEntry: typeof Kernel.recordEntry;
}): void => {
  ({ kernelHasLog, parkSubscriptions, recordEntry } = hooks);
};

// Set once by the kernel module, which owns record closing.
let closeKept: (rec: InstanceRecord) => void = () => {
  // The kernel binds the real closer before first render.
};

/**
 * Give keep-alive the kernel's record closer. Called once by the kernel
 * module.
 *
 * @internal
 */
export const bindKeepAliveCloser = (
  close: (rec: InstanceRecord) => void
): void => {
  closeKept = close;
};
// Set once by the kernel module, which owns failure rendering.
// oxlint-disable-next-line anti-slop/no-unknown-returns -- unreachable before the kernel binds failKept; the throw matches the dispatch default.
let failKept: (author: InstanceRecord, cause: unknown) => unknown = () => {
  throw new Error("kept-run used before the kernel bound failKept");
};

/**
 * Give keep-alive the kernel's failure renderer. Called once by the kernel
 * module.
 *
 * @internal
 */
export const bindKeepAliveFail = (
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the kernel's failure renderer returns the failure view; kept-run only forwards it.
  fail: (author: InstanceRecord, cause: unknown) => unknown
): void => {
  failKept = fail;
};

// Set once by the kernel module, which owns the core `h`.
let coreH: ((...args: readonly unknown[]) => VNode) | undefined;

/**
 * Give keep-alive scopes the core `h` they tag vnodes with. Called once
 * by the kernel module.
 *
 * @internal
 */
export const bindKeepAliveH = (
  h: (...args: readonly unknown[]) => VNode
): void => {
  coreH = h;
};

/** A predicate `h.keepAlive(alive, scope)` asks per kept child. */
export type AlivePredicate = (input: {
  readonly key: string;
  readonly model: unknown;
  readonly props: unknown;
  readonly queries: unknown;
}) => boolean;

interface KeepTag {
  readonly alive: AlivePredicate | undefined;
}

const tags = new WeakMap<object, KeepTag>();

/**
 * Whether the vnode was written through the author's keep-alive scope.
 *
 * @internal
 */
export const keptTagOf = (vnode: VNode): KeepTag | undefined => tags.get(vnode);

interface KeptEntry {
  rec: InstanceRecord | undefined;
  parked: boolean;
  alive: AlivePredicate | undefined;
  key: string;
}

interface KeepTable {
  readonly entries: Map<string, KeptEntry>;
  used: boolean;
}

const tableOf = (author: InstanceRecord): KeepTable => {
  // SAFETY: keep-alive tables are written only here; the key's presence proves the shape.
  let table = author.extensions.get("keepAlive") as KeepTable | undefined;
  if (table === undefined) {
    table = { entries: new Map(), used: false };
    author.extensions.set("keepAlive", table);
    author.onClose.push(() => {
      // SAFETY: the closer runs under the same table contract; absence means the table was already cleared.
      const kept = author.extensions.get("keepAlive") as KeepTable | undefined;
      if (kept === undefined) {
        return;
      }
      for (const entry of kept.entries.values()) {
        if (entry.rec !== undefined && entry.rec.status === "live") {
          closeKept(entry.rec);
        }
      }
      kept.entries.clear();
    });
  }
  return table;
};
/** Mark the author as using keep-alive, so `processKept` parks its children. */
const markKeepAliveUsed = (author: InstanceRecord): void => {
  tableOf(author).used = true;
};

const isVNode = (node: unknown): node is VNode => {
  if (typeof node !== "object" || node === null) {
    return false;
  }
  if (!("$$ilha" in node)) {
    return false;
  }
  // SAFETY: the $$ilha brand is written only by the core h; equality with 1 proves a VNode.
  return (node as { readonly $$ilha?: unknown }).$$ilha === 1;
};

/**
 * Fail the author when one render writes the same child through both `h`
 * and `s`. Each kept vnode's segment must not collide with an untagged
 * vnode's segment under the same writer and tree parent (the same path,
 * which the duplicate check would otherwise report generically).
 *
 * @internal
 */
export const checkKeepAliveDouble = (
  author: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the double-write walk accepts any view tree; leaves are rejected during the visit.
  view: unknown,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- the writer map is keyed by vnode brand; the walk only reads the brand.
  writtenBy: (vnode: object) => InstanceRecord | undefined
): void => {
  const seen = new Map<string, boolean>();
  const parentIds = new Map<VNode, number>();
  let parentCount = 0;
  const parentKey = (parent: VNode | null): string => {
    if (parent === null) {
      return "";
    }
    let id = parentIds.get(parent);
    if (id === undefined) {
      id = parentCount;
      parentCount += 1;
      parentIds.set(parent, id);
    }
    return `#${id}`;
  };
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the walk descends into arbitrary nested view trees; leaves are rejected below.
  const visit = (node: unknown, parent: VNode | null): void => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- view leaves arrive untyped; the brand test below establishes the contract.
    if (node === null || node === undefined || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, parent);
      }
      return;
    }
    if (!isVNode(node)) {
      return;
    }
    // SAFETY: isVNode proves the Ilha brand; component vnodes carry type, props and children.
    const vnode = node as VNode;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- component and host vnodes differ only by representation; the name lookup validates it.
    if (typeof vnode.type === "function") {
      const name = definitionNameOf(vnode.type);
      if (name !== undefined) {
        const key =
          vnode.key === null || vnode.key === undefined
            ? ""
            : String(vnode.key);
        const writer = writtenBy(vnode) ?? author;
        const id = writer.path + parentKey(parent) + segmentOf(name, key);
        const tagged = keptTagOf(vnode) !== undefined;
        const previous = seen.get(id);
        if (previous !== undefined && previous !== tagged) {
          throw new Error(
            `${writer.path} writes ${segmentOf(name, key)} twice in one render`
          );
        }
        seen.set(id, tagged);
      }
      // SAFETY: component props are a decoded bag; slots are visited structurally below.
      const { slots } = vnode.props as { readonly slots?: unknown };
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- slots arrive untyped from the author; the object branch visits their values below.
      if (slots !== null && typeof slots === "object") {
        // SAFETY: slots validated as an object above; values are visited as view nodes.
        // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- slot values are untyped view nodes by contract; the walk rejects leaves.
        for (const content of Object.values(slots as Record<string, unknown>)) {
          visit(content, vnode);
        }
      }
      for (const child of vnode.children) {
        visit(child, vnode);
      }
      return;
    }
    for (const child of vnode.children) {
      visit(child, parent);
    }
  };
  visit(view, null);
};

/**
 * `h.keepAlive`: children called with `s` live as long as the author.
 * With a predicate, `alive({model, props, queries, key})` is asked on
 * every author render for each kept child; it must read the model, props
 * or queries from its argument. Keys must be literal (non-empty strings;
 * a missing key fails the author).
 *
 * @internal
 */
export const keepAliveHelper = (
  author: InstanceRecord
): Component.KeepAlive => {
  const keepAlive = (
    aliveOrScope: AlivePredicate | ((s: Component.KeepAliveScope) => View),
    scope?: (s: Component.KeepAliveScope) => View
  ): View => {
    // SAFETY: a defined scope means the first argument is the predicate; the kernel asks it per kept child.
    const alive =
      scope === undefined ? undefined : (aliveOrScope as AlivePredicate);
    // SAFETY: without a scope the first argument is the scope runner; it receives the tagging scope below.
    const run =
      scope === undefined
        ? (aliveOrScope as (s: Component.KeepAliveScope) => View)
        : scope;
    markKeepAliveUsed(author);
    const h = coreH;
    if (h === undefined) {
      throw new Error("keep-alive used before the kernel bound h");
    }
    // SAFETY: the scope only tags vnodes the core h builds; processKept reads the tag.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the tagging closure overlaps KeepAliveScope only through unknown; the kernel calls it as h.
    const s = ((...args: readonly unknown[]): VNode => {
      const vnode = h(...args);
      tags.set(vnode, { alive });
      return vnode;
    }) as unknown as Component.KeepAliveScope;
    return run(s);
  };
  // SAFETY: keepAlive implements the KeepAlive call contract above; the cast only names it for the public type.
  return keepAlive as Component.KeepAlive;
};

interface KeptCall {
  readonly name: string;
  readonly key: string;
  readonly path: string;
  readonly vnode: VNode;
}

const askAlive = (author: InstanceRecord, entry: KeptEntry): boolean => {
  const { alive } = entry;
  if (alive === undefined) {
    return true;
  }
  let read = false;
  const watched = {
    key: entry.key,
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- the predicate reads the model as unknown; the getter marks the read.
    get model(): unknown {
      read = true;
      return author.model();
    },
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- the predicate reads props as unknown; the getter marks the read.
    get props(): unknown {
      read = true;
      return author.props;
    },
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- the predicate reads query results as unknown; the getter marks the read.
    get queries(): unknown {
      read = true;
      // SAFETY: query results are stored under this key by the kernel; absence means no queries ran.
      const stored = author.extensions.get("queries") as
        | { readonly results?: unknown }
        | undefined;
      return stored?.results;
    },
  };
  let result = false;
  try {
    result = alive(watched);
  } catch (error) {
    failKept(author, error);
    return false;
  }
  if (!read) {
    failKept(
      author,
      new Error(
        `${author.path}: an h.keepAlive predicate reads the Model from its argument: ({ model, key }) => key in model.items`
      )
    );
    return false;
  }
  return result;
};

const dropEntry = (
  author: InstanceRecord,
  segment: string,
  entry: KeptEntry
): void => {
  // SAFETY: the table contract from tableOf; absence means the author closed without kept children.
  const table = author.extensions.get("keepAlive") as KeepTable | undefined;
  table?.entries.delete(segment);
  const { rec } = entry;
  if (rec !== undefined && rec.status === "live") {
    rec.extensions.delete("kept.entry");
    closeKept(rec);
  }
};

/** Park kept children that left the view and rebind still-drawn records. */
const parkAbsent = (
  author: InstanceRecord,
  table: KeepTable,
  bySegment: ReadonlyMap<string, KeptCall>
): void => {
  for (const [segment, entry] of table.entries) {
    const call = bySegment.get(segment);
    if (call !== undefined && keptTagOf(call.vnode) !== undefined) {
      const rec = author.kernel.records.get(call.path);
      if (rec !== undefined && rec.status === "live") {
        entry.rec = rec;
      }
      // A redraw through `s` rebinds in `renderModelComponent` (which
      // clears the park marker and logs `Drawn`): clearing it here would
      // make the rebind miss and mount fresh.
      continue;
    }
    if (call !== undefined) {
      // The segment is drawn, but not through `s`: a plain render keeps
      // the instance without parking it.
      const rec = author.kernel.records.get(call.path);
      if (rec !== undefined && rec.status === "live") {
        entry.rec = rec;
      }
      continue;
    }
    if (entry.alive !== undefined && !askAlive(author, entry)) {
      dropEntry(author, segment, entry);
      continue;
    }
    const rec = entry.rec ?? author.kernel.records.get(author.path + segment);
    if (rec === undefined || rec.status !== "live") {
      table.entries.delete(segment);
      continue;
    }
    entry.rec = rec;
    if (!entry.parked) {
      entry.parked = true;
      rec.extensions.set("kept.entry", entry);
      parkSubscriptions(rec);
      if (kernelHasLog(author.kernel)) {
        recordEntry(rec, { _tag: "Kept" });
      }
    }
  }
};

/** Note drawn kept children, failing the author on a missing literal key. */
const noteDrawn = (
  author: InstanceRecord,
  table: KeepTable,
  calls: readonly KeptCall[]
): void => {
  for (const call of calls) {
    if (keptTagOf(call.vnode) === undefined) {
      continue;
    }
    const segment = call.path.slice(author.path.length);
    if (call.key === "") {
      failKept(
        author,
        new Error(`${author.path}: h.keepAlive children need a literal key`)
      );
      return;
    }
    let entry = table.entries.get(segment);
    if (entry === undefined) {
      entry = {
        alive: keptTagOf(call.vnode)?.alive,
        key: call.key,
        parked: false,
        rec: undefined,
      };
      table.entries.set(segment, entry);
    }
    const rec = author.kernel.records.get(call.path);
    if (rec !== undefined && rec.status === "live" && entry.rec === undefined) {
      entry.rec = rec;
    }
  }
};

/**
 * After the author's walk, park kept children that left the view and note
 * drawn ones. Kept paths join the author's close-diff `seen` set through
 * {@link keptPaths}.
 *
 * @internal
 */
export const processKept = (
  author: InstanceRecord,
  calls: readonly KeptCall[]
): void => {
  // SAFETY: the table contract from tableOf; absence means the author never used keep-alive.
  const table = author.extensions.get("keepAlive") as KeepTable | undefined;
  if (table === undefined || !table.used) {
    return;
  }
  const bySegment = new Map<string, KeptCall>();
  for (const call of calls) {
    bySegment.set(call.path.slice(author.path.length), call);
  }
  parkAbsent(author, table, bySegment);
  noteDrawn(author, table, calls);
};

/**
 * Paths the author's close-diff must not close: kept children absent from
 * this walk but parked by a predicate (or an unconditional scope they
 * left).
 *
 * @internal
 */
export const keptPaths = (author: InstanceRecord): Set<string> => {
  const out = new Set<string>();
  // SAFETY: the table contract from tableOf; absence means the author never used keep-alive.
  const table = author.extensions.get("keepAlive") as KeepTable | undefined;
  if (table === undefined) {
    return out;
  }
  for (const [segment, entry] of table.entries) {
    if (entry.rec !== undefined && entry.rec.status === "live") {
      out.add(author.path + segment);
    }
  }
  return out;
};

/**
 * Whether a record owns keep-alive state: parked entries or a keep table.
 * The kernel consults this before walking kept children.
 *
 * @internal
 */
export const keepsAlive = (rec: InstanceRecord): boolean =>
  rec.extensions.has("keepAlive") || rec.extensions.has("kept.entry");

/**
 * Whether a parked record may still take messages: kept children stay
 * live past their fiber's close and react when drawn again.
 *
 * @internal
 */
export const isKeptParked = (rec: InstanceRecord): boolean => {
  // SAFETY: parked records carry their entry under this key; absence means never parked.
  const entry = rec.extensions.get("kept.entry") as KeptEntry | undefined;
  return entry !== undefined && entry.parked;
};
