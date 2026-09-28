// @jsxImportSource ../src
import { afterEach, expect, test } from "bun:test";

import * as Stream from "effect/Stream";

import { fromEventSource, mount } from "../src/index.ts";

type Handler = (ev: Event) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onmessage: Handler | null = null;
  onopen: Handler | null = null;
  onerror: Handler | null = null;
  closed = false;
  private handlers = new Map<string, Set<Handler>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Handler): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: Handler): void {
    this.handlers.get(type)?.delete(fn);
  }

  emit(type: string, ev: Event): void {
    if (type === "message") {
      this.onmessage?.(ev);
    }
    if (type === "open") {
      this.onopen?.(ev);
    }
    if (type === "error") {
      this.onerror?.(ev);
    }
    for (const fn of this.handlers.get(type) ?? []) {
      fn(ev);
    }
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.emit("open", new Event("open"));
  }

  message(data: string, event = "message"): void {
    const ev = new MessageEvent(event, { data });
    this.emit(event, ev);
  }

  fail(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.emit("error", new Event("error"));
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
}

const realEventSource = globalThis.EventSource;

afterEach(() => {
  globalThis.EventSource = realEventSource;
  FakeEventSource.instances = [];
  document.body.replaceChildren();
});

const install = (): void => {
  const fake: unknown = FakeEventSource;
  // SAFETY: test fake implementing the EventSource surface fromEventSource uses.
  globalThis.EventSource = fake as typeof EventSource;
  FakeEventSource.instances = [];
};

const StatusApp = () => {
  const feed = fromEventSource("https://x.test/feed");
  return (
    <p>
      {feed.status()}:{feed.latest() ?? "none"}
    </p>
  );
};

const NumsApp = () => {
  const feed = fromEventSource("https://x.test/nums", {
    schema: (raw) => {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        throw new TypeError("bad number");
      }
      return n;
    },
  });
  return <p>{feed.latest() ?? "none"}</p>;
};

const FlakyApp = () => {
  const feed = fromEventSource("https://x.test/flaky", { retryBaseMs: 1 });
  return <p>{feed.status()}</p>;
};
const StreamFeed = function* StreamFeed() {
  const feed = fromEventSource("https://x.test/stream");
  yield feed.stream.pipe(Stream.map((msg) => <li>{msg}</li>));
};
test("fromEventSource paints messages and status", async () => {
  install();
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, StatusApp);
  expect(el.textContent).toBe("connecting:none");
  const [source] = FakeEventSource.instances;
  source?.open();
  await Bun.sleep(5);
  expect(el.textContent).toBe("open:none");
  source?.message("hello");
  await Bun.sleep(5);
  expect(el.textContent).toBe("open:hello");
  el.remove();
});

test("fromEventSource decodes with schema and skips invalid", async () => {
  install();
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, NumsApp);
  const [source] = FakeEventSource.instances;
  source?.open();
  source?.message("oops");
  await Bun.sleep(5);
  expect(el.textContent).toBe("none");
  source?.message("42");
  await Bun.sleep(5);
  expect(el.textContent).toBe("42");
  el.remove();
});

test("fromEventSource reconnects after failure", async () => {
  install();
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, FlakyApp);
  const [first] = FakeEventSource.instances;
  first?.open();
  await Bun.sleep(5);
  expect(el.textContent).toBe("open");
  first?.fail();
  await Bun.sleep(10);
  expect(FakeEventSource.instances.length).toBe(2);
  const [, second] = FakeEventSource.instances;
  second?.open();
  await Bun.sleep(5);
  expect(el.textContent).toBe("open");
  unmount();
  expect(second?.closed).toBe(true);
  el.remove();
});

test("fromEventSource stream paints via Stream.map", async () => {
  install();
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, StreamFeed);
  await Bun.sleep(10);
  const [source] = FakeEventSource.instances;
  source?.open();
  source?.message("a");
  await Bun.sleep(10);
  source?.message("b");
  await Bun.sleep(10);
  expect(el.textContent).toBe("b");
  el.remove();
});
