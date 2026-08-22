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

import { morph } from "ilha";

/** Symbol.for keeps brands stable across duplicate ilha copies in one realm. */
const ISLAND = Symbol.for("ilha.island");
const ISLAND_SLOT_TAG = Symbol.for("ilha.islandSlotTag");
const ISLAND_MOUNT_INTERNAL = Symbol.for("ilha.islandMountInternal");

const STATE_ATTR = "data-ilha-state";
const EVENT_SENTINEL_ATTR = "data-ilha-on";
const ACTIONS_ATTR = "data-ilha-actions";
const PROPS_ATTR = "data-ilha-props";
const CLIENT_REF_ATTR = "data-ilha-client-ref";

export type ServerStreamFn = (signal: AbortSignal) => AsyncGenerator<unknown> | Generator<unknown>;

export interface ServerIslandWiring {
  /** Stream key → client transport. The plugin wires these to tacho stubs. */
  streams?: Record<string, ServerStreamFn>;
  /** Action key → client transport. Event payloads are not serializable;
   * handlers receive `undefined` and should read island state instead. */
  actions?: Record<string, (payload?: unknown) => unknown>;
  /** Frame transport: re-renders the island from server-owned state. */
  frame?: () => unknown;
  /** RPC transport for the module's `loader.client` export — invoked once
   * when the view hydrates. Side-effect loader on server pages. */
  clientLoad?: () => unknown;
  /** Client-capable islands nested in the server render, keyed by opaque ref. */
  children?: Record<string, unknown>;
}

export interface ServerIslandHandle {
  unmount: () => void;
  updateProps: (props?: Record<string, unknown>) => void;
}

/** Defensive snapshot parse — mirrors core's guards in miniature. */
function parseSnapshot(raw: string): Record<string, unknown> | undefined {
  if (raw.length > 256 * 1024) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

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
    if (el.hasAttribute("data-ilha") || el.hasAttribute("data-ilha-slot")) return false;
    el = el.parentElement;
  }
  return el === host;
}

function hydrateServerIsland(
  host: Element,
  id: string,
  wiring: ServerIslandWiring,
): ServerIslandHandle {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  cleanups.push(() => controller.abort());

  // Seed state from the SSR snapshot. Stream pushes overwrite these keys;
  // frames re-render from the latest values.
  const state: Record<string, unknown> = {};
  const rawState = host.getAttribute(STATE_ATTR);
  if (rawState) {
    const parsed = parseSnapshot(rawState);
    if (parsed) {
      for (const [key, value] of Object.entries(parsed)) {
        if (!key.startsWith("_")) state[key] = value;
      }
    }
  }

  // Serialized repaint queue — frames must apply in push order even when
  // several arrive back-to-back.
  const frame = wiring.frame;
  let repaintChain: Promise<void> = Promise.resolve();
  const scheduleRepaint = (): void => {
    if (!frame || controller.signal.aborted) return;
    repaintChain = repaintChain
      .then(async () => {
        if (controller.signal.aborted || !host.isConnected) return;
        const html = await frame();
        if (controller.signal.aborted || typeof html !== "string") return;
        morph(host, html);
        syncChildren();
        wireEvents();
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error(`[ilha-router] frame render failed for "${id}":`, err);
        }
      });
  };

  // Reconnect event sentinels to named actions via the hydration manifest.
  // Re-run after every frame: morph may introduce new sentinel elements.
  // Elements patched in place keep their listeners, so wired elements are
  // tracked and skipped — otherwise actions would fire twice per click.
  // Reconnect event sentinels to named actions via the hydration manifest.
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
      Array.from(host.children)
        .find((c) => c.matches(`template[${ACTIONS_ATTR}]`))
        ?.getAttribute(ACTIONS_ATTR) ??
      host.getAttribute(ACTIONS_ATTR) ??
      null;
    return raw ? parseSnapshot(raw) : undefined;
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
            .then(() => scheduleRepaint())
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
          scheduleRepaint();
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
      const props = reviveChildProps(parseSnapshot(el.getAttribute(PROPS_ATTR) ?? "") ?? undefined);
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
        const gen = await fn(controller.signal);
        try {
          for (;;) {
            const { done, value } = await gen.next();
            if (controller.signal.aborted || done) break;
            state[key] = value;
            scheduleRepaint();
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

  // `loader.client` on server pages: execute once when the view hydrates.
  // Side-effect loader over RPC — head, analytics. Its return value cannot
  // flow back into server-rendered island markup (the render fn never ships).
  if (wiring.clientLoad) {
    void Promise.resolve(wiring.clientLoad()).catch((err) => {
      if (!controller.signal.aborted) {
        console.error(`[ilha-router] client loader failed for "${id}":`, err);
      }
    });
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
    // Props updates cannot repaint server-rendered markup client-side — the
    // render function never ships. Content changes arrive via frames instead.
    updateProps: () => {},
  };
}

/**
 * Create a client proxy island for a server-defined island. Called by
 * generated virtual modules — not by application code.
 *
 * @param id - Stable identity (`<relative-path>#<export>`), for diagnostics.
 * @param as - Slot tag declared by the server island's `.as()` (default div).
 * @param wiring - Stream/action transports wired to tacho stubs by codegen.
 */
export function __ilhaServerIsland(
  id: string,
  as: string,
  wiring: ServerIslandWiring = {},
): unknown {
  const slotTag = assertValidTag(as);

  const island = ((props?: Record<string, unknown>): string => {
    // Client composition interpolates proxies through emitIslandSlot's sync
    // path, which calls toString() for inline HTML. A proxy cannot render —
    // it returns an empty shell; mountSlots then mounts it onto the slot and
    // hydration (or the frame bootstrap) fills the DOM.
    void props;
    return "";
  }) as Record<symbol, unknown> & ((props?: Record<string, unknown>) => string);

  island[ISLAND] = true;
  island[ISLAND_SLOT_TAG] = slotTag;
  (island as unknown as Record<string, unknown>).toString = (): string => "";

  // Builder parity for layout composition: wrapLayout calls page.key("page").
  // Returns the IslandCall shape ilha's interpolateValue recognises.
  const ISLAND_CALL = Symbol.for("ilha.islandCall");
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

  (island as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] = (
    host: Element,
  ): ServerIslandHandle => hydrateServerIsland(host, id, wiring);

  (island as unknown as Record<string, unknown>).mount = (host: Element): (() => void) =>
    hydrateServerIsland(host, id, wiring).unmount;

  return island;
}
