import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { atom } from "./atom.ts";
import { getFiber } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import { isString } from "./shared.ts";
import type {
  AtomHandle,
  EventSourceFeed,
  EventSourceOptions,
  EventSourceStatus,
} from "./types.ts";
import { watch } from "./watch.ts";

interface Sink<T> {
  status: AtomHandle<EventSourceStatus>;
  latest: AtomHandle<T | undefined>;
}

/** One connection per (fiber, url, event), shared by every caller there. */
interface Feed<T> {
  sinks: Set<Sink<T>>;
  pushes: Set<(value: T) => void>;
  stream: Stream.Stream<T>;
  state: EventSourceStatus;
  last?: { value: T };
  stop?: () => void;
}

const feeds = new WeakMap<FiberLocal, Map<string, unknown>>();

const MAX_BACKOFF_MS = 30_000;

/** Open `url` and keep it open with exponential backoff until stopped. */
const connect = <T>(
  feed: Feed<T>,
  url: string,
  opts: EventSourceOptions<T> | undefined
): (() => void) => {
  const setStatus = (next: EventSourceStatus): void => {
    feed.state = next;
    for (const sink of feed.sinks) {
      sink.status.set(next);
    }
  };
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: EventSource | undefined;
  const open = (): void => {
    setStatus(attempt === 0 ? "connecting" : "retrying");
    const es = new EventSource(url);
    current = es;
    es.addEventListener(opts?.event ?? "message", (ev) => {
      // SAFETY: server-sent events arrive as MessageEvent.
      const { data } = ev as MessageEvent;
      if (es !== current || !isString(data)) {
        return;
      }
      let value: T;
      try {
        // SAFETY: without a schema T defaults to string.
        value = opts?.schema ? opts.schema(data) : (data as T);
      } catch {
        return;
      }
      feed.last = { value };
      for (const sink of feed.sinks) {
        sink.latest.set(value);
      }
      for (const push of feed.pushes) {
        push(value);
      }
    });
    es.addEventListener("open", () => {
      if (es === current) {
        attempt = 0;
        setStatus("open");
      }
    });
    es.addEventListener("error", () => {
      if (es !== current || es.readyState !== EventSource.CLOSED) {
        return;
      }
      es.close();
      attempt += 1;
      setStatus("retrying");
      const base = opts?.retryBaseMs ?? 1000;
      timer = setTimeout(
        open,
        Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS)
      );
    });
  };
  open();
  return () => {
    clearTimeout(timer);
    current?.close();
    current = undefined;
    setStatus("closed");
  };
};

/**
 * Subscribe to server-sent events. Opens one connection per `(url, event)`
 * per component, reconnects with backoff, and closes on unmount. SSR renders
 * an empty stream with status `"closed"`. Call unconditionally at the top
 * level of a component.
 */
export const fromEventSource = <T = string>(
  url: string,
  opts?: EventSourceOptions<T>
): EventSourceFeed<T> => {
  const fiber = getFiber();
  const status = atom<EventSourceStatus>("connecting");
  // oxlint-disable-next-line unicorn/no-useless-undefined -- the feed starts valueless
  const latest = atom<T | undefined>(undefined);

  let byKey = feeds.get(fiber);
  if (!byKey) {
    byKey = new Map();
    feeds.set(fiber, byKey);
  }
  const key = `${url}\n${opts?.event ?? ""}`;
  // SAFETY: one feed per (fiber, url, event); call-site options fix its T.
  let feed = byKey.get(key) as Feed<T> | undefined;
  if (!feed) {
    const pushes = new Set<(value: T) => void>();
    feed = {
      pushes,
      sinks: new Set(),
      state: "connecting",
      stream: fiber.runtime.ssr
        ? Stream.empty
        : Stream.callback<T>((queue) => {
            const push = (value: T): void => {
              Queue.offerUnsafe(queue, value);
            };
            pushes.add(push);
            return Effect.acquireRelease(Effect.void, () =>
              Effect.sync(() => pushes.delete(push))
            );
          }),
    };
    byKey.set(key, feed);
  }
  const f = feed;

  watch.once(() => {
    if (fiber.runtime.ssr || globalThis.EventSource === undefined) {
      status.set("closed");
      return;
    }
    const sink: Sink<T> = { latest, status };
    f.sinks.add(sink);
    if (f.stop) {
      // Join the live connection: catch this caller up to its state.
      status.set(f.state);
      if (f.last) {
        latest.set(f.last.value);
      }
    } else {
      f.stop = connect(f, url, opts);
    }
    return () => {
      f.sinks.delete(sink);
      if (f.sinks.size === 0) {
        f.stop?.();
        f.stop = undefined;
      }
    };
  });

  return { latest, status, stream: f.stream };
};
