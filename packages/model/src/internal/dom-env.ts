/**
 * The per-island DOM environment `@ilha/model` runs against: how Commands
 * reach the issuing instance's elements (`Refs`), and the browser
 * implementations of `DomSubscription`'s `GlobalEvents` and
 * `AnimationFrames` plus the `Files` and `Images` services the kernel seeds
 * every client instance with.
 *
 * `baseEnv` replaces the kernel's old `clientEnv`: on a client mount it
 * holds the island's `Client` service plus the browser event sources and a
 * fresh `Refs` store; on the server it is empty (nothing runs there
 * anyway). `Component.provide` merges over it, so provided services win.
 *
 * @internal
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Client } from "ilha";
import type { FiberLocal } from "ilha/internal";

import * as DomFiles from "../dom-files.ts";
import * as DomImages from "../dom-images.ts";
import * as DomSubscription from "../dom-subscription.ts";
import * as Dom from "../dom.ts";

/**
 * The live `Refs` behind the service: the issuing instance's elements by
 * ref key, written by `h.ref` after commit and read by `lookup` after the
 * issuing update's commit.
 *
 * @internal
 */
export interface RefsStore {
  /** The latest committed node per ref key. */
  readonly nodes: Map<string, Element>;
}

/**
 * Makes the `Refs` service for one instance, backed by `store`.
 *
 * `lookup` reads the store at once (the issuing update's commit has painted
 * by the time a Command fiber runs), and after one microtask when the ref
 * is missing, so a commit queued behind the issue still lands. It returns
 * `none` for a ref that isn't rendered.
 *
 * @internal
 */
export const makeRefs = (
  store: RefsStore
): Dom.Refs & {
  readonly register: (key: string, node: Element | null) => void;
} => ({
  lookup: <Node extends Element>(
    ref: Dom.Ref<Node>
  ): Effect.Effect<Option.Option<Node>> => {
    const read = (): Option.Option<Node> =>
      // SAFETY: the store only holds elements of the issuing instance; the lookup's node type comes from the ref that registered them.
      Option.fromNullishOr(
        (store.nodes.get(ref.key) ?? undefined) as Node | undefined
      );
    const hit = read();
    if (Option.isSome(hit)) {
      return Effect.succeed(hit);
    }
    const { promise, resolve } = Promise.withResolvers<undefined>();
    // oxlint-disable-next-line unicorn/no-useless-undefined -- the deferred resolves with no value; the explicit argument keeps the eager wake-up timing the late-ref test relies on.
    queueMicrotask(() => resolve(undefined));
    return Effect.map(
      Effect.promise(() => promise),
      read
    );
  },
  register: (key: string, node: Element | null): void => {
    if (node === null) {
      // A repaint disposes the old ref just before it attaches the new one
      // in the same commit; only a real removal still holds the old node
      // afterwards, so only then is the key cleared.
      const current = store.nodes.get(key);
      if (current === undefined) {
        return;
      }
      queueMicrotask(() => {
        if (store.nodes.get(key) === current) {
          store.nodes.delete(key);
        }
      });
      return;
    }
    store.nodes.set(key, node);
  },
});

/** Whether the resolved `Refs` service can record elements (test doubles without registration are ignored). */
const isRegisteringRefs = (
  candidate: unknown
): candidate is Dom.Refs & {
  readonly register: (key: string, node: Element | null) => void;
} =>
  typeof candidate === "object" &&
  candidate !== null &&
  "register" in candidate &&
  // SAFETY: registration is a plain method on the live `Refs` object; the guard only reads its presence.
  typeof (candidate as { readonly register: unknown }).register === "function";
/**
 * Record one instance's element under its ref `key`, or forget it when the
 * element goes. Reads the store back out of the instance's env, so `h.ref`
 * needs no other wiring.
 *
 * @internal
 */
export const registerRef = (
  env: Context.Context<never>,
  key: string,
  node: Element | null
): void => {
  const refs = Context.getOption(env, Dom.Refs);
  if (Option.isNone(refs)) {
    return;
  }
  if (!isRegisteringRefs(refs.value)) {
    return;
  }
  refs.value.register(key, node);
};

/** A `GlobalEvents` service that listens on `document` and its window. */
const browserGlobalEvents = (
  document: Document
): DomSubscription.GlobalEvents => ({
  listen: (target, event, { capture, custom }, listener) => {
    const on: Document | (Window & typeof globalThis) | null =
      target === "document" ? document : document.defaultView;
    if (on === null) {
      return (): void => {
        // no document to listen on
      };
    }
    const f = (ev: Event): void => {
      // SAFETY: the browser only reports `custom: true` for `CustomEvent`s, whose `detail` carries the payload.
      const payload =
        custom === true
          ? {
              defaultPrevented: ev.defaultPrevented,
              detail: (ev as CustomEvent).detail ?? null,
            }
          : DomSubscription.eventPayload(event, ev, ev.defaultPrevented);
      listener(payload, () => ev.preventDefault());
    };
    // SAFETY: `f` handles an `Event` and returns nothing, matching the `EventListener` call signature.
    on.addEventListener(event, f as EventListener, { capture });
    // SAFETY: same listener object as the `addEventListener` above, so removal detaches exactly it.
    return () => on.removeEventListener(event, f as EventListener, { capture });
  },
});

/** Whether the document's window can schedule animation frames (older hosts and test doubles may lack it). */
const canAnimate = (view: Window | null | undefined): view is Window =>
  view !== null &&
  view !== undefined &&
  typeof view.requestAnimationFrame === "function";
/** An `AnimationFrames` service over the document window's frames. */
const browserAnimationFrames = (
  document: Document
): DomSubscription.AnimationFrames => {
  const view = document.defaultView;
  return {
    listen: (f) => {
      if (!canAnimate(view)) {
        return (): void => {
          // no frame source on this host
        };
      }
      // Re-arm every frame: the listener hears every frame until detached.
      // Detaching inside the frame callback must stop the loop, so check
      // the flag after `f` runs instead of always re-arming.
      let active = true;
      let id = 0;
      const loop = (time: number): void => {
        if (!active) {
          return;
        }
        f(time);
        if (!active) {
          return;
        }
        id = view.requestAnimationFrame(loop);
      };
      id = view.requestAnimationFrame(loop);
      return () => {
        active = false;
        view.cancelAnimationFrame(id);
      };
    },
    now: () => view?.performance.now() ?? 0,
  };
};

/**
 * The Layer environment a fresh instance resolves Commands, Subscriptions
 * and mounts against. On client mounts it holds the island's `Client`
 * service plus the browser event sources, a fresh `Refs` store and the
 * `Files` and `Images` services; on the server it is empty (nothing runs
 * there anyway).
 *
 * @internal
 */
export const baseEnv = (fiber: FiberLocal): Context.Context<never> => {
  if (fiber.runtime.ssr) {
    return Context.empty();
  }
  const globals: {
    readonly window?: Window | undefined;
    readonly document?: Document | undefined;
  } = globalThis;
  if (globals.window === undefined || globals.document === undefined) {
    return Context.empty();
  }
  const { document } = globals;
  const store: RefsStore = { nodes: new Map() };
  const refs = makeRefs(store);
  // SAFETY: the env only provides services the kernel reads; `never` marks it as requiring nothing.
  return (
    Context.make(Client, {
      document,
      window: globals.window,
    }) as Context.Context<never>
  ).pipe(
    Context.add(Dom.Refs, refs),
    Context.add(DomSubscription.GlobalEvents, browserGlobalEvents(document)),
    Context.add(
      DomSubscription.AnimationFrames,
      browserAnimationFrames(document)
    ),
    Context.add(DomFiles.Files, DomFiles.makeBrowserFiles(document)),
    Context.add(DomImages.Images, DomImages.makeBrowserImages(document))
  );
};
