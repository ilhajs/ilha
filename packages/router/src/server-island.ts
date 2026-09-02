/**
 * Client-side proxies for islands defined in server-only modules
 * (`*.server.ts(x)`).
 *
 * The real island never ships to the browser — it closes over server code.
 * The Vite plugin rewrites client-graph imports of island exports to this
 * factory, wiring each stream/action key to the tacho stub of the exported
 * function it calls. The proxy is a branded ilha island so composition
 * (`<Tasks />` inside a parent render) works unchanged:
 *
 * - SSR (server graph): imports resolve to the REAL module — no proxies.
 * - Hydration (client): `mount` seeds state from `data-ilha-state`, preserves
 *   the SSR DOM, resumes streams through the wired stubs, and reconnects
 *   `[data-ilha-on]` event sentinels to named actions using the
 *   `data-ilha-actions` manifest emitted by `hydratable()`.
 */

import { applyHeadEntriesToDocument } from "./head";
import type { HeadInput } from "./head";
import { parseSnapshotAttr } from "./snapshot";

/** Symbol.for keeps brands stable across duplicate ilha copies in one realm. */
const ISLAND = Symbol.for("ilha.island");
const ISLAND_SLOT_TAG = Symbol.for("ilha.islandSlotTag");
const ISLAND_MOUNT_INTERNAL = Symbol.for("ilha.islandMountInternal");
const ISLAND_CALL = Symbol.for("ilha.islandCall");

const STATE_ATTR = "data-ilha-state";
const EVENT_SENTINEL_ATTR = "data-ilha-on";
const ACTIONS_ATTR = "data-ilha-actions";
const PROPS_ATTR = "data-ilha-props";
const CLIENT_REF_ATTR = "data-ilha-client-ref";

const moduleRepaints = new Map<string, Set<() => void>>();

/** @internal Repaint every mounted island from the same `*.server` module. */
export function __ilhaRepaintServerModule(moduleKey: string): void {
  for (const repaint of moduleRepaints.get(moduleKey) ?? []) repaint();
}

function linkServerModuleRepaints(moduleKey: string, repaint: () => void): () => void {
  let set = moduleRepaints.get(moduleKey);
  if (!set) {
    set = new Set();
    moduleRepaints.set(moduleKey, set);
  }
  set.add(repaint);
  return () => {
    set!.delete(repaint);
    if (set!.size === 0) moduleRepaints.delete(moduleKey);
  };
}

export type ServerStreamFn = (signal: AbortSignal) => AsyncGenerator<unknown> | Generator<unknown>;

export interface ServerIslandWiring {
  /** Stream key → client transport. The plugin wires these to tacho stubs. */
  streams?: Record<string, ServerStreamFn>;
  /** Action key → client transport. Event payloads are not serializable;
   * handlers receive `undefined` and should read island state instead. */
  actions?: Record<string, (payload?: unknown) => unknown>;
  /** Frame transport: re-renders the island with the latest parent props. */
  frame?: (props?: Record<string, unknown>) => unknown;
  /** Client-capable islands nested in the server render, keyed by opaque ref. */
  children?: Record<string, unknown>;
}

export interface ServerIslandHandle {
  unmount: () => void;
  updateProps: (props?: Record<string, unknown>) => void;
}

/** @internal Apply head entries returned with a server-page frame. */
export function __ilhaApplyHead(entries: unknown): void {
  if (Array.isArray(entries)) applyHeadEntriesToDocument(entries as HeadInput[]);
}

/** Defensive snapshot parse — reuses the shared guarded parser (size cap,
 * plain-object check, depth cap, prototype-key stripping). */
function assertValidTag(tag: string): string {
  const trimmed = tag.trim();
  if (/^[a-z][a-z0-9-]*$/i.test(trimmed)) return trimmed.toLowerCase();
  return "div";
}

/** True when `candidate` is owned by `host`: walking up must not cross another
 * island or slot boundary before reaching it. */
function belongsToHost(host: Element, candidate: Element): boolean {
  let el: Element | null = candidate.parentElement;
  while (el && el !== host) {
    if (el.hasAttribute("data-ilha")) return false;
    // Stream holes use display:contents + data-ilha-slot; nested island slots do not.
    if (el.hasAttribute("data-ilha-slot") && (el as HTMLElement).style.display !== "contents") {
      return false;
    }
    el = el.parentElement;
  }
  return el === host;
}

/** Dev cold-start can race a warming `virtual:oxide/actions` graph — retry briefly. */
async function startServerStream(
  fn: ServerStreamFn,
  signal: AbortSignal,
): Promise<{
  gen: AsyncGenerator<unknown> | Generator<unknown>;
  first: IteratorResult<unknown, unknown>;
}> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal.aborted) {
      throw last ?? new DOMException("The operation was aborted.", "AbortError");
    }
    let gen: AsyncGenerator<unknown> | Generator<unknown> | undefined;
    try {
      gen = await fn(signal);
      // Async `function*` bodies run on the first `next()`, so cold RPC
      // failures surface here — keep that read inside the retry boundary.
      const first = await gen.next();
      return { gen, first };
    } catch (err) {
      last = err;
      if (gen) void Promise.resolve(gen.return?.(undefined)).catch(() => {});
      if (signal.aborted) throw err;
      const msg = String(err);
      if (!msg.includes("404") && !msg.includes("503")) throw err;
      if (attempt === 3) throw err;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          },
          50 * (attempt + 1),
        );
        const onAbort = () => {
          clearTimeout(timer);
          reject(err);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    }
  }
  throw last;
}

function hydrateServerIsland(
  host: Element,
  id: string,
  wiring: ServerIslandWiring,
  props?: Record<string, unknown>,
  moduleKey?: string,
): ServerIslandHandle {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  cleanups.push(() => controller.abort());

  // Seed state from the SSR snapshot. Stream pushes overwrite these keys;
  // frames re-render from the latest values.
  const state: Record<string, unknown> = {};
  const rawState = host.getAttribute(STATE_ATTR);
  if (rawState) {
    const parsed = parseSnapshotAttr(rawState);
    if (parsed) {
      for (const [key, value] of Object.entries(parsed)) {
        if (!key.startsWith("_")) state[key] = value;
      }
    }
  }

  // Serialized repaint queue — frames must apply in push order even when
  // several arrive back-to-back.
  const frame = wiring.frame;
  let currentProps = props;
  let repaintChain: Promise<void> = Promise.resolve();
  const scheduleRepaint = (): void => {
    if (!frame || controller.signal.aborted) return;
    const sent = currentProps;
    repaintChain = repaintChain
      .then(async () => {
        if (controller.signal.aborted || !host.isConnected) return;
        const html = await frame(sent);
        if (controller.signal.aborted || typeof html !== "string") return;
        const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
        host.replaceChildren(...Array.from(parsed.body.firstElementChild?.childNodes ?? []));
        syncChildren();
        wireEvents();
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error(`[ilha-router] frame render failed for "${id}":`, err);
        }
      });
  };
  const repaintModule = (): void => {
    if (moduleKey) __ilhaRepaintServerModule(moduleKey);
    else scheduleRepaint();
  };
  if (moduleKey) cleanups.push(linkServerModuleRepaints(moduleKey, scheduleRepaint));
  // Frames re-render the island, so sentinel indexes and per-item args change
  // between renders — listeners are detached and rebuilt from scratch after
  // every morph, reading the FRESH manifest (host attr, or the <template>
  // hoisted inside frame HTML). Elements patched in place therefore never
  // fire stale actions.
  const attached: Array<{ el: Element; type: string; listener: () => void }> = [];
  const readManifest = (): Record<string, unknown> | undefined => {
    // Fresh frame manifests (hoisted <template>) win over the host attribute —
    // the attr carries the INITIAL SSR manifest, which goes stale as sentinel
    // indexes shift between renders.
    const raw =
      host
        .querySelector(`:scope > template[${ACTIONS_ATTR}], template[${ACTIONS_ATTR}]`)
        ?.getAttribute(ACTIONS_ATTR) ??
      host.getAttribute(ACTIONS_ATTR) ??
      null;
    return raw ? parseSnapshotAttr(raw) : undefined;
  };
  const wireEvents = (): void => {
    for (const { el, type, listener } of attached) {
      el.removeEventListener(type, listener);
    }
    attached.length = 0;

    const manifest = readManifest();
    if (!manifest) return;
    const sentinels = [host, ...Array.from(host.querySelectorAll(`[${EVENT_SENTINEL_ATTR}]`))];
    for (const el of sentinels) {
      if (!el.hasAttribute(EVENT_SENTINEL_ATTR)) continue;
      // The island root itself may carry a sentinel; ownership check only
      // applies to descendants.
      if (el !== host && !belongsToHost(host, el)) continue;
      const spec = el.getAttribute(EVENT_SENTINEL_ATTR) ?? "";
      for (const part of spec.split(",")) {
        const sep = part.lastIndexOf(":");
        if (sep < 1) continue;
        const type = part.slice(0, sep);
        // Manifest entries are either the action key or `{ k, a }` with a
        // static payload captured at render time ([handler, ...args]).
        const entry = manifest[part] as string | { k?: unknown; a?: unknown } | undefined;
        let actionKey: string | undefined;
        let callArgs: unknown[] = [];
        if (typeof entry === "string") {
          actionKey = entry;
        } else if (entry && typeof entry === "object") {
          actionKey = String(entry.k);
          if (Array.isArray(entry.a)) callArgs = entry.a;
        }
        const action = actionKey == null ? undefined : wiring.actions?.[actionKey];
        if (!action) continue;
        const listener = (): void => {
          void Promise.resolve(action(...callArgs))
            .then(() => repaintModule())
            .catch((err) => {
              console.error(`[ilha-router] action "${String(actionKey)}" failed:`, err);
            });
        };
        el.addEventListener(type, listener);
        attached.push({ el, type, listener });
      }
    }
  };
  wireEvents();

  const mountedChildren = new Map<Element, ServerIslandHandle>();
  const reviveChildProps = (
    props: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined => {
    if (!props) return undefined;
    for (const [key, value] of Object.entries(props)) {
      if (!value || typeof value !== "object") continue;
      const marker = value as { __ilha?: unknown; k?: unknown; a?: unknown };
      if (marker.__ilha !== "action" || typeof marker.k !== "string") continue;
      const action = wiring.actions?.[marker.k];
      if (!action) continue;
      const args = Array.isArray(marker.a) ? marker.a : [];
      props[key] = (..._runtimeArgs: unknown[]) =>
        Promise.resolve(action(...args)).then((result) => {
          repaintModule();
          return result;
        });
    }
    return props;
  };
  const syncChildren = (): void => {
    for (const [el, handle] of mountedChildren) {
      if (el.isConnected && belongsToHost(host, el) && el.hasAttribute(CLIENT_REF_ATTR)) continue;
      handle.unmount();
      mountedChildren.delete(el);
    }
    for (const el of host.querySelectorAll(`[${CLIENT_REF_ATTR}]`)) {
      if (!belongsToHost(host, el)) continue;
      const props = reviveChildProps(
        parseSnapshotAttr(el.getAttribute(PROPS_ATTR) ?? "") ?? undefined,
      );
      const mounted = mountedChildren.get(el);
      if (mounted) {
        mounted.updateProps(props);
        continue;
      }
      const child = wiring.children?.[el.getAttribute(CLIENT_REF_ATTR) ?? ""] as
        | Record<symbol, unknown>
        | undefined;
      const mount = child?.[ISLAND_MOUNT_INTERNAL] as
        | ((host: Element, props?: Record<string, unknown>) => ServerIslandHandle)
        | undefined;
      if (mount) mountedChildren.set(el, mount(el, props));
    }
  };
  syncChildren();

  // Resume streams. The generator call site is identical to the server's —
  // only the import resolution differs (tacho SSE stub vs local generator).
  for (const [key, fn] of Object.entries(wiring.streams ?? {})) {
    void (async () => {
      try {
        const { gen, first } = await startServerStream(fn, controller.signal);
        try {
          let step: IteratorResult<unknown, unknown> = first;
          for (;;) {
            const { done, value } = step;
            if (controller.signal.aborted || done) break;
            state[key] = value;
            repaintModule();
            step = await gen.next();
          }
        } catch (err) {
          if (!controller.signal.aborted && (err as { name?: string })?.name !== "AbortError") {
            console.error(`[ilha-router] stream "${key}" failed:`, err);
          }
        } finally {
          // Unwind the generator so `finally` blocks in .server modules run.
          void Promise.resolve(gen.return?.(undefined)).catch(() => {});
        }
      } catch (err) {
        if (!controller.signal.aborted && (err as { name?: string })?.name !== "AbortError") {
          console.error(`[ilha-router] stream "${key}" failed:`, err);
        }
      }
    })();
  }

  // Bootstrap: when there is no SSR DOM to hydrate (pure client render, e.g.
  // SPA navigation), the host starts empty — pull the first frame now.
  if (frame && !host.hasAttribute(STATE_ATTR) && host.childNodes.length === 0) {
    scheduleRepaint();
  }

  return {
    unmount: () => {
      for (const { el, type, listener } of attached) {
        el.removeEventListener(type, listener);
      }
      attached.length = 0;
      for (const handle of mountedChildren.values()) handle.unmount();
      mountedChildren.clear();
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
    },
    updateProps: (next) => {
      currentProps = next;
      scheduleRepaint();
    },
  };
}

/**
 * Create a client proxy island for a server-defined island. Called by
 * generated virtual modules — not by application code.
 *
 * @param id - Stable identity (`<relative-path>#<export>`), for diagnostics.
 * @param as - Slot tag declared by the server island's `{ as }` option (default div).
 * @param wiring - Stream/action transports wired to tacho stubs by codegen.
 */
interface IslandCallShape {
  [ISLAND_CALL]: true;
  island: ServerIslandCallable;
  props?: Record<string, unknown>;
  key: string;
}

export type ServerIslandCallable = Record<symbol, unknown> &
  ((props?: Record<string, unknown>) => string) & {
    mount: (host: Element, props?: Record<string, unknown>) => () => void;
    toString: () => string;
    key: (slotKey: string) => (props?: Record<string, unknown>) => IslandCallShape;
  };

export function __ilhaServerIsland(
  id: string,
  as: string,
  wiring: ServerIslandWiring = {},
  moduleKey?: string,
): ServerIslandCallable {
  const slotTag = assertValidTag(as);

  // SAFETY: the callable only gains `.toString`/`.key`/`.mount` members at
  // runtime below; the assert declares the runtime-finished surface so
  // consumers can call them without a cast. Not assignable structurally until
  // the members are set, so the single typed bridge here is required.
  const island = ((props?: Record<string, unknown>): string => {
    // Client composition interpolates proxies through emitIslandSlot's sync
    // path, which calls toString() for inline HTML. A proxy cannot render —
    // it returns an empty shell; mountSlots then mounts it onto the slot and
    // hydration (or the frame bootstrap) fills the DOM.
    void props;
    return "";
  }) as unknown as ServerIslandCallable;

  island[ISLAND] = true;
  island[ISLAND_SLOT_TAG] = slotTag;
  // SAFETY: the island object is a brand-shaped callable; assigning the
  // render-shim members via a record view is the intended bridge contract.
  (island as unknown as Record<string, unknown>).toString = (): string => "";

  // wrapLayout composition calls page.key("page").
  // Returns the IslandCall shape ilha's interpolateValue recognises.
  const ISLAND_CALL = Symbol.for("ilha.islandCall");
  // SAFETY: see above — `.key` is a brand member on the callable island.
  (island as unknown as Record<string, unknown>).key = (slotKey: string) => {
    if (typeof slotKey !== "string" || slotKey.trim().length === 0 || slotKey.includes(":")) {
      throw new Error('server island key() requires a non-empty key without ":".');
    }
    return (props?: Record<string, unknown>) => ({
      [ISLAND_CALL]: true,
      island,
      props,
      key: slotKey,
    });
  };

  // SAFETY: symbol-keyed internal mount hooks are exposed on the island object
  // for ilha's mount machinery to discover.
  (island as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] = (
    host: Element,
    mountProps?: Record<string, unknown>,
  ): ServerIslandHandle => hydrateServerIsland(host, id, wiring, mountProps, moduleKey);

  // SAFETY: `.mount` mirrors the core island method surface on the proxy.
  (island as unknown as Record<string, unknown>).mount = (
    host: Element,
    mountProps?: Record<string, unknown>,
  ): (() => void) => hydrateServerIsland(host, id, wiring, mountProps, moduleKey).unmount;

  return island;
}
