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
import type { SnapshotObject, SnapshotValue } from "./snapshot";

const objectTag = <T>(value: T): string =>
  Object.prototype.toString.call(value);

const isString = <T>(value: T): value is Extract<T, string> =>
  objectTag(value) === "[object String]";

const isObject = <T>(value: T): value is Extract<T, object> =>
  value !== null && objectTag(value) === "[object Object]";

/** Symbol.for keeps brands stable across duplicate ilha copies in one realm. */
const ISLAND = Symbol.for("ilha.island");
const ISLAND_SLOT_TAG = Symbol.for("ilha.islandSlotTag");
export const ISLAND_MOUNT_INTERNAL: unique symbol = Symbol.for(
  "ilha.islandMountInternal"
);
const ISLAND_CALL = Symbol.for("ilha.islandCall");

const STATE_ATTR = "data-ilha-state";
const EVENT_SENTINEL_ATTR = "data-ilha-on";
const ACTIONS_ATTR = "data-ilha-actions";
const PROPS_ATTR = "data-ilha-props";
const CLIENT_REF_ATTR = "data-ilha-client-ref";

const moduleRepaints = new Map<string, Set<() => void>>();

/** @internal */
export const __ilhaRepaintServerModule = (moduleKey: string): void => {
  for (const repaint of moduleRepaints.get(moduleKey) ?? []) {
    repaint();
  }
};

const linkServerModuleRepaints = (
  moduleKey: string,
  repaint: () => void
): (() => void) => {
  let set = moduleRepaints.get(moduleKey);
  if (!set) {
    set = new Set();
    moduleRepaints.set(moduleKey, set);
  }
  set.add(repaint);
  return () => {
    const live = moduleRepaints.get(moduleKey);
    if (!live) {
      return;
    }
    live.delete(repaint);
    if (live.size === 0) {
      moduleRepaints.delete(moduleKey);
    }
  };
};

export type ServerStreamFn = (
  signal: AbortSignal
) => AsyncGenerator<SnapshotValue> | Generator<SnapshotValue>;

/** JSON-serializable value — the wire format for server-action payloads. */
export type ServerActionPayload = SnapshotValue;

export type ServerIslandProps = SnapshotObject;

export interface ServerIslandWiring {
  /** Stream key → client transport. The plugin wires these to tacho stubs. */
  streams?: Record<string, ServerStreamFn>;
  /** Action key → client transport. Event payloads are not serializable;
   * handlers receive `undefined` and should read island state instead. */
  actions?: Record<
    string,
    (payload?: ServerActionPayload) => SnapshotValue | Promise<SnapshotValue>
  >;
  /** Frame transport: re-renders the island with the latest parent props. */
  frame?: (
    props?: ServerIslandProps
  ) => string | Promise<string> | SnapshotValue;
  /** Client-capable islands nested in the server render, keyed by opaque ref. */
  children?: Record<string, ServerIslandCallable>;
}

export interface ServerIslandHandle {
  unmount: () => void;
  updateProps: (props?: ServerIslandProps) => void;
}

/** @internal */
export const __ilhaApplyHead = <T>(entries: T): void => {
  if (Array.isArray(entries)) {
    // SAFETY: frame head payloads are HeadInput arrays produced by serializeHead.
    applyHeadEntriesToDocument(entries as HeadInput[]);
  }
};

/** Defensive snapshot parse — reuses the shared guarded parser (size cap,
 * plain-object check, depth cap, prototype-key stripping). */
const assertValidTag = (tag: string): string => {
  const trimmed = tag.trim();
  if (/^[a-z][a-z0-9-]*$/iu.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return "div";
};

/** True when `candidate` is owned by `host`: walking up must not cross another
 * island or slot boundary before reaching it. */
const belongsToHost = (host: Element, candidate: Element): boolean => {
  let el: Element | null = candidate.parentElement;
  while (el && el !== host) {
    if (el.matches("[data-ilha]")) {
      return false;
    }
    // Stream holes use display:contents + data-ilha-slot; nested island slots do not.
    if (
      el.matches("[data-ilha-slot]") &&
      el instanceof HTMLElement &&
      el.style.display !== "contents"
    ) {
      return false;
    }
    el = el.parentElement;
  }
  return el === host;
};

const sleepMs = (ms: number): Promise<null> => {
  const { promise, resolve } = Promise.withResolvers<null>();
  setTimeout(() => {
    resolve(null);
  }, ms);
  return promise;
};

const abortAwareDelay = async <E>(
  ms: number,
  signal: AbortSignal,
  abortError: E
): Promise<void> => {
  if (signal.aborted) {
    throw abortError;
  }
  await sleepMs(ms);
  if (signal.aborted) {
    throw abortError;
  }
};

const isColdStartRpcFailure = <E>(error: E): boolean => {
  const msg = String(error);
  return (
    msg.includes("404") ||
    msg.includes("503") ||
    msg.includes("empty HTTP response") ||
    msg.includes("HttpError") ||
    msg.includes("RpcClientDefect") ||
    msg.includes("RpcClientError")
  );
};

/** Dev cold-start can race a warming `virtual:oxide/actions` graph — retry briefly. */
const startServerStream = async <E>(
  fn: ServerStreamFn,
  signal: AbortSignal,
  attempt = 0,
  last?: E
): Promise<{
  gen: AsyncGenerator<SnapshotValue> | Generator<SnapshotValue>;
  first: IteratorResult<SnapshotValue, SnapshotValue>;
}> => {
  if (attempt >= 4) {
    throw last;
  }
  if (signal.aborted) {
    throw last ?? new DOMException("The operation was aborted.", "AbortError");
  }
  let gen: AsyncGenerator<SnapshotValue> | Generator<SnapshotValue> | undefined;
  try {
    gen = await fn(signal);
    // Async `function*` bodies run on the first `next()`, so cold RPC
    // failures surface here — keep that read inside the retry boundary.
    const first = await gen.next();
    return { first, gen };
  } catch (error) {
    if (gen) {
      try {
        // SAFETY: return() accepts any completion value; streams ignore it.
        await gen.return?.(undefined as never);
      } catch {
        void 0;
      }
    }
    if (signal.aborted) {
      throw error;
    }
    if (!isColdStartRpcFailure(error)) {
      throw error;
    }
    if (attempt === 3) {
      throw error;
    }
    await abortAwareDelay(50 * (attempt + 1), signal, error);
    return startServerStream(fn, signal, attempt + 1, error);
  }
};

interface ManifestActionEntry {
  k?: SnapshotValue;
  a?: SnapshotValue;
}

type ManifestEntry = string | ManifestActionEntry;

interface AttachedListener {
  el: Element;
  type: string;
  listener: () => void;
}

interface ActionMarker {
  __ilha?: SnapshotValue;
  k?: SnapshotValue;
  a?: SnapshotValue;
}

const drainStream = async (
  gen: AsyncGenerator<SnapshotValue> | Generator<SnapshotValue>,
  first: IteratorResult<SnapshotValue, SnapshotValue>,
  key: string,
  state: SnapshotObject,
  controller: AbortController,
  onValue: () => void
): Promise<void> => {
  let step = first;
  const advance = async (): Promise<void> => {
    const { done, value } = step;
    if (controller.signal.aborted || done) {
      return;
    }
    // SAFETY: stream state keys are island-owned; mutate the snapshot bag.
    (state as Record<string, SnapshotValue | undefined>)[key] = value;
    onValue();
    step = await gen.next();
    await advance();
  };
  try {
    await advance();
  } catch (error) {
    // SAFETY: DOMException / Error expose optional `.name`.
    // SAFETY: DOMException / Error expose optional `.name`.
    const named = error as { name?: string };
    if (!controller.signal.aborted && named.name !== "AbortError") {
      console.error(`[ilha-router] stream "${key}" failed:`, error);
    }
  } finally {
    try {
      // SAFETY: return() accepts any completion value; streams ignore it.
      // SAFETY: return() accepts any completion value; streams ignore it.
      await gen.return?.(undefined as never);
    } catch {
      void 0;
    }
  }
};

const hydrateServerIsland = (
  host: Element,
  id: string,
  wiring: ServerIslandWiring,
  props?: ServerIslandProps,
  moduleKey?: string
): ServerIslandHandle => {
  const controller = new AbortController();
  const cleanups: (() => void)[] = [
    () => {
      controller.abort();
    },
  ];

  // Seed state from the SSR snapshot. Stream pushes overwrite these keys;
  // frames re-render from the latest values.
  const state: Record<string, SnapshotValue | undefined> = {};
  const rawState = host.getAttribute(STATE_ATTR);
  if (rawState) {
    const parsed = parseSnapshotAttr(rawState);
    if (parsed) {
      for (const [key, value] of Object.entries(parsed)) {
        if (!key.startsWith("_")) {
          state[key] = value;
        }
      }
    }
  }

  // Serialized repaint queue — frames must apply in push order even when
  // several arrive back-to-back.
  const { frame } = wiring;
  let currentProps = props;
  let repaintChain: Promise<void> = Promise.resolve();

  const attached: AttachedListener[] = [];
  const mountedChildren = new Map<Element, ServerIslandHandle>();
  const hooks = {
    repaintModule: (): void => {
      // assigned below once scheduleRepaint exists
    },
  };

  const readManifest = (): SnapshotObject | undefined => {
    // Fresh frame manifests (hoisted <template>) win over the host attribute —
    // the attr carries the INITIAL SSR manifest, which goes stale as sentinel
    // indexes shift between renders.
    const raw =
      host
        .querySelector(
          `:scope > template[${ACTIONS_ATTR}], template[${ACTIONS_ATTR}]`
        )
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
    if (!manifest) {
      return;
    }
    const sentinels = [
      host,
      ...host.querySelectorAll(`[${EVENT_SENTINEL_ATTR}]`),
    ];
    for (const el of sentinels) {
      if (!el.hasAttribute(EVENT_SENTINEL_ATTR)) {
        continue;
      }
      // The island root itself may carry a sentinel; ownership check only
      // applies to descendants.
      if (el !== host && !belongsToHost(host, el)) {
        continue;
      }
      const spec = el.getAttribute(EVENT_SENTINEL_ATTR) ?? "";
      for (const part of spec.split(",")) {
        const sep = part.lastIndexOf(":");
        if (sep < 1) {
          continue;
        }
        const eventType = part.slice(0, sep);
        // Manifest entries are either the action key or `{ k, a }` with a
        // static payload captured at render time ([handler, ...args]).
        // SAFETY: manifest values are string keys or {k,a} objects from SSR.
        const entry = manifest[part] as ManifestEntry | undefined;
        let actionKey: string | undefined;
        let callArgs: ServerActionPayload[] = [];
        if (isString(entry)) {
          actionKey = entry;
        } else if (entry && isObject(entry)) {
          actionKey = String(entry.k);
          if (Array.isArray(entry.a)) {
            // SAFETY: the manifest payload was serialized by the server-side
            // action shim as JSON — exactly the ServerActionPayload contract.
            callArgs = entry.a as ServerActionPayload[];
          }
        }
        const actionFn =
          actionKey === null || actionKey === undefined
            ? undefined
            : wiring.actions?.[actionKey];
        if (!actionFn) {
          continue;
        }
        const boundKey = actionKey;
        const listener = (): void => {
          const run = async () => {
            try {
              await Promise.resolve(actionFn(...callArgs));
              hooks.repaintModule();
            } catch (error) {
              console.error(
                `[ilha-router] action "${String(boundKey)}" failed:`,
                error
              );
            }
          };
          void run();
        };
        el.addEventListener(eventType, listener);
        attached.push({ el, listener, type: eventType });
      }
    }
  };

  const reviveChildProps = (
    childProps: ServerIslandProps | undefined
  ): ServerIslandProps | undefined => {
    if (!childProps) {
      return undefined;
    }
    const next = { ...childProps };
    for (const [key, value] of Object.entries(childProps)) {
      if (!value || !isObject(value)) {
        continue;
      }
      // SAFETY: action markers are SSR-serialized {__ilha,k,a} bags.
      const marker = value as ActionMarker;
      if (marker.__ilha !== "action" || !isString(marker.k)) {
        continue;
      }
      const actionFn = wiring.actions?.[marker.k];
      if (!actionFn) {
        continue;
      }
      let args: ServerActionPayload[] = [];
      if (Array.isArray(marker.a)) {
        // SAFETY: marker.a is a JSON array of ServerActionPayload values.
        args = marker.a as ServerActionPayload[];
      }
      const revived = (..._runtimeArgs: SnapshotValue[]) => {
        const run = async () => {
          const result = await Promise.resolve(actionFn(...args));
          hooks.repaintModule();
          return result;
        };
        return run();
      };
      // SAFETY: child props accept revived action callables at mount time.
      Object.assign(next, { [key]: revived });
    }
    return next;
  };

  const syncChildren = (): void => {
    for (const [el, handle] of mountedChildren) {
      if (
        el.isConnected &&
        belongsToHost(host, el) &&
        el.hasAttribute(CLIENT_REF_ATTR)
      ) {
        continue;
      }
      handle.unmount();
      mountedChildren.delete(el);
    }
    for (const el of host.querySelectorAll(`[${CLIENT_REF_ATTR}]`)) {
      if (!belongsToHost(host, el)) {
        continue;
      }
      const childProps = reviveChildProps(
        parseSnapshotAttr(el.getAttribute(PROPS_ATTR) ?? "") ?? undefined
      );
      const mounted = mountedChildren.get(el);
      if (mounted) {
        mounted.updateProps(childProps);
        continue;
      }
      const child = wiring.children?.[el.getAttribute(CLIENT_REF_ATTR) ?? ""];
      const mount = child?.[ISLAND_MOUNT_INTERNAL];
      if (mount) {
        mountedChildren.set(el, mount(el, childProps));
      }
    }
  };

  const applyFrameHtml = async (sent: ServerIslandProps | undefined) => {
    if (!frame || controller.signal.aborted || !host.isConnected) {
      return;
    }
    const html = await frame(sent);
    if (controller.signal.aborted || !isString(html)) {
      return;
    }
    const parsed = new DOMParser().parseFromString(
      `<div>${html}</div>`,
      "text/html"
    );
    host.replaceChildren(...(parsed.body.firstElementChild?.childNodes ?? []));
    syncChildren();
    wireEvents();
  };

  const scheduleRepaint = (): void => {
    if (!frame || controller.signal.aborted) {
      return;
    }
    const sent = currentProps;
    const previous = repaintChain;
    repaintChain = (async () => {
      await previous;
      try {
        await applyFrameHtml(sent);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(
            `[ilha-router] frame render failed for "${id}":`,
            error
          );
        }
      }
    })();
  };

  hooks.repaintModule = (): void => {
    if (moduleKey) {
      __ilhaRepaintServerModule(moduleKey);
    } else {
      scheduleRepaint();
    }
  };

  if (moduleKey) {
    cleanups.push(linkServerModuleRepaints(moduleKey, scheduleRepaint));
  }

  // Frames re-render the island, so sentinel indexes and per-item args change
  // between renders — listeners are detached and rebuilt from scratch after
  // every morph, reading the FRESH manifest (host attr, or the <template>
  // hoisted inside frame HTML). Elements patched in place therefore never
  // fire stale actions.
  wireEvents();
  syncChildren();

  // Resume streams. The generator call site is identical to the server's —
  // only the import resolution differs (tacho SSE stub vs local generator).
  for (const [key, fn] of Object.entries(wiring.streams ?? {})) {
    const run = async () => {
      try {
        const { gen, first } = await startServerStream(fn, controller.signal);
        await drainStream(
          gen,
          first,
          key,
          state,
          controller,
          hooks.repaintModule
        );
      } catch (error) {
        // SAFETY: DOMException / Error expose optional `.name`.
        const named = error as { name?: string };
        if (!controller.signal.aborted && named.name !== "AbortError") {
          console.error(`[ilha-router] stream "${key}" failed:`, error);
        }
      }
    };
    void run();
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
      for (const handle of mountedChildren.values()) {
        handle.unmount();
      }
      mountedChildren.clear();
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
    },
    updateProps: (next) => {
      currentProps = next;
      scheduleRepaint();
    },
  };
};

/**
 * Create a client proxy island for a server-defined island. Called by
 * generated virtual modules — not by application code.
 *
 * @param id - Stable identity (`<relative-path>#<export>`), for diagnostics.
 * @param as - Slot tag declared by the server island's `{ as }` option (default div).
 * @param wiring - Stream/action transports wired to tacho stubs by codegen.
 */
interface IslandCallPayload {
  [ISLAND_CALL]: true;
  island: ServerIslandCallable;
  props?: ServerIslandProps;
  key: string;
}

export type ServerIslandCallable = ((props?: ServerIslandProps) => string) & {
  [ISLAND]: true;
  [ISLAND_SLOT_TAG]: string;
  mount: (host: Element, props?: ServerIslandProps) => () => void;
  toString: () => string;
  key: (slotKey: string) => (props?: ServerIslandProps) => IslandCallPayload;
  [ISLAND_MOUNT_INTERNAL]: (
    host: Element,
    props?: ServerIslandProps
  ) => ServerIslandHandle;
};

export const __ilhaServerIsland = (
  id: string,
  as: string,
  wiring: ServerIslandWiring = {},
  moduleKey?: string
): ServerIslandCallable => {
  const slotTag = assertValidTag(as);

  // SAFETY: the callable only gains `.toString`/`.key`/`.mount` members at
  // runtime below; the assert declares the runtime-finished surface so
  // consumers can call them without a cast. Not assignable structurally until
  // the members are set, so the single typed bridge here is required.
  const island = ((props?: ServerIslandProps): string => {
    // Client composition interpolates proxies through emitIslandSlot's sync
    // path, which calls toString() for inline HTML. A proxy cannot render —
    // it returns an empty shell; mountSlots then mounts it onto the slot and
    // hydration (or the frame bootstrap) fills the DOM.
    void props;
    return "";
    // SAFETY: members below complete the ServerIslandCallable surface.
  }) as ServerIslandCallable;

  island[ISLAND] = true;
  island[ISLAND_SLOT_TAG] = slotTag;
  island.toString = (): string => "";

  // wrapLayout composition calls page.key("page").
  // Returns the IslandCall payload ilha's interpolateValue recognises.
  island.key = (slotKey: string) => {
    if (
      !isString(slotKey) ||
      slotKey.trim().length === 0 ||
      slotKey.includes(":")
    ) {
      throw new Error(
        'server island key() requires a non-empty key without ":".'
      );
    }
    return (callProps?: ServerIslandProps): IslandCallPayload => ({
      [ISLAND_CALL]: true,
      island,
      key: slotKey,
      props: callProps,
    });
  };

  island[ISLAND_MOUNT_INTERNAL] = (
    host: Element,
    mountProps?: ServerIslandProps
  ): ServerIslandHandle =>
    hydrateServerIsland(host, id, wiring, mountProps, moduleKey);

  island.mount = (
    host: Element,
    mountProps?: ServerIslandProps
  ): (() => void) =>
    hydrateServerIsland(host, id, wiring, mountProps, moduleKey).unmount;

  return island;
};
