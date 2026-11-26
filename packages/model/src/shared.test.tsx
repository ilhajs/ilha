/**
 * Ported shared-state tests: owners (`shares`), readers (`reads`),
 * `$.send` and `$.reads`, onChange rounds, collects, optional owners,
 * self reads and the declaration checks. Adapted from Effect UI's
 * `test/Shared.test.ts` (runtime parts only; the Scene/Story harness
 * belongs to `@ilha/model/test`).
 */
import { describe, expect, it } from "bun:test";

import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import { defineComponent } from "./component.ts";
import type { Headless } from "./component.ts";
import * as MessageLog from "./message-log.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const TipMessage = TaggedEnum({ Enter: { id: Schema.String } });

const TipsProviderDef = defineComponent({
  message: TipMessage,
  model: Schema.NullOr(Schema.String),
  name: "TipsProvider",
  props: Schema.Struct({ label: Schema.optional(Schema.String) }),
  shares: {
    receives: ["Enter"],
    value: (open, props) => ({ label: props.label ?? "", open }),
  },
});

// The frozen Headless.Any erases Events to any, which a concrete headless
// component (Events never) is not assignable to through the definition's
// overloaded update. The cast only adjusts the type: the value (and its
// definition identity for owner lookup) is unchanged.
// SAFETY: the cast only adjusts the type; the value (and its definition identity for owner lookup) is unchanged.
// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Headless.Any erases Events to any, so the concrete component does not overlap it directly; the chain goes through unknown.
const TipsProvider = TipsProviderDef.make({
  init: () => null,
  update: (_$, message) => message.id,
}) as unknown as Headless.Any;

const TipDef = defineComponent({
  message: TipMessage,
  model: Schema.Null,
  name: "Tip",
  props: Schema.Struct({ id: Schema.String }),
  reads: { provider: TipsProvider },
});

const Tip = TipDef.make({
  init: () => null,
  update: ($, message) => $.send(TipsProvider, message),
  view: (h) => {
    // SAFETY: the provider shares { open, label } (see TipsProviderDef above); reads.provider is that object.
    const state = h.reads.provider as {
      readonly open: string | null;
      readonly label: string;
    };
    return (
      <button
        id={`tip-${h.props.id}`}
        onclick={h.send(TipMessage.Enter({ id: h.props.id }))}
      >
        {`${h.props.id}:${state.open === h.props.id ? "open" : "closed"}${state.label}`}
      </button>
    );
  },
});

const PageMessage = TaggedEnum({ Label: { label: Schema.String } });

const Page = defineComponent({
  message: PageMessage,
  model: Schema.String,
  name: "Page",
  props: Schema.Struct({}),
}).make({
  init: () => "",
  update: (_$, message) => message.label,
  view: (h, log) => (
    <div>
      <button id="label" onclick={h.send(PageMessage.Label({ label: "!" }))}>
        label
      </button>
      <span id="log">{log}</span>
      <TipsProvider
        key="tips"
        props={{ label: log }}
        view={() => (
          <div>
            <Tip key="a" props={{ id: "a" }} />
          </div>
        )}
      />
    </div>
  ),
});

const withLog = () => {
  const log = MessageLog.makeMemory();
  const detach = MessageLog.attach(log);
  return { detach, log };
};

const updatesAt = (log: MessageLog.Memory, path: string): MessageLog.Update[] =>
  log
    .entries()
    .filter(
      (entry): entry is MessageLog.Update =>
        entry._tag === "Update" && entry.path === path
    );

describe("shared state", () => {
  it("a reader reads its owner's value, and its send reaches the owner as a logged update", async () => {
    const { log, detach } = withLog();
    try {
      const ui = render(() => <Page props={{}} />);
      await ui.settled();
      expect(ui.text()).toContain("a:closed");
      await ui.click("#tip-a");
      await ui.settled();
      expect(ui.text()).toContain("a:open");
      const [sent] = updatesAt(log, "/Page/TipsProvider[tips]/Tip[a]");
      expect(sent).toBeDefined();
      expect(sent.sends.map(MessageLog.encodeSend)).toEqual([
        { message: { _tag: "Enter", id: "a" }, owner: "TipsProvider" },
      ]);
      const [received] = updatesAt(log, "/Page/TipsProvider[tips]");
      expect(received.source).toEqual({
        _tag: "Send",
        path: "/Page/TipsProvider[tips]/Tip[a]",
        seq: sent.seq,
      });
      ui.unmount();
    } finally {
      detach();
    }
  });

  it("re-renders the readers when the owner's props change what it shares", async () => {
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await ui.click("#label");
    await ui.settled();
    expect(ui.text()).toContain("a:closed!");
    ui.unmount();
  });

  it("re-renders the readers only when the shared value changes", async () => {
    const BumpMessage = TaggedEnum({ Bump: {} });
    const ClockDef = defineComponent({
      message: BumpMessage,
      model: Schema.Number,
      name: "Clock",
      props: Schema.Struct({}),
      shares: { value: (n) => Math.floor(n / 2) },
    });
    // SAFETY: the cast only adjusts the type; the value (and its definition identity for owner lookup) is unchanged.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Headless.Any erases Events to any, so the concrete component does not overlap it directly; the chain goes through unknown.
    const Clock = ClockDef.make({
      init: () => 0,
      parts: () => ({}),
      update: ($) => $.model + 1,
    }) as unknown as Headless.Any;
    const WatcherDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "Watcher",
      props: Schema.Struct({}),
      reads: { clock: Clock },
    });
    let watcherViews = 0;
    const Watcher = WatcherDef.make({
      init: () => null,
      update: ($) => $.model,
      view: (h) => {
        watcherViews += 1;
        return <span id="watch">{String(h.reads.clock)}</span>;
      },
    });
    const TickerDef = defineComponent({
      message: BumpMessage,
      model: Schema.Null,
      name: "Ticker",
      props: Schema.Struct({}),
    });
    const Ticker = TickerDef.make({
      init: () => null,
      update: ($, message) => $.send(Clock, message),
      view: (h) => (
        <button id="bump" onclick={h.send(BumpMessage.Bump())}>
          bump
        </button>
      ),
    });
    const App = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "App",
      props: Schema.Struct({}),
    }).make({
      init: () => null,
      update: ($) => $.model,
      view: () => (
        <Clock
          key="c"
          view={() => (
            <div>
              <Watcher key="w" />
              <Ticker key="t" />
            </div>
          )}
        />
      ),
    });
    const ui = render(() => <App props={{}} />);
    await ui.settled();
    expect(ui.text()).toContain("0");
    expect(watcherViews).toBe(1);
    await ui.click("#bump");
    await ui.settled();
    expect(ui.text()).toContain("0");
    expect(watcherViews).toBe(1);
    await ui.click("#bump");
    await ui.settled();
    expect(ui.text()).toContain("1");
    expect(watcherViews).toBe(2);
    ui.unmount();
  });

  it("fails an owner whose shares throws, with source shares", async () => {
    const BrokenDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "Broken",
      props: Schema.Struct({}),
      shares: {
        value: () => {
          throw new Error("broke");
        },
      },
    });
    const Broken = BrokenDef.make({
      init: () => null,
      parts: () => ({}),
      update: ($) => $.model,
    });
    const Top = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "Top",
      props: Schema.Struct({}),
    }).make({
      init: () => null,
      update: ($) => $.model,
      view: () => (
        <Broken
          key="b"
          view={() => <span>never</span>}
          fallback={() => <span id="down">broken down</span>}
        />
      ),
    });
    const { log, detach } = withLog();
    try {
      const ui = render(() => <Top props={{}} />);
      await ui.settled();
      expect(ui.text()).toContain("broken down");
      const failed = log.entries().filter((entry) => entry._tag === "Failed");
      expect(
        failed.map((entry) =>
          entry._tag === "Failed" ? `${entry.path} ${entry.in}` : ""
        )
      ).toEqual(["/Top/Broken[b] shares"]);
      ui.unmount();
    } finally {
      detach();
    }
  });
  it("a parked kept reader contributes no reports to collects", async () => {
    const seen: (readonly unknown[])[] = [];
    const CountMsg = TaggedEnum({
      Bump: {},
      Got: { reports: Schema.Array(Schema.String) },
    });
    const CountDef = defineComponent({
      message: CountMsg,
      model: Schema.Struct({ n: Schema.Number }),
      name: "CollectCount",
      props: Schema.Struct({}),
      shares: {
        collects: {
          onChange: (reports) => {
            seen.push(reports);
            return CountMsg.Got({ reports: reports.map(String) });
          },
          schema: Schema.Array(Schema.String),
        },
        value: (model) => model.n,
      },
    });
    // The frozen Headless.Any erases Events to any (see TipsProvider): the
    // cast only adjusts the type, not the definition identity for lookup.
    // SAFETY: the cast only adjusts the type, not the definition identity for lookup (see TipsProvider).
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Headless.Any erases Events to any, so the concrete component does not overlap it directly; the chain goes through unknown.
    const Count = CountDef.make({
      init: () => ({ n: 0 }),
      parts: () => ({}),
      update: ($, message) =>
        message._tag === "Bump" ? { n: $.model.n + 1 } : $.model,
    }) as unknown as Headless.Any;
    const WatchDef = defineComponent({
      message: TaggedEnum({ Changed: { value: Schema.Unknown } }),
      model: Schema.Number,
      name: "CollectWatcher",
      props: Schema.Struct({}),
      reads: {
        count: {
          onChange: (value) => ({ _tag: "Changed" as const, value }),
          owner: Count,
          report: () => "watcher",
        },
      },
    });
    const Watch = WatchDef.make({
      init: () => 0,
      parts: () => ({}),
      update: ($) => $.model + 1,
    });
    const KeptDef = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "CollectKept",
      props: Schema.Struct({}),
      reads: { count: { owner: Count, report: () => "kept" } },
    });
    const Kept = KeptDef.make({
      init: () => ({}),
      update: () => ({}),
      view: () => <output id="kept">kept</output>,
    });
    const Author = defineComponent({
      message: TaggedEnum({ Toggle: {} }),
      model: Schema.Boolean,
      name: "CollectAuthor",
      props: Schema.Struct({}),
    }).make({
      init: () => true,
      update: { Toggle: ($) => !$.model },
      view: (h, show) => (
        <div>
          <button id="toggle" onclick={h.send({ _tag: "Toggle" })}>
            toggle
          </button>
          {show ? h.keepAlive((s) => s(Kept, { key: "k", props: {} })) : ""}
        </div>
      ),
    });
    const TickerDef = defineComponent({
      message: CountMsg,
      model: Schema.Null,
      name: "CollectTicker",
      props: Schema.Struct({}),
    });
    const Ticker = TickerDef.make({
      init: () => null,
      update: ($, message) => $.send(Count, message),
      view: (h) => (
        <button id="bump" onclick={h.send(CountMsg.Bump())}>
          bump
        </button>
      ),
    });
    const ui = render(() => (
      <Count
        key="c"
        props={{}}
        view={() => (
          <div>
            <Watch key="w" view={() => ""} />
            <Author key="a" props={{}} />
            <Ticker key="t" props={{}} />
          </div>
        )}
      />
    ));
    await ui.settled();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.flat()).toContain("kept");
    // Park the kept reader, then change the shared value: the watcher
    // re-renders and marks collects due, but the parked reader reports
    // nothing.
    await ui.click("#toggle");
    await ui.settled();
    expect(ui.query("#kept")).toBeNull();
    const before = seen.length;
    await ui.click("#bump");
    await ui.settled();
    expect(seen.length).toBeGreaterThan(before);
    for (const reports of seen.slice(before)) {
      expect([...reports]).toEqual(["watcher"]);
    }
    ui.unmount();
  });
});
