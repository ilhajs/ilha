/**
 * Ported MessageLog tests: service defaults, sinks, Wire encoding,
 * redaction, placeholders and truncation. Runtime-driven cases (replay
 * through `Story.fromLog`, mount/settle flows) belong to later waves; every
 * case here builds its entries by hand.
 */
// oxlint-disable-next-line eslint/max-classes-per-file -- the file builds one Schema-declared fixture class per cyclic test shape; they belong with their cases.
import { describe, expect, it } from "bun:test";

import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Scope from "effect/Scope";
import * as Socket from "effect/socket/Socket";

import * as MessageLog from "./message-log.ts";

const PropsSchema = Schema.Struct({ initial: Schema.Number });
const ModelSchema = Schema.Struct({ count: Schema.Number });
const CounterMessage = Schema.Union([
  Schema.TaggedStruct("Increment", { amount: Schema.Number }),
  Schema.TaggedStruct("Reset", {}),
]);
const CounterEvents = Schema.Struct({ count: Schema.Number });

/** A minimal component view, as the component runtime builds when it records. */
const Counter: MessageLog.LoggedComponent = {
  definition: {
    events: CounterEvents,
    message: CounterMessage,
    model: ModelSchema,
    name: "Counter",
    props: PropsSchema,
    receives: Schema.Never,
  },
};

const Owner: MessageLog.LoggedComponent = {
  definition: {
    events: Schema.Never,
    message: Schema.Struct({}),
    model: Schema.Struct({}),
    name: "Owner",
    props: Schema.Struct({}),
    receives: Schema.Struct({ ping: Schema.Number }),
  },
};

const instance = {
  component: Counter,
  instance: 1,
  path: "/Counter",
};

const mounted: MessageLog.Mounted = {
  _tag: "Mounted",
  at: 0,
  seq: 1,
  session: "s",
  ...instance,
  adopted: false,
  commands: [],
  events: [],
  model: { count: 1 },
  props: { initial: 1 },
};

const page = (note: string) => ({ note, "secret-a": "must-not-log" });

// SAFETY: `frame` is a `WireEntry`, so decoding its JSON round-trip yields the same entry.
const roundTrip = (frame: MessageLog.WireEntry): MessageLog.WireEntry =>
  Schema.decodeUnknownSync(MessageLog.Wire)(
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON round-trip also proves the frame survives serialization for the Wire.
    JSON.parse(JSON.stringify(frame))
  ) as MessageLog.WireEntry;

describe("MessageLog service", () => {
  it("is off by default", () => {
    expect(MessageLog.noop.enabled).toBe(false);
    expect(Context.get(Context.empty(), MessageLog.MessageLog).enabled).toBe(
      false
    );
  });

  it("memory keeps the last entries, and fanout feeds several logs", () => {
    const memory = MessageLog.makeMemory({ size: 2 });
    const other = MessageLog.makeMemory();
    const log = MessageLog.fanoutAll([memory, other, MessageLog.noop]);
    for (let seq = 1; seq <= 3; seq += 1) {
      log.record({
        _tag: "Unmounted",
        at: 0,
        seq,
        session: "s",
        ...instance,
      });
    }
    expect(memory.entries().map((entry) => entry.seq)).toEqual([2, 3]);
    expect(other.entries().map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(MessageLog.fanoutAll([MessageLog.noop]).enabled).toBe(false);
  });

  it("fanout keeps the other services its Layers provide", async () => {
    await Effect.runPromise(
      Effect.gen(function* fanoutScope() {
        class Extra extends Context.Service<Extra, string>()("test/Extra") {}
        const memory = MessageLog.makeMemory();
        const services = yield* Layer.build(
          MessageLog.fanout([
            Layer.succeedContext(
              Context.make(MessageLog.MessageLog, memory).pipe(
                Context.add(Extra, "kept")
              )
            ),
            Layer.succeed(MessageLog.MessageLog, MessageLog.makeMemory()),
          ])
        );
        // SAFETY: `fanout` keeps `Extra` at runtime (asserted by the `toBe` below), so reading it back through the same reference is sound.
        // oxlint-disable-next-line typescript/no-explicit-any -- `fanout` keeps `Extra` at runtime, which its Layer type cannot express; the assertion checks the runtime contract.
        expect(Context.get(services, Extra as any)).toBe("kept");
        const log = Context.get(services, MessageLog.MessageLog);
        log.record({
          _tag: "Unmounted",
          at: 0,
          seq: 1,
          session: "s",
          ...instance,
        });
        expect(memory.entries().length).toBe(1);
      }).pipe(Effect.scoped)
    );
  });

  it("makeEncoded queues on record, batches as Wire frames, recovers when onBatch dies, and drops after its Scope", async () => {
    await Effect.runPromise(
      Effect.gen(function* batchScope() {
        const batches: (readonly MessageLog.WireEntry[])[] = [];
        const scope = yield* Scope.make();
        const log = yield* MessageLog.makeEncoded((batch) =>
          batch[0]?.seq === 3
            ? Effect.die("inspector broke")
            : Effect.sync(() => batches.push(batch))
        ).pipe(Scope.provide(scope));
        log.record({
          _tag: "SessionStarted",
          app: "A",
          at: 0,
          seq: 1,
          session: "s",
        });
        log.record({
          _tag: "SessionStarted",
          app: "B",
          at: 0,
          seq: 2,
          session: "s",
        });
        expect(batches).toEqual([]);
        yield* Effect.yieldNow;
        expect(batches).toEqual([
          [
            { _tag: "SessionStarted", app: "A", at: 0, seq: 1, session: "s" },
            { _tag: "SessionStarted", app: "B", at: 0, seq: 2, session: "s" },
          ],
        ]);
        log.record({
          _tag: "SessionStarted",
          app: "C",
          at: 0,
          seq: 3,
          session: "s",
        });
        yield* Effect.yieldNow;
        log.record({
          _tag: "SessionStarted",
          app: "D",
          at: 0,
          seq: 4,
          session: "s",
        });
        yield* Effect.yieldNow;
        expect(batches.map((batch) => batch.map((frame) => frame.seq))).toEqual(
          [[1, 2], [4]]
        );
        yield* Scope.close(scope, Exit.void);
        log.record({
          _tag: "SessionStarted",
          app: "E",
          at: 0,
          seq: 5,
          session: "s",
        });
        yield* Effect.yieldNow;
        expect(batches.length).toBe(2);
      })
    );
  });
});

describe("MessageLog Wire encoding", () => {
  it("truncates a Model over maxEntryBytes", () => {
    const encoder = MessageLog.makeEncoder({ maxEntryBytes: 10 });
    const entry: MessageLog.Mounted = {
      ...mounted,
      model: { count: 123_456_789 },
      props: { initial: 123_456_789 },
    };
    const wire = encoder.encode(entry);
    // SAFETY: the entry is a `Mounted` one, so encoding it yields a frame with a `model`.
    expect((wire as { readonly model: unknown }).model).toEqual({
      "~truncated": 19,
    });
  });

  it("truncates a message over maxEntryBytes, as it does a Model", () => {
    // The message is 39 bytes and the Model 11.
    const encoder = MessageLog.makeEncoder({ maxEntryBytes: 15 });
    const entry: MessageLog.Update = {
      _tag: "Update",
      at: 0,
      seq: 2,
      session: "s",
      ...instance,
      commands: [],
      events: [],
      lists: [],
      message: { _tag: "Increment", amount: 123_456_789 },
      model: { count: 1 },
      props: { initial: 1 },
      sends: [],
      source: { _tag: "Dispatch" },
    };
    // SAFETY: the entry is an `Update` one, so encoding it yields a frame with a message and a model.
    const wire = encoder.encode(entry) as {
      readonly message: unknown;
      readonly model: unknown;
    };
    expect(wire.message).toEqual({ "~truncated": 39 });
    expect(wire.model).toEqual({ count: 1 });
  });

  it("encodes FetchStarted on the Wire as it is, and decodes it back", () => {
    const entry: MessageLog.FetchStarted = {
      _tag: "FetchStarted",
      at: 10,
      inWindow: false,
      logKey: `{"id":"1"}`,
      query: "users/GetUser",
      restart: false,
      seq: 3,
      session: "s",
      stored: true,
      trigger: "visibility",
    };
    const wire = MessageLog.makeEncoder().encode(entry);
    expect(wire).toEqual(entry);
    expect(roundTrip(wire)).toEqual(wire);
  });

  it("Redacted values in component Schemas are sent as placeholders", () => {
    class User extends Schema.Class<User>("User")({
      name: Schema.String,
      pin: Schema.Redacted(Schema.Number),
    }) {}
    const Secret: MessageLog.LoggedComponent = {
      definition: {
        events: Schema.Redacted(Schema.String),
        message: Schema.Union([
          Schema.TaggedStruct("Login", {
            password: Schema.Redacted(Schema.String),
          }),
        ]),
        model: Schema.Struct({
          fromValue: Schema.RedactedFromValue(Schema.String),
          maybe: Schema.optional(Schema.Redacted(Schema.String)),
          option: Schema.Option(Schema.Redacted(Schema.String)),
          token: Schema.Redacted(Schema.String),
          users: Schema.Array(User),
        }),
        name: "Secret",
        props: Schema.Struct({ key: Schema.Redacted(Schema.String) }),
        receives: Schema.Never,
      },
    };
    const placeholder = { "~redacted": true };
    const warnings: string[] = [];
    const entry: MessageLog.Update = {
      _tag: "Update",
      at: 0,
      commands: [],
      component: Secret,
      events: [Redacted.make("e")],
      instance: 1,
      lists: [],
      message: { _tag: "Login", password: Redacted.make("hunter2") },
      model: {
        fromValue: Redacted.make("v"),
        maybe: Redacted.make("m"),
        option: Option.some(Redacted.make("o")),
        token: Redacted.make("t"),
        users: [new User({ name: "ada", pin: Redacted.make(1234) })],
      },
      path: "/Secret",
      props: { key: Redacted.make("k") },
      sends: [],
      seq: 1,
      session: "s",
      source: { _tag: "Dispatch" },
    };
    // SAFETY: the entry is an `Update` one, so encoding it yields a frame with a message, props, model and events.
    const wire = MessageLog.makeEncoder({
      onWarning: (warning) => warnings.push(warning),
    }).encode(entry) as {
      readonly message: unknown;
      readonly props: unknown;
      readonly model: unknown;
      readonly events: unknown;
    };
    expect(wire.message).toEqual({ _tag: "Login", password: placeholder });
    expect(wire.props).toEqual({ key: placeholder });
    expect(wire.model).toEqual({
      fromValue: placeholder,
      maybe: placeholder,
      option: { _tag: "Some", value: placeholder },
      token: placeholder,
      users: [{ name: "ada", pin: placeholder }],
    });
    expect(wire.events).toEqual([placeholder]);
    expect(warnings).toEqual([]);
  });

  it("Redacted values inside declarations and transformations are sent as placeholders", () => {
    const Secret = Schema.RedactedFromValue(Schema.String);
    class Holder extends Schema.Class<Holder>("Holder")({ secret: Secret }) {}
    const Model = Schema.Struct({
      encodedSide: Schema.Redacted(Schema.String).pipe(
        Schema.decodeTo(
          Schema.String,
          SchemaTransformation.transform({
            decode: Redacted.value,
            encode: Redacted.make,
          })
        )
      ),
      map: Schema.ReadonlyMap(Schema.String, Secret),
      nested: Schema.Option(Schema.Option(Holder)),
      option: Schema.Option(Secret),
      plain: Schema.Option(Schema.ReadonlyMap(Schema.String, Schema.Date)),
    });
    const model: typeof Model.Type = {
      encodedSide: "s4",
      map: new Map([["k", Redacted.make("s3")]]),
      nested: Option.some(
        Option.some(new Holder({ secret: Redacted.make("s2") }))
      ),
      option: Option.some(Redacted.make("s1")),
      plain: Option.some(new Map([["at", new Date(0)]])),
    };
    const Secrets: MessageLog.LoggedComponent = {
      definition: {
        events: Schema.Never,
        message: Schema.Never,
        model: Model,
        name: "Secrets",
        props: Schema.Struct({}),
        receives: Schema.Never,
      },
    };
    const placeholder = { "~redacted": true };
    // SAFETY: the entry is a `Mounted` one, so encoding it yields a frame with a `model`.
    const wire = MessageLog.makeEncoder().encode({
      ...mounted,
      component: Secrets,
      model,
      path: "/Secrets",
      props: {},
    }) as { readonly model: unknown };
    expect(wire.model).toEqual({
      encodedSide: placeholder,
      map: [["k", placeholder]],
      nested: {
        _tag: "Some",
        value: { _tag: "Some", value: { secret: placeholder } },
      },
      option: { _tag: "Some", value: placeholder },
      // Schemas without a Redacted value encode as `Schema.toCodecJson` does.
      plain: Schema.encodeSync(Schema.toCodecJson(Model.fields.plain))(
        model.plain
      ),
    });
  });

  it("masks overlapping keys, and sends any part its Schema rejects as a placeholder", () => {
    const EncodedSecret = Schema.Redacted(Schema.String).pipe(
      Schema.decodeTo(
        Schema.String,
        SchemaTransformation.transform({
          decode: Redacted.value,
          encode: Redacted.make,
        })
      )
    );
    const Secret = Schema.Record(
      Schema.TemplateLiteral(["secret-", Schema.String]),
      EncodedSecret
    );
    const Loose = Schema.Record(Schema.String, Schema.Unknown);
    const Checked = Schema.Array(Schema.Number).check(Schema.isMinLength(2));
    for (const order of [
      [Secret, Loose],
      [Loose, Secret],
    ] as const) {
      // SAFETY: both signature orders are checked through the same pair on purpose, so naming this iteration's order is sound.
      const signatures = order as readonly [typeof Secret, typeof Loose];
      const Page = Schema.StructWithRest(Schema.Struct({}), signatures);
      const Entries = Schema.StructWithRest(
        Schema.Struct({ list: Checked, n: Schema.Number }),
        signatures
      );
      const State = Schema.Struct({
        entries: Entries,
        pages: Schema.Array(Page).check(Schema.isMinLength(2)),
      });
      // SAFETY: the fixture deliberately holds a rejected sibling value the precise type forbids, so the test decodes it anyway.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the fixture deliberately holds a value the precise type forbids; the unknown hop is the only way to build it.
      const state = {
        entries: {
          list: [987_654_321],
          n: "rejected-sibling",
          "secret-a": "must-not-log",
        },
        pages: [page("unchecked-page")],
      } as unknown as typeof State.Type;
      const VaultMessage = Schema.Union([
        Schema.TaggedStruct("Set", { state: State }),
      ]);
      const Vault: MessageLog.LoggedComponent = {
        definition: {
          events: Schema.Never,
          message: VaultMessage,
          model: State,
          name: "Vault",
          props: State,
          receives: Schema.Never,
        },
      };
      const vaultMounted: MessageLog.Mounted = {
        _tag: "Mounted",
        adopted: false,
        at: 0,
        commands: [],
        component: Vault,
        events: [],
        instance: 1,
        model: state,
        path: "/Vault",
        props: state,
        seq: 1,
        session: "s",
      };
      const vaultUpdate: MessageLog.Update = {
        _tag: "Update",
        at: 0,
        commands: [],
        component: Vault,
        events: [],
        instance: 1,
        lists: [],
        message: {
          _tag: "Set",
          state: {
            entries: { ...state.entries, other: 1 },
            pages: [page("checked-page"), page("checked-page")],
          },
        },
        model: {
          entries: { ...state.entries, other: 1 },
          pages: [page("checked-page"), page("checked-page")],
        },
        path: "/Vault",
        props: state,
        sends: [],
        seq: 2,
        session: "s",
        source: { _tag: "Dispatch" },
      };
      const frames: MessageLog.WireEntry[] = [];
      const warnings: string[] = [];
      const encoder = MessageLog.makeEncoder({
        onWarning: (warning) => warnings.push(warning),
      });
      for (const entry of [vaultMounted, vaultUpdate]) {
        frames.push(encoder.encode(entry));
      }
      const json = JSON.stringify(frames);
      // SAFETY: `frames` only holds `WireEntry` frames, so parsing their JSON round-trip back yields entries.
      const copied = (JSON.parse(json) as MessageLog.WireEntry[]).map((frame) =>
        roundTrip(frame)
      );
      const failed = { "~unserialisable": "encode" };
      const redacted = { "~redacted": true };
      const masked = { list: failed, n: failed, "secret-a": redacted };
      const checkedPage = { note: "checked-page", "secret-a": redacted };
      const before = { entries: masked, pages: failed };
      for (const received of [frames, copied]) {
        const receivedMounted = received.find(
          (frame) => frame._tag === "Mounted"
        );
        const update = received.find((frame) => frame._tag === "Update");
        if (receivedMounted === undefined || update === undefined) {
          throw new Error("expected a Mounted and an Update frame");
        }
        // SAFETY: the frame is the `Mounted` one found above, so its `props` are present.
        expect((receivedMounted as { readonly props: unknown }).props).toEqual(
          before
        );
        // SAFETY: the frame is the `Mounted` one found above, so its `model` is present.
        expect((receivedMounted as { readonly model: unknown }).model).toEqual(
          before
        );
        // SAFETY: `update` is an `Update` frame here, so its `message` is present.
        expect((update as { readonly message: unknown }).message).toEqual(
          failed
        );
        // SAFETY: `update` is an `Update` frame here, so its `model` is present.
        expect((update as { readonly model: unknown }).model).toEqual({
          entries: { ...masked, other: 1 },
          pages: [checkedPage, checkedPage],
        });
      }
      for (const value of [
        "must-not-log",
        "rejected-sibling",
        "987654321",
        "unchecked-page",
      ]) {
        expect(json).not.toContain(value);
      }
      expect(
        warnings.map((message) => message.split(" failed")[0]).toSorted()
      ).toEqual([
        "MessageLog: Vault.message",
        "MessageLog: Vault.model",
        "MessageLog: Vault.props",
      ]);
    }
    const Keep: MessageLog.LoggedCommand = {
      _tag: "Effect",
      args: { list: [987_654_321] },
      argsSchema: Schema.Struct({ list: Schema.Array(Schema.Number) }),
      groupKey: undefined,
      name: "Keep",
    };
    expect(MessageLog.encodeCommand(Keep).args).toEqual({
      list: [987_654_321],
    });
  });

  it("encodes a cyclic arg with a placeholder for the cycle, instead of overflowing", () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional interface+const pair
    interface Node {
      readonly label: string;
      readonly secret: Redacted.Redacted<string>;
      readonly next: Node | null;
    }
    // oxlint-disable-next-line eslint/no-redeclare -- intentional interface+const pair
    const Node: Schema.Codec<Node, unknown> = Schema.Struct({
      label: Schema.String,
      next: Schema.NullOr(
        Schema.suspend((): Schema.Codec<Node, unknown> => Node)
      ),
      secret: Schema.Redacted(Schema.String),
    });
    // oxlint-disable-next-line eslint/no-redeclare -- intentional interface+const pair
    interface Link {
      readonly next: Link;
    }
    const Link: Schema.Codec<Link> = Schema.Struct({
      next: Schema.suspend((): Schema.Codec<Link> => Link),
    });
    const argsSchema = Schema.Struct({
      link: Link,
      list: Schema.Array(Schema.Unknown),
      node: Node,
    });
    const node: {
      label: string;
      secret: Redacted.Redacted<string>;
      next: unknown;
      // oxlint-disable-next-line anti-slop/no-known-value-widening -- the node is cyclic, so `next` must stay loose until the self-reference below; the Schema owns its contract.
    } = {
      label: "a",
      next: null,
      secret: Redacted.make("must-not-log"),
    };
    node.next = node;
    const list: unknown[] = [1];
    list.push(list);
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- the link is cyclic, so `next` must stay loose until the self-reference below; the Schema owns its contract.
    const link: { next: unknown } = { next: null };
    link.next = link;
    // SAFETY: `link` and `node` are assigned their cyclic references just above, so reading them through the cyclic Schemas is sound.
    const encoded = MessageLog.encodeCommand({
      _tag: "Effect",
      args: { link: link as Link, list, node: node as Node },
      argsSchema,
      groupKey: undefined,
      name: "Walk",
    });
    expect(encoded.args).toEqual({
      link: { next: { "~unserialisable": "cycle" } },
      list: [1, { "~unserialisable": "cycle" }],
      node: {
        label: "a",
        next: { "~unserialisable": "cycle" },
        secret: { "~redacted": true },
      },
    });
    expect(JSON.stringify(encoded)).not.toContain("must-not-log");
  });

  it("encodes a Command's group fields redacted, as canonical JSON", () => {
    const argsSchema = Schema.Struct({
      room: Schema.String,
      token: Schema.Redacted(Schema.String),
    });
    const groupSchema = Schema.Struct({
      room: Schema.String,
      token: Schema.Redacted(Schema.String),
    });
    const noGroup: MessageLog.LoggedCommand = {
      _tag: "Effect",
      args: { room: "r", token: Redacted.make("s") },
      argsSchema,
      groupKey: undefined,
      name: "Join",
    };
    expect(MessageLog.encodeCommand(noGroup)).toEqual({
      _tag: "Effect",
      args: { room: "r", token: { "~redacted": true } },
      group: null,
      name: "Join",
    });
    const grouped: MessageLog.LoggedCommand = {
      _tag: "Effect",
      args: { room: "r", token: Redacted.make("s") },
      argsSchema,
      groupKey: `{"room":"r"}`,
      name: "Join",
      "~group": {
        key: `{"room":"r"}`,
        picked: { room: "r", token: Redacted.make("s") },
        schema: groupSchema,
      },
    };
    expect(MessageLog.encodeCommand(grouped).group).toBe(
      `{"room":"r","token":{"~redacted":true}}`
    );
    const interrupt: MessageLog.LoggedCommand = {
      _tag: "Interrupt",
      args: {},
      argsSchema,
      groupKey: undefined,
      name: "Join",
    };
    expect(MessageLog.encodeCommand(interrupt).args).toBe(null);
  });

  it("encodes a send through the owner's receives Schema", () => {
    expect(
      MessageLog.encodeSend({
        message: { ping: 1 },
        owner: Owner,
      })
    ).toEqual({ message: { ping: 1 }, owner: "Owner" });
  });

  it("encodes Subscription deps with -0 as 0 and non-finite numbers as placeholders", () => {
    const started: MessageLog.SubscriptionStarted = {
      _tag: "SubscriptionStarted",
      at: 0,
      seq: 1,
      session: "s",
      ...instance,
      deps: [-0, Number.NaN, Number.POSITIVE_INFINITY, "42", true, null],
      key: "room",
      name: "room",
    };
    // SAFETY: `started` is a `SubscriptionStarted` entry, so encoding it yields a frame with `deps`.
    const wire = MessageLog.makeEncoder().encode(started) as {
      readonly deps: unknown;
    };
    expect(wire.deps).toEqual([
      0,
      { "~unserialisable": "number" },
      { "~unserialisable": "number" },
      "42",
      true,
      null,
    ]);
  });
});

describe("MessageLog entries", () => {
  const Theme: MessageLog.LoggedComponent = {
    definition: {
      events: Schema.Never,
      message: Schema.Struct({}),
      model: Schema.Struct({}),
      name: "Theme",
      props: Schema.Struct({}),
      receives: Schema.Never,
      sharesSchema: Schema.Struct({ mode: Schema.String }),
    },
  };
  // A struct Schema holds its fields; the log reads per-query results through them.
  // SAFETY: both signature orders flow through the same pair on purpose, so naming this iteration's order only states which union member is checked.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the fixture deliberately feeds both orders through one alias; the precise order type cannot name both at once.
  const queryLogSchema = Schema.Struct({
    user: Schema.Struct({ name: Schema.String }),
  }) as unknown as MessageLog.ResultsLogSchema;
  const Reader: MessageLog.LoggedComponent = {
    definition: {
      ...Counter.definition,
      name: "Reader",
      reads: [{ name: "theme", owner: Theme }],
      receives: Schema.Never,
    },
    "~queries": { logSchema: queryLogSchema },
  };
  const Queried: MessageLog.LoggedComponent = {
    definition: {
      ...Counter.definition,
      name: "Queried",
      receives: Schema.Never,
    },
    "~queries": { logSchema: queryLogSchema },
  };
  const issued = { index: 0, seq: 2 };
  const saveCommand: MessageLog.LoggedCommand = {
    _tag: "Effect",
    args: { n: 1 },
    argsSchema: Schema.Struct({ n: Schema.Number }),
    groupKey: undefined,
    name: "test/Save",
  };

  it("encodes every entry tag, and each frame decodes back to itself", () => {
    const mountArgsSchema = Schema.Struct({
      token: Schema.Redacted(Schema.String),
    });
    const entries: MessageLog.Entry[] = [
      { _tag: "SessionStarted", app: "A", at: 0, seq: 1, session: "s" },
      {
        _tag: "FetchStarted",
        at: 10,
        cursor: "cursor-1",
        inWindow: true,
        logKey: `{"id":"1"}`,
        page: 1,
        query: "users/GetUser",
        restart: true,
        seq: 2,
        session: "s",
        stored: false,
        trigger: "invalidation",
      },
      {
        _tag: "Waiting",
        at: 0,
        seq: 3,
        session: "s",
        ...instance,
        boundary: 7,
        model: { count: 1 },
        props: { initial: 1 },
      },
      {
        ...mounted,
        component: Queried,
        // SAFETY: the entry carries `queries`, so the frame keeps them as results.
        queries: { user: { name: "ada" } } as MessageLog.Results,
        seq: 4,
      },
      {
        _tag: "Update",
        at: 0,
        boundary: 7,
        causedBy: 1,
        commands: [saveCommand],
        component: Reader,
        events: [{ count: 2 }],
        instance: 2,
        lists: [{ name: "items", op: "loadMore" }],
        message: { _tag: "Increment", amount: 1 },
        model: { count: 2 },
        path: "/Reader",
        props: { initial: 1 },
        queries: { user: { name: "ada" } },
        sends: [{ message: { ping: 1 }, owner: Owner }],
        seq: 5,
        session: "s",
        shared: { theme: { mode: "dark" } },
        source: { _tag: "DomEvent", name: "click" },
        viewTransition: ["fade"],
      },
      {
        _tag: "Update",
        at: 0,
        seq: 6,
        session: "s",
        ...instance,
        commands: [],
        events: [],
        lists: [],
        message: { _tag: "Reset" },
        model: { count: 0 },
        props: { initial: 1 },
        sends: [],
        source: {
          _tag: "Command",
          issued,
          name: "test/Save",
          spanId: "span",
          traceId: "trace",
        },
      },
      {
        _tag: "Update",
        at: 0,
        seq: 7,
        session: "s",
        ...instance,
        commands: [],
        events: [],
        lists: [],
        message: { _tag: "Reset" },
        model: { count: 0 },
        props: { initial: 1 },
        sends: [],
        source: {
          _tag: "Subscription",
          deps: ["42"],
          key: "room",
          name: "room",
        },
      },
      {
        _tag: "Update",
        at: 0,
        seq: 8,
        session: "s",
        ...instance,
        commands: [],
        events: [],
        lists: [],
        message: { _tag: "Reset" },
        model: { count: 0 },
        props: { initial: 1 },
        sends: [],
        source: { _tag: "Query", name: "user", seq: 2 },
      },
      {
        _tag: "Update",
        at: 0,
        seq: 9,
        session: "s",
        ...instance,
        commands: [],
        events: [],
        lists: [],
        message: { _tag: "Reset" },
        model: { count: 0 },
        props: { initial: 1 },
        sends: [],
        source: { _tag: "Emit", path: "/App/Child[c]", seq: 3 },
      },
      {
        _tag: "Update",
        at: 0,
        seq: 10,
        session: "s",
        ...instance,
        commands: [],
        events: [],
        lists: [],
        message: { _tag: "Reset" },
        model: { count: 0 },
        props: { initial: 1 },
        sends: [],
        source: { _tag: "Failure", path: "/App/Child[c]", seq: 3 },
      },
      {
        _tag: "Update",
        at: 0,
        seq: 11,
        session: "s",
        ...instance,
        commands: [],
        events: [],
        lists: [],
        message: { _tag: "Reset" },
        model: { count: 0 },
        props: { initial: 1 },
        sends: [],
        source: { _tag: "Send", path: "/App", seq: 3 },
      },
      {
        _tag: "Update",
        at: 0,
        seq: 12,
        session: "s",
        ...instance,
        commands: [],
        events: [],
        lists: [],
        message: { _tag: "Reset" },
        model: { count: 0 },
        props: { initial: 1 },
        sends: [],
        source: { _tag: "Shared", name: "theme", path: "/App", seq: 3 },
      },
      {
        _tag: "Update",
        at: 0,
        seq: 13,
        session: "s",
        ...instance,
        commands: [],
        events: [],
        lists: [],
        message: { _tag: "Reset" },
        model: { count: 0 },
        props: { initial: 1 },
        sends: [],
        source: { _tag: "Collected" },
      },
      {
        _tag: "Update",
        at: 0,
        seq: 14,
        session: "s",
        ...instance,
        commands: [],
        events: [],
        lists: [],
        message: { _tag: "Reset" },
        model: { count: 0 },
        props: { initial: 1 },
        sends: [],
        source: {
          _tag: "Mount",
          args: { token: Redacted.make("secret") },
          argsSchema: mountArgsSchema,
          name: "ReadTag",
          seq: 3,
        },
      },
      {
        _tag: "PropsChanged",
        at: 0,
        seq: 15,
        session: "s",
        ...instance,
        props: { initial: 2 },
      },
      {
        _tag: "QueryChanged",
        at: 0,
        component: Queried,
        instance: 3,
        name: "user",
        path: "/Queried",
        result: { name: "ada" },
        seq: 16,
        session: "s",
      },
      {
        _tag: "LayerPending",
        at: 0,
        seq: 17,
        session: "s",
        ...instance,
        status: "Rebuilding",
      },
      { _tag: "LayerReady", at: 0, seq: 18, session: "s", ...instance },
      {
        _tag: "LayerFailed",
        at: 0,
        seq: 19,
        session: "s",
        ...instance,
        cause: Cause.fail("nope"),
        redacted: true,
      },
      {
        _tag: "Failed",
        at: 0,
        seq: 20,
        session: "s",
        ...instance,
        cause: Cause.fail(new Error("boom")),
        in: "update",
        issued,
        name: "Counter",
        props: { initial: 1 },
        update: {
          message: { _tag: "Increment", amount: 1 },
          source: { _tag: "Dispatch" },
        },
      },
      { _tag: "Unmounted", at: 0, seq: 21, session: "s", ...instance },
      { _tag: "Kept", at: 0, seq: 22, session: "s", ...instance },
      { _tag: "Drawn", at: 0, seq: 23, session: "s", ...instance },
      {
        _tag: "MountStarted",
        at: 0,
        seq: 24,
        session: "s",
        ...instance,
        args: { token: Redacted.make("secret") },
        argsSchema: mountArgsSchema,
        name: "ReadTag",
      },
      {
        _tag: "MountEnded",
        at: 0,
        seq: 25,
        session: "s",
        ...instance,
        name: "ReadTag",
        reason: "completed",
        silent: false,
        started: 24,
      },
      {
        _tag: "CommandStarted",
        at: 0,
        seq: 26,
        session: "s",
        ...instance,
        causedBy: 5,
        issued,
        name: "test/Save",
        spanId: "span",
        traceId: "trace",
      },
      {
        _tag: "CommandAwaiting",
        at: 0,
        seq: 27,
        session: "s",
        ...instance,
        entries: [{ logKey: `{"id":"1"}`, query: "user" }],
        issued,
        name: "test/Save",
      },
      {
        _tag: "CommandEnded",
        at: 0,
        seq: 28,
        session: "s",
        ...instance,
        issued,
        name: "test/Save",
        silent: true,
        spanId: undefined,
        traceId: undefined,
        waitEnded: "settled",
      },
      {
        _tag: "CommandInterrupted",
        at: 0,
        seq: 29,
        session: "s",
        ...instance,
        causedBy: 6,
        issued,
        name: "test/Save",
        reason: "switch",
        spanId: "span",
        traceId: "trace",
      },
      {
        _tag: "CommandDropped",
        at: 0,
        seq: 30,
        session: "s",
        ...instance,
        issued,
        name: "test/Save",
        reason: "server",
      },
      {
        _tag: "SendDropped",
        at: 0,
        seq: 31,
        session: "s",
        ...instance,
        issued,
        owner: "Theme",
      },
      {
        _tag: "SubscriptionStarted",
        at: 0,
        seq: 32,
        session: "s",
        ...instance,
        deps: undefined,
        key: "room",
        name: "room",
      },
      {
        _tag: "SubscriptionStopped",
        at: 0,
        seq: 33,
        session: "s",
        ...instance,
        deps: ["42"],
        key: "room",
        name: "room",
      },
    ];
    const encoder = MessageLog.makeEncoder();
    const frames = entries.map((entry) => encoder.encode(entry));
    expect(frames.map((frame) => frame._tag)).toEqual(
      entries.map((entry) => entry._tag)
    );
    for (const frame of frames) {
      expect(roundTrip(frame)).toEqual(frame);
    }
    // SAFETY: frame 4 is the full `Update`, so narrowing it to the `Update` wire shape is sound.
    const update = frames[4] as Extract<MessageLog.Wire, { _tag: "Update" }>;
    expect(update.source).toEqual({ _tag: "DomEvent", name: "click" });
    expect(update.queries).toEqual({ user: { name: "ada" } });
    expect(update.shared).toEqual({ theme: { mode: "dark" } });
    expect(update.sends).toEqual([{ message: { ping: 1 }, owner: "Owner" }]);
    expect(update.commands).toEqual([
      {
        _tag: "Effect",
        args: { n: 1 },
        group: null,
        name: "test/Save",
      },
    ]);
    // SAFETY: frame 13 is the `Update` with the mount source, so narrowing it to the `Update` wire shape is sound.
    const mountSource = (
      frames[13] as Extract<
        MessageLog.Wire,
        {
          _tag: "Update";
        }
      >
    ).source;
    expect(mountSource).toEqual({
      _tag: "Mount",
      args: { token: { "~redacted": true } },
      name: "ReadTag",
      seq: 3,
    });
    // SAFETY: the frame was found by its `Failed` tag above, so narrowing it to the `Failed` wire shape is sound.
    const failed = frames.find((frame) => frame._tag === "Failed") as Extract<
      MessageLog.Wire,
      { _tag: "Failed" }
    >;
    expect(failed.in).toBe("update");
    expect(failed.name).toBe("Counter");
    expect(failed.update?.message).toEqual({ _tag: "Increment", amount: 1 });
    expect(failed.cause.pretty).toContain("boom");
  });
});

describe("MessageLog placeholders", () => {
  it("treats a single-key placeholder object as a placeholder, and nothing else", () => {
    expect(MessageLog.isPlaceholder({ "~unserialisable": "cycle" })).toBe(true);
    expect(MessageLog.isPlaceholder({ "~redacted": true })).toBe(true);
    expect(MessageLog.isPlaceholder({ "~truncated": 12 })).toBe(true);
    for (const value of [
      null,
      [1],
      {},
      { a: 1 },
      { "~redacted": false },
      { extra: 1, "~redacted": true },
      { "~truncated": "12" },
      { "~unserialisable": 12 },
      { "~unknown": true },
      "redacted",
    ]) {
      expect(MessageLog.isPlaceholder(value)).toBe(false);
    }
  });

  it("encodes any value as JSON, best effort", () => {
    expect(MessageLog.structural("a")).toBe("a");
    expect(MessageLog.structural(true)).toBe(true);
    expect(MessageLog.structural(1)).toBe(1);
    expect(MessageLog.structural(Number.NaN)).toEqual({
      "~unserialisable": "number",
    });
    expect(MessageLog.structural(Number.POSITIVE_INFINITY)).toEqual({
      "~unserialisable": "number",
    });
    // oxlint-disable-next-line unicorn/no-useless-undefined -- explicit `undefined` exercises the undefined-to-null branch.
    expect(MessageLog.structural(undefined)).toBe(null);
    expect(MessageLog.structural(null)).toBe(null);
    expect(MessageLog.structural(10n)).toEqual({
      "~unserialisable": "bigint",
    });
    expect(MessageLog.structural(Symbol("s"))).toEqual({
      "~unserialisable": "symbol",
    });
    expect(MessageLog.structural(() => {})).toEqual({
      "~unserialisable": "function",
    });
    expect(MessageLog.structural(Redacted.make("secret"))).toEqual({
      "~redacted": true,
    });
    expect(MessageLog.structural(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
    expect(MessageLog.structural(new Date(Number.NaN))).toEqual({
      "~unserialisable": "Date",
    });
    expect(MessageLog.structural(new Error("boom"))).toEqual({
      message: "boom",
      name: "Error",
    });
    expect(MessageLog.structural(new Map([["k", 1]]))).toEqual({
      "~unserialisable": "Map",
    });
    expect(MessageLog.structural(new Set([1]))).toEqual({
      "~unserialisable": "Set",
    });
    expect(MessageLog.structural(new Uint8Array([1]))).toEqual({
      "~unserialisable": "Uint8Array",
    });
    // A plain object's own `toJSON` is enumerated, never called.
    expect(MessageLog.structural({ toJSON: () => ({ back: 1 }) })).toEqual({
      toJSON: { "~unserialisable": "function" },
    });
    // A class instance's `toJSON` is called instead.
    class Priced {
      // oxlint-disable-next-line eslint/class-methods-use-this -- the fixture models an instance `toJSON`, which takes no `this`.
      toJSON() {
        return { back: 1 };
      }
    }
    expect(MessageLog.structural(new Priced())).toEqual({ back: 1 });
    interface Cyclic {
      self?: unknown;
      readonly n: number;
    }
    const cyclic: Cyclic = { n: 1 };
    cyclic.self = cyclic;
    expect(MessageLog.structural(cyclic)).toEqual({
      n: 1,
      self: { "~unserialisable": "cycle" },
    });
    expect(MessageLog.structural({ a: undefined, b: 1 })).toEqual({
      a: null,
      b: 1,
    });
  });

  it("falls back to structural for what a Schema can't encode, and never throws", () => {
    // A struct is encoded field by field; a missing key is left out.
    expect(
      MessageLog.encodeArgs(
        Schema.Struct({ a: Schema.Number, b: Schema.String }),
        { a: 1, extra: true }
      )
    ).toEqual({ a: 1 });
    // A value that can't be read is a placeholder instead of a throw.
    const throwing = {};
    Object.defineProperty(throwing, "boom", {
      enumerable: true,
      get(): never {
        throw new Error("unreadable");
      },
    });
    expect(MessageLog.encodeArgs(Schema.Struct({}), throwing)).toEqual({});
    expect(MessageLog.encodeArgs(Schema.Unknown, throwing)).toEqual({
      "~unserialisable": "encode",
    });
    // SAFETY: the test feeds a symbol through a `Number` Schema on purpose, so the failure fallback is exercised.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the symbol deliberately violates the Schema; the unknown hop is the only way to build the input.
    const notANumber = Symbol("s") as unknown as number;
    expect(MessageLog.encodeArgs(Schema.Number, notANumber)).toEqual({
      "~unserialisable": "symbol",
    });
  });
});

describe("MessageLog socket", () => {
  it("streams Hello plus the replay buffer to a new connection", async () => {
    await Effect.runPromise(
      Effect.gen(function* socketScope() {
        const sent: string[] = [];
        // A scripted constructor: the handshake opens at once, writes are
        // captured, and reads block forever since the test sends nothing.
        const fake = (_url: string): Socket.WebSocketLike => ({
          addEventListener: (type, listener) => {
            if (type === "open") {
              // A synthetic event: the handshake only needs the signal, which
              // carries no data.
              // SAFETY: the handshake signal carries no data, so an empty object stands in for the event.
              const event = {} as Socket.WebSocketEvent;
              queueMicrotask(() => listener(event));
            }
          },
          close: () => {},
          readyState: 1,
          removeEventListener: () => {},
          send: (data) => {
            // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the socket sends either strings or binary; `typeof` selects the text branch.
            sent.push(typeof data === "string" ? data : "<binary>");
          },
        });
        const layer = MessageLog.socket("ws://127.0.0.1:1/log", {
          buffer: 10,
          host: "test",
        }).pipe(
          Layer.provide(Layer.succeed(Socket.WebSocketConstructor, fake))
        );
        const context = yield* Layer.build(layer);
        const log = Context.get(context, MessageLog.MessageLog);
        expect(log.enabled).toBe(true);
        log.record({
          _tag: "SessionStarted",
          app: "A",
          at: 0,
          seq: 1,
          session: "s",
        });
        log.record({
          _tag: "Unmounted",
          at: 0,
          seq: 2,
          session: "s",
          ...instance,
        });
        let waited = 0;
        while (sent.length < 3 && waited < 100) {
          yield* Effect.sleep("10 millis");
          waited += 1;
        }
        const [hello = "", started = "", unmounted = ""] = sent;
        expect(sent.length).toBe(3);
        expect(JSON.parse(hello)).toEqual({
          _tag: "Hello",
          host: "test",
          version: MessageLog.wireVersion,
        });
        expect(JSON.parse(started)).toEqual({
          _tag: "SessionStarted",
          app: "A",
          at: 0,
          seq: 1,
          session: "s",
        });
        expect(JSON.parse(unmounted)).toEqual({
          _tag: "Unmounted",
          at: 0,
          component: "Counter",
          instance: 1,
          path: "/Counter",
          seq: 2,
          session: "s",
        });
      }).pipe(Effect.scoped)
    );
  });
});
