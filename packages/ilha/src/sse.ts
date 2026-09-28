import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { atom } from "./atom.ts";
import { getFiber } from "./runtime.ts";
import { isString } from "./shared.ts";
import type {
  AtomHandle,
  EventSourceFeed,
  EventSourceOptions,
  EventSourceStatus,
} from "./types.ts";
import { watch } from "./watch.ts";

interface FeedSink<T> {
  status: AtomHandle<EventSourceStatus>;
  latest: AtomHandle<T | undefined>;
}

interface FeedCell<T> {
  // Keyed by each caller's underlying `latest` atom, which is slot-stable.
  sinks: Map<object, FeedSink<T>>;
  targets: Set<(value: T) => void>;
  stream: Stream.Stream<T, never, never>;
  // One connection per cell, shared by every caller; closed with the last one.
  users: number;
  state: EventSourceStatus;
  last?: { value: T };
  stop?: () => void;
}

const cells = new WeakMap<object, Map<string, unknown>>();

const MAX_BACKOFF_MS = 30_000;

const setStatus = <T>(c: FeedCell<T>, next: EventSourceStatus): void => {
  c.state = next;
  for (const sink of c.sinks.values()) {
    sink.status.set(next);
  }
};

const connect = <T>({
  cell: c,
  decode,
  event,
  retryBase,
  url,
}: {
  cell: FeedCell<T>;
  decode: (raw: string) => T;
  event: string | undefined;
  retryBase: number;
  url: string;
}): (() => void) => {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source: EventSource | undefined;
  let detach: (() => void) | undefined;
  let disposed = false;
  const emit = (value: T): void => {
    c.last = { value };
    for (const sink of c.sinks.values()) {
      sink.latest.set(value);
    }
    for (const push of c.targets) {
      push(value);
    }
  };
  const open = (): void => {
    if (disposed) {
      return;
    }
    setStatus(c, attempt === 0 ? "connecting" : "retrying");
    const es = new EventSource(url);
    source = es;
    const onMessage = (ev: Event): void => {
      // SAFETY: server-sent events arrive as MessageEvent with string data.
      const raw = (ev as MessageEvent).data;
      if (!isString(raw)) {
        return;
      }
      let value: T;
      try {
        value = decode(raw);
      } catch {
        return;
      }
      emit(value);
    };
    const onOpen = (): void => {
      attempt = 0;
      setStatus(c, "open");
    };
    const onError = (): void => {
      if (disposed || es.readyState !== EventSource.CLOSED) {
        return;
      }
      detach?.();
      es.close();
      attempt += 1;
      setStatus(c, "retrying");
      timer = setTimeout(
        open,
        Math.min(retryBase * 2 ** (attempt - 1), MAX_BACKOFF_MS)
      );
    };
    const messageEvent = event ?? "message";
    es.addEventListener(messageEvent, onMessage);
    es.addEventListener("open", onOpen);
    es.addEventListener("error", onError);
    detach = () => {
      es.removeEventListener(messageEvent, onMessage);
      es.removeEventListener("open", onOpen);
      es.removeEventListener("error", onError);
    };
  };
  open();
  return () => {
    disposed = true;
    clearTimeout(timer);
    detach?.();
    source?.close();
    setStatus(c, "closed");
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
  // oxlint-disable-next-line unicorn/no-useless-undefined -- the feed starts valueless; undefined is the seed
  const latest = atom<T | undefined>(undefined);

  const feedKey = `${url}\n${opts?.event ?? ""}`;
  let byKey = cells.get(fiber);
  if (!byKey) {
    byKey = new Map();
    cells.set(fiber, byKey);
  }
  // SAFETY: one feed per (fiber, url, event); T matches because the call-site options are stable.
  let cell = byKey.get(feedKey) as FeedCell<T> | undefined;
  if (!cell) {
    const targets = new Set<(value: T) => void>();
    const stream: Stream.Stream<T, never, never> = fiber.runtime.ssr
      ? Stream.empty
      : Stream.callback<T>((queue) => {
          const push = (value: T): void => {
            Queue.offerUnsafe(queue, value);
          };
          targets.add(push);
          return Effect.acquireRelease(Effect.void, () =>
            Effect.sync(() => targets.delete(push))
          );
        });
    cell = {
      sinks: new Map(),
      state: "connecting",
      stream,
      targets,
      users: 0,
    };
    byKey.set(feedKey, cell);
  }
  // SAFETY: slots reuse the same underlying atoms across renders, so any
  // generation of handles reads and writes the same values.
  const sinkKey = latest.atom;
  cell.sinks.set(sinkKey, { latest, status });
  const c = cell;

  // SAFETY: without a schema T defaults to string, so identity is exact.
  const decode = opts?.schema ?? ((raw: string) => raw as T);
  const retryBase = opts?.retryBaseMs ?? 1000;

  // Runs once per mount for slot stability; the callback itself runs once.
  watch.once(() => {
    if (fiber.runtime.ssr || globalThis.EventSource === undefined) {
      status.set("closed");
      return;
    }
    c.users += 1;
    if (c.stop) {
      // Join the live connection: catch this caller up to its state.
      status.set(c.state);
      if (c.last) {
        latest.set(c.last.value);
      }
    } else {
      c.stop = connect({
        cell: c,
        decode,
        event: opts?.event,
        retryBase,
        url,
      });
    }
    return () => {
      c.users -= 1;
      if (c.users === 0) {
        const { stop } = c;
        c.stop = undefined;
        stop?.();
      }
      c.sinks.delete(sinkKey);
    };
  });

  return { latest, status, stream: c.stream };
};
