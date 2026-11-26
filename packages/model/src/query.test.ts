// oxlint-disable-next-line eslint/max-classes-per-file -- each test defines its own query Service classes; that is what the file is for.
import { describe, expect, it } from "bun:test";

import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Latch,
  Layer,
  Option,
  Redacted,
  Scheduler,
  Schema,
  SchemaTransformation,
  Scope,
  Stream,
} from "effect";
import type { Duration } from "effect";
import { AsyncResult } from "effect/reactivity";
import { TestClock } from "effect/testing";

import * as Query from "./query.ts";
import * as TestQuery from "./test/test-query.ts";

/**
 * Runs a test body with a `TestClock` and its own `Scope`, like upstream's
 * `it.effect`: the cache's time-based rules run on the test clock, and the
 * layers a body provides dispose with the test.
 */
const runTest = <A, E, R>(body: () => Effect.Effect<A, E, R>): Promise<A> =>
  Effect.runPromise(
    // SAFETY: bodies provide every service they need except the `TestClock`
    // (provided here) and `Scope` (provided by `Effect.scoped`), so nothing
    // remains; the compiler can't see that through the generic `R`.
    Effect.scoped(Effect.provide(body(), TestClock.layer())) as Effect.Effect<
      A,
      E,
      never
    >
  );
// oxlint-disable-next-line eslint/no-redeclare -- the Schema struct is the value and the type alias its decoded type; they intentionally share the name.
const User = Schema.Struct({ id: Schema.String, name: Schema.String });
type User = typeof User.Type;
type Seen = AsyncResult.AsyncResult<User, string>;

const Users = Query.Tag("users");

// A few macrotasks: lets every fiber the cache forked run, and whatever those fork in turn.
const flush = Effect.promise(async () => {
  // oxlint-disable-next-line eslint/no-plusplus -- four macrotasks, counted down.
  for (let i = 0; i < 4; i++) {
    // oxlint-disable-next-line eslint/no-await-in-loop, promise/avoid-new, eslint/no-promise-executor-return -- each macrotask lets every fiber the cache forked run before the next; the executor wraps setTimeout.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
});
const advance = (duration: Duration.Input) =>
  flush.pipe(Effect.andThen(TestClock.adjust(duration)), Effect.andThen(flush));

const show = (result: Seen): string => {
  if (AsyncResult.isSuccess(result)) {
    return `${result.value.name}${result.waiting ? " waiting" : ""}`;
  }
  if (AsyncResult.isFailure(result)) {
    const error = Option.getOrElse(
      Cause.findErrorOption(result.cause),
      () => "?"
    );
    const previous = Option.isSome(result.previousSuccess) ? " previous" : "";
    return `Failure(${error})${previous}${result.waiting ? " waiting" : ""}`;
  }
  return `Initial${result.waiting ? " waiting" : ""}`;
};

// A query whose fetcher takes 10 ms and does what `db.mode` says.
const makeUsers = (options: {
  readonly staleTime: Duration.Input;
  readonly idleTimeToLive?: Duration.Input;
  readonly refetchInterval?: Query.RefetchInterval<
    { readonly id: string },
    User,
    string
  >;
}) => {
  type DbMode = "ok" | "fail" | "die" | "interrupt";
  // SAFETY: the mode starts ok; the tests drive it through every state, which DbMode names.
  const db = {
    calls: 0,
    mode: "ok" as DbMode,
    name: "Ann",
  };
  class GetUser extends Query.Service<GetUser>()("users/GetUser", {
    args: { id: Schema.String },
    error: Schema.String,
    success: User,
    tags: [Users],
    ...options,
  }) {
    static readonly layer = this.toLayer(
      Effect.fnUntraced(function* layer({ id }) {
        db.calls += 1;
        yield* Effect.sleep(10);
        if (db.mode === "die") {
          return yield* Effect.die("boom");
        }
        // A Fail next to an Interrupt is still a Failure, and holds only the Fail.
        if (db.mode === "fail") {
          return yield* Effect.failCause(
            Cause.combine(Cause.fail("nope"), Cause.interrupt())
          );
        }
        if (db.mode === "interrupt") {
          return yield* Effect.interrupt;
        }
        return { id, name: db.name };
      })
    );
  }
  const provide = Effect.provide(Layer.merge(GetUser.layer, TestQuery.layer()));
  return { GetUser, db, provide };
};

// Watches through the public `changes` Stream, and records what it emits.
const watch = Effect.fnUntraced(function* watch<R>(
  changes: Stream.Stream<Seen, never, R>
) {
  const seen: string[] = [];
  const fiber = yield* Effect.forkScoped(
    Stream.runForEach(changes, (result) =>
      Effect.sync(() => seen.push(show(result)))
    )
  );
  yield* flush;
  return { fiber, seen, stop: Fiber.interrupt(fiber) };
});

const triggers = TestQuery.fetches.pipe(
  Effect.map((fetches) =>
    fetches.map((fetch) => fetch.trigger + (fetch.restart ? " restart" : ""))
  )
);

// SAFETY: squash returns the rejection the test installed; every thrown case fails or dies with an Error.
const thrown = <R>(get: Effect.Effect<number, never, R>) =>
  Effect.map(Effect.exit(get), (exit) =>
    Exit.isFailure(exit)
      ? (Cause.squash(exit.cause) as Error).message
      : "no throw"
  );

const define =
  (options: {
    readonly staleTime?: Duration.Input;
    readonly idleTimeToLive?: Duration.Input;
    readonly refetchInterval?: Duration.Input;
  }) =>
  () =>
    Query.Service<unknown>()("Bad", {
      args: {},
      error: Schema.Never,
      staleTime: 0,
      success: Schema.Number,
      ...options,
    });

describe("Query", () => {
  it("only the zero-to-one watcher transition fetches, and watchers share the fetch", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({ staleTime: "30 seconds" });
      return Effect.gen(function* body() {
        const a = yield* watch(GetUser.changes({ id: "1" }));
        const b = yield* watch(GetUser.changes({ id: "1" }));
        expect(db.calls).toBe(1);
        // Quiet over a cold entry.
        expect(a.seen).toStrictEqual([]);
        expect(yield* GetUser.peek({ id: "1" })).toStrictEqual(
          AsyncResult.initial(true)
        );
        yield* advance(10);
        expect(a.seen).toStrictEqual(["Ann"]);
        expect(b.seen).toStrictEqual(["Ann"]);

        yield* advance("31 seconds");
        expect((yield* TestQuery.entry(GetUser, { id: "1" }))?.stale).toBe(
          true
        );
        // A joining watcher never refetches, even over a stale entry.
        const c = yield* watch(GetUser.changes({ id: "1" }));
        yield* advance(20);
        expect(c.seen).toStrictEqual(["Ann"]);
        expect(db.calls).toBe(1);

        yield* a.stop;
        yield* b.stop;
        yield* c.stop;
        expect((yield* TestQuery.entry(GetUser, { id: "1" }))?.watchers).toBe(
          0
        );
        // Zero-to-one over a stale entry serves the stale value at once and refetches.
        const d = yield* watch(GetUser.changes({ id: "1" }));
        expect(d.seen).toStrictEqual(["Ann waiting"]);
        yield* advance(10);
        expect(d.seen).toStrictEqual(["Ann waiting", "Ann"]);
        expect(yield* triggers).toStrictEqual(["watch", "watch"]);
      }).pipe(provide);
    }));

  it("the last watcher abandoning its fetch interrupts it, unless a get or a prefetch joined it or a fetch it restarted", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({ staleTime: "30 seconds" });
      return Effect.gen(function* body() {
        const cache = Query.internals(yield* Query.Cache);
        const def = Query.defOf(GetUser);
        // SAFETY: the erased watch boundary takes the query's own fetcher back; the tests feed it only the provided service.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unknown-parameters -- the erased boundary needs the double assertion, and the test fetcher takes the query's args without parsing.
        const fetcher = (yield* GetUser) as unknown as (
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the erased watch boundary hands the query's args through unparsed; the test feeds its own args.
          args: unknown
        ) => Effect.Effect<unknown, unknown>;
        const watchOne = (id: string) =>
          cache.watch(def, { id }, fetcher, () => {});
        // Alone: the fetch goes, and the cold entry with it.
        const alone = watchOne("1");
        yield* flush;
        alone.unregister(true);
        yield* advance(10);
        expect(yield* TestQuery.entry(GetUser, { id: "1" })).toBeUndefined();
        // Joined by a get, which still gets its value.
        const waited = watchOne("2");
        const got = yield* Effect.forkScoped(GetUser.get({ id: "2" }));
        yield* flush;
        waited.unregister(true);
        yield* advance(10);
        expect(yield* Fiber.join(got)).toStrictEqual({ id: "2", name: "Ann" });
        // Joined by a prefetch, which outlives its caller.
        const prefetched = watchOne("3");
        yield* GetUser.prefetch({ id: "3" });
        yield* flush;
        prefetched.unregister(true);
        yield* advance(10);
        expect(
          AsyncResult.isSuccess(
            (yield* TestQuery.entry(GetUser, { id: "3" }))!.stored // oxlint-disable-line typescript/no-non-null-assertion -- the fetch above settled the entry; the test asserts its stored value.
          )
        ).toBe(true);
        // The prefetch's claim carries over to the fetch an invalidation restarts it with.
        const restarted = watchOne("4");
        yield* GetUser.prefetch({ id: "4" });
        yield* GetUser.invalidate({ id: "4" });
        yield* flush;
        restarted.unregister(true);
        yield* advance(10);
        expect(
          AsyncResult.isSuccess(
            (yield* TestQuery.entry(GetUser, { id: "4" }))!.stored // oxlint-disable-line typescript/no-non-null-assertion -- the prefetch above settled the entry; the test asserts its stored value.
          )
        ).toBe(true);
        // Once that fetch settles the claim is spent: the next one a watcher starts is abandoned.
        yield* GetUser.invalidate({ id: "4" });
        const after = watchOne("4");
        yield* flush;
        after.unregister(true);
        yield* advance(10);
        // oxlint-disable-next-line typescript/no-non-null-assertion -- the fetch above settled the entry; the test asserts it is stale.
        expect((yield* TestQuery.entry(GetUser, { id: "4" }))!.stale).toBe(
          true
        );
        expect(db.calls).toBe(5);
      }).pipe(provide);
    }));

  it("under a hold, the zero-to-one decision waits for release and ignores the order of releases and registrations", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({ staleTime: "30 seconds" });
      return Effect.gen(function* body() {
        const cache = Query.internals(yield* Query.Cache);
        const def = Query.defOf(GetUser);
        // SAFETY: the erased watch boundary takes the query's own fetcher back; the tests feed it only the provided service.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unknown-parameters -- the erased boundary needs the double assertion, and the test fetcher takes the query's args without parsing.
        const fetcher = (yield* GetUser) as unknown as (
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the erased watch boundary hands the query's args through unparsed; the test feeds its own args.
          args: unknown
        ) => Effect.Effect<unknown, unknown>;
        const watchOne = () => cache.watch(def, { id: "1" }, fetcher, () => {});
        const old = watchOne();
        yield* advance(10);
        yield* advance("31 seconds");
        // The new watcher registers before the old one goes: a join, were it decided then.
        const release = cache.hold();
        const next = watchOne();
        old.unregister();
        yield* flush;
        expect((yield* TestQuery.entry(GetUser, { id: "1" }))?.fetch).toBe(
          "none"
        );
        release();
        expect(next.current().waiting).toBe(true);
        yield* advance(10);
        expect(db.calls).toBe(2);
        // A watcher from before the hold survives it: a join.
        yield* advance("31 seconds");
        const releaseAgain = cache.hold();
        const joining = watchOne();
        releaseAgain();
        yield* advance(10);
        expect(db.calls).toBe(2);
        next.unregister();
        joining.unregister();
        expect(yield* triggers).toStrictEqual(["watch", "watch"]);
      }).pipe(provide);
    }));

  it("under a hold, a bare Failure is withheld: a swap clears it unseen, and a join gets it at release", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({ staleTime: "30 seconds" });
      return Effect.gen(function* body() {
        const cache = Query.internals(yield* Query.Cache);
        const def = Query.defOf(GetUser);
        // SAFETY: the erased watch boundary takes the query's own fetcher back; the tests feed it only the provided service.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unknown-parameters -- the erased boundary needs the double assertion, and the test fetcher takes the query's args without parsing.
        const fetcher = (yield* GetUser) as unknown as (
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the erased watch boundary hands the query's args through unparsed; the test feeds its own args.
          args: unknown
        ) => Effect.Effect<unknown, unknown>;
        const seen: string[] = [];
        // SAFETY: the watcher observes GetUser, whose results are AsyncResult<User, string>.
        const watchOne = (name: string) =>
          cache.watch(def, { id: "1" }, fetcher, (result) =>
            seen.push(`${name} ${show(result as Seen)}`)
          );
        db.mode = "fail";
        const old = watchOne("old");
        yield* advance(10);
        expect(seen).toStrictEqual(["old Failure(nope)"]);

        // Join: old survives the hold.
        const releaseJoin = cache.hold();
        const joining = watchOne("joining");
        expect(joining.current()).toStrictEqual(AsyncResult.initial());
        releaseJoin();
        expect(seen).toStrictEqual([
          "old Failure(nope)",
          "joining Failure(nope)",
        ]);
        // SAFETY: the watcher observes GetUser, whose results are AsyncResult<User, string>.
        expect(show(joining.current() as Seen)).toBe("Failure(nope)");
        joining.unregister();

        // Swap: the new watcher registers before old leaves, and never sees the Failure.
        seen.length = 0;
        const releaseSwap = cache.hold();
        const next = watchOne("next");
        old.unregister();
        expect(next.patchedView().result).toStrictEqual(AsyncResult.initial());
        releaseSwap();
        expect(next.current()).toStrictEqual(AsyncResult.initial(true));
        db.mode = "ok";
        yield* advance(10);
        expect(seen).toStrictEqual(["next Ann"]);
        expect(yield* triggers).toStrictEqual(["watch", "watch"]);
        next.unregister();
      }).pipe(provide);
    }));

  it("under a hold, a bare Failure stored during it or an earlier one is withheld, in either order", () =>
    runTest(() =>
      Effect.gen(function* body() {
        for (const timing of ["this hold", "an earlier hold"] as const) {
          for (const order of ["register first", "release first"] as const) {
            const { GetUser, db, provide } = makeUsers({
              staleTime: "30 seconds",
            });
            const result = yield* Effect.gen(function* result() {
              const cache = Query.internals(yield* Query.Cache);
              const def = Query.defOf(GetUser);
              // SAFETY: the erased watch boundary takes the query's own fetcher back; the tests feed it only the provided service.
              // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unknown-parameters -- the erased boundary needs the double assertion, and the test fetcher takes the query's args without parsing.
              const fetcher = (yield* GetUser) as unknown as (
                // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the erased watch boundary hands the query's args through unparsed; the test feeds its own args.
                args: unknown
              ) => Effect.Effect<unknown, unknown>;
              const seen: string[] = [];
              // SAFETY: the watcher observes GetUser, whose results are AsyncResult<User, string>.
              const watchOne = (name: string) =>
                cache.watch(def, { id: "1" }, fetcher, (current) =>
                  seen.push(`${name} ${show(current as Seen)}`)
                );
              db.mode = "fail";
              const old = watchOne("old");
              const first = cache.hold();
              // The fetch fails while the hold is open.
              yield* advance(10);
              if (timing === "an earlier hold") {
                first();
              }
              const release = timing === "this hold" ? first : cache.hold();
              seen.length = 0;
              if (order === "release first") {
                old.unregister();
              }
              const next = watchOne("next");
              // SAFETY: the watcher observes GetUser, whose results are AsyncResult<User, string>.
              const before = show(next.current() as Seen);
              if (order === "register first") {
                old.unregister();
              }
              release();
              // SAFETY: the watcher observes GetUser, whose results are AsyncResult<User, string>.
              const after = show(next.current() as Seen);
              db.mode = "ok";
              yield* advance(10);
              next.unregister();
              return { after, before, seen, triggers: yield* triggers };
            }).pipe(provide);
            expect(result).toStrictEqual({
              after: "Initial waiting",
              before: "Initial",
              seen: ["next Ann"],
              triggers: ["watch", "watch"],
            });
          }
        }
      })
    ));

  it("under a hold, the window counts only the watchers that survive it", () =>
    runTest(() =>
      Effect.gen(function* body() {
        for (const survives of [false, true]) {
          for (const order of ["register first", "release first"] as const) {
            const { GetUser, provide } = makeUsers({ staleTime: "30 seconds" });
            const result = yield* Effect.gen(function* result() {
              const cache = Query.internals(yield* Query.Cache);
              const def = Query.defOf(GetUser);
              // SAFETY: the erased watch boundary takes the query's own fetcher back; the tests feed it only the provided service.
              // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unknown-parameters -- the erased boundary needs the double assertion, and the test fetcher takes the query's args without parsing.
              const fetcher = (yield* GetUser) as unknown as (
                // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the erased watch boundary hands the query's args through unparsed; the test feeds its own args.
                args: unknown
              ) => Effect.Effect<unknown, unknown>;
              const seen: string[] = [];
              cache.hydrate({
                "users/GetUser": [['{"id":"1"}', 1, ["nope"], 0]],
              });
              const release = cache.hold();
              const inside = cache.watch(def, { id: "1" }, fetcher, () => {});
              cache.closeWindow();
              if (!survives && order === "release first") {
                inside.unregister();
              }
              // SAFETY: the watcher observes GetUser, whose results are AsyncResult<User, string>.
              const outside = cache.watch(
                def,
                { id: "1" },
                fetcher,
                (current) => seen.push(show(current as Seen))
              );
              // SAFETY: the watcher observes GetUser, whose results are AsyncResult<User, string>.
              const before = show(outside.current() as Seen);
              if (!survives && order === "register first") {
                inside.unregister();
              }
              release();
              // SAFETY: the watcher observes GetUser, whose results are AsyncResult<User, string>.
              const after = show(outside.current() as Seen);
              yield* advance(10);
              outside.unregister();
              inside.unregister();
              return { after, before, seen, triggers: yield* triggers };
            }).pipe(provide);
            // A join on the hydrated Failure: delivered at release, with no fetch.
            const joined = {
              after: "Failure(nope)",
              before: "Initial",
              seen: ["Failure(nope)"],
              triggers: [],
            };
            // The watcher that came inside the window left after it closed: dropped and fetched.
            const dropped = {
              after: "Initial waiting",
              before: "Initial",
              seen: ["Ann"],
              triggers: ["watch"],
            };
            expect(result).toStrictEqual(survives ? joined : dropped);
          }
        }
      })
    ));

  it("get serves a fresh value, fetches a stale one and joins a fetch in flight", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({ staleTime: "30 seconds" });
      return Effect.gen(function* body() {
        const first = yield* Effect.forkScoped(
          Effect.all([GetUser.get({ id: "1" }), GetUser.get({ id: "1" })], {
            concurrency: "unbounded",
          })
        );
        yield* advance(10);
        expect(yield* Fiber.join(first)).toStrictEqual([
          {
            id: "1",
            name: "Ann",
          },
          { id: "1", name: "Ann" },
        ]);
        expect(yield* GetUser.get({ id: "1" })).toStrictEqual({
          id: "1",
          name: "Ann",
        });
        expect(db.calls).toBe(1);

        db.name = "Bea";
        yield* advance("30 seconds");
        const second = yield* Effect.forkScoped(GetUser.get({ id: "1" }));
        yield* advance(10);
        expect(yield* Fiber.join(second)).toStrictEqual({
          id: "1",
          name: "Bea",
        });
        expect(yield* triggers).toStrictEqual(["get", "get"]);

        // A failed refetch is stored over the old value. A failed first fetch of an unwatched entry isn't stored.
        db.mode = "fail";
        yield* advance("30 seconds");
        const failed = yield* Effect.forkScoped(
          Effect.exit(
            Effect.all([GetUser.get({ id: "1" }), GetUser.get({ id: "2" })], {
              concurrency: "unbounded",
              mode: "result",
            })
          )
        );
        yield* advance(10);
        expect(
          (yield* Fiber.join(failed)).pipe(
            Exit.map((results) => results.map((result) => result._tag))
          )
        ).toStrictEqual(Exit.succeed(["Failure", "Failure"]));
        expect(show(yield* GetUser.peek({ id: "1" }))).toBe(
          "Failure(nope) previous"
        );
        expect(yield* TestQuery.entry(GetUser, { id: "2" })).toBeUndefined();
      }).pipe(provide);
    }));

  it("prefetch outlives its caller, and an entry nothing uses is collected", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({
        idleTimeToLive: "1 minute",
        staleTime: "Infinity",
      });
      return Effect.gen(function* body() {
        // peek neither creates an entry nor fetches.
        expect(yield* GetUser.peek({ id: "1" })).toStrictEqual(
          AsyncResult.initial()
        );
        expect(yield* TestQuery.entry(GetUser, { id: "1" })).toBeUndefined();

        yield* GetUser.prefetch({ id: "1" });
        expect(show(yield* GetUser.peek({ id: "1" }))).toBe("Initial waiting");
        yield* advance(10);
        expect(show(yield* GetUser.peek({ id: "1" }))).toBe("Ann");
        expect(yield* triggers).toStrictEqual(["prefetch"]);

        // The idle timer started at settle. get and prefetch reset it, peek doesn't.
        yield* advance("50 seconds");
        yield* GetUser.prefetch({ id: "1" });
        yield* advance("50 seconds");
        yield* GetUser.peek({ id: "1" });
        expect(yield* TestQuery.entry(GetUser, { id: "1" })).toBeDefined();
        yield* advance("10 seconds");
        expect(yield* TestQuery.entry(GetUser, { id: "1" })).toBeUndefined();

        // A watched entry is never collected, and it outlives its last watcher by the idle time.
        const watcher = yield* watch(GetUser.changes({ id: "1" }));
        yield* advance("5 minutes");
        yield* watcher.stop;
        yield* advance("59 seconds");
        expect(show(yield* GetUser.peek({ id: "1" }))).toBe("Ann");
        yield* advance("1 second");
        expect(yield* TestQuery.entry(GetUser, { id: "1" })).toBeUndefined();

        // A failed prefetch of an unwatched entry stores nothing.
        db.mode = "fail";
        yield* GetUser.prefetch({ id: "2" });
        yield* advance(10);
        expect(yield* TestQuery.entry(GetUser, { id: "2" })).toBeUndefined();
        expect(db.calls).toBe(3);
      }).pipe(provide);
    }));

  it("a host edge refetches stale watched entries once both signals are true", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({ staleTime: "30 seconds" });
      return Effect.gen(function* body() {
        yield* watch(GetUser.changes({ id: "1" }));
        yield* advance(10);
        yield* advance("31 seconds");
        // Going stale on its own fetches nothing.
        expect(db.calls).toBe(1);

        yield* TestQuery.setVisible(false);
        yield* TestQuery.setOnline(false);
        yield* TestQuery.setVisible(true);
        yield* flush;
        expect(db.calls).toBe(1);
        yield* TestQuery.setOnline(true);
        yield* advance(10);
        expect(db.calls).toBe(2);

        // A fresh entry isn't refetched.
        yield* TestQuery.setVisible(false);
        yield* TestQuery.setVisible(true);
        yield* flush;
        expect(db.calls).toBe(2);

        yield* advance("31 seconds");
        yield* TestQuery.setVisible(false);
        yield* TestQuery.setVisible(true);
        yield* advance(10);
        expect(yield* triggers).toStrictEqual([
          "watch",
          "connectivity",
          "visibility",
        ]);
      }).pipe(provide);
    }));

  it("the interval polls a watched entry, pauses while hidden and re-arms after a revert", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({
        refetchInterval: "5 seconds",
        staleTime: "Infinity",
      });
      return Effect.gen(function* body() {
        const watcher = yield* watch(GetUser.changes({ id: "1" }));
        yield* advance(10);
        yield* advance("5 seconds");
        yield* advance(10);
        expect(yield* triggers).toStrictEqual(["watch", "interval"]);

        // Hidden: the interval doesn't fire. Due on the edge: it fires at once.
        yield* TestQuery.setVisible(false);
        yield* advance("6 seconds");
        expect(db.calls).toBe(2);
        yield* TestQuery.setVisible(true);
        yield* advance(10);
        expect(yield* triggers).toStrictEqual([
          "watch",
          "interval",
          "visibility",
        ]);

        // Not due on the edge: it sleeps for the remainder, counted from the last settle.
        yield* advance("2 seconds");
        yield* TestQuery.setVisible(false);
        yield* advance("1 second");
        yield* TestQuery.setVisible(true);
        yield* advance("1 second");
        expect(db.calls).toBe(3);
        yield* advance("1 second");
        expect(db.calls).toBe(4);

        // A reverted fetch isn't a settle, and polling carries on from it.
        db.mode = "interrupt";
        yield* advance(10);
        db.mode = "ok";
        yield* advance("4 seconds");
        expect(db.calls).toBe(4);
        yield* advance("1 second");
        expect(db.calls).toBe(5);
        yield* advance(10);

        // It runs only while the entry is watched.
        yield* watcher.stop;
        yield* advance("10 seconds");
        expect(db.calls).toBe(5);
      }).pipe(provide);
    }));

  it("a function-form interval that throws or returns nonsense is reported, and stops until the next settle", () =>
    runTest(() => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- reassigned through the test to drive each interval case; hoisting would share mutable state across tests.
      let interval: () => Duration.Input | undefined = () => {
        throw new Error("bad interval");
      };
      const { GetUser, db, provide } = makeUsers({
        refetchInterval: () => interval(),
        staleTime: "Infinity",
      });
      return Effect.gen(function* body() {
        yield* watch(GetUser.changes({ id: "1" }));
        yield* advance(10);
        const [threw] = yield* TestQuery.expectProblem("IntervalThrew");
        expect(threw.query).toBe("users/GetUser");
        expect(threw.logKey).toBe(`{"id":"1"}`);
        // SAFETY: the interval threw the Error the test installed for this case.
        expect((threw.error as Error).message).toBe("bad interval");
        yield* advance("10 seconds");
        expect(db.calls).toBe(1);

        // A bare number under 1000 is a mistake, as is zero.
        interval = () => 5;
        yield* GetUser.invalidate({ id: "1" });
        yield* advance(10);
        expect((yield* TestQuery.expectProblem("IntervalInvalid")).length).toBe(
          1
        );
        yield* advance("10 seconds");
        expect(db.calls).toBe(2);

        // The next settle asks again. A sub-second interval spelt as a Duration is fine.
        interval = () => "500 millis";
        yield* GetUser.invalidate({ id: "1" });
        yield* advance(10);
        yield* advance(500);
        expect(db.calls).toBe(4);
        expect(yield* TestQuery.problems).toStrictEqual([]);
      }).pipe(provide);
    }));

  it("invalidation refetches a watched entry, restarts a fetch in flight and marks the rest stale", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({ staleTime: "Infinity" });
      return Effect.gen(function* body() {
        // A never-fetched entry is a no-op.
        yield* GetUser.invalidate({ id: "9" });
        expect(yield* TestQuery.entry(GetUser, { id: "9" })).toBeUndefined();

        yield* GetUser.prefetch({ id: "1" });
        const watcher = yield* watch(GetUser.changes({ id: "2" }));
        yield* advance(10);
        expect(db.calls).toBe(2);

        // The whole query: the watched entry refetches now, the unwatched one on its next use.
        yield* GetUser.invalidate();
        yield* flush;
        expect(db.calls).toBe(3);
        expect(watcher.seen).toStrictEqual(["Ann", "Ann waiting"]);
        expect((yield* TestQuery.entry(GetUser, { id: "1" }))?.stale).toBe(
          true
        );

        // A fetch in flight is interrupted and restarted, and keeps its trigger.
        yield* GetUser.invalidate({ id: "2" });
        yield* advance(10);
        expect(db.calls).toBe(4);
        expect(watcher.seen).toStrictEqual(["Ann", "Ann waiting", "Ann"]);

        const get = yield* Effect.forkScoped(GetUser.get({ id: "1" }));
        yield* advance(10);
        yield* Fiber.join(get);
        expect(yield* triggers).toStrictEqual([
          "prefetch",
          "watch",
          "invalidation",
          "invalidation restart",
          "get",
        ]);
      }).pipe(provide);
    }));

  it("a tag invalidates every read that lists it", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({ staleTime: "Infinity" });
      return Effect.gen(function* body() {
        yield* watch(GetUser.changes({ id: "1" }));
        yield* advance(10);
        // Targets get their public constructors with Commands. Until then a tag is only reachable here.
        const cache = Query.internals(yield* Query.Cache);
        cache.invalidate([{ _tag: "Tag", name: "nothing-lists-this" }]);
        yield* advance(10);
        expect(db.calls).toBe(1);
        // An entry hit twice in one application restarts once.
        cache.invalidate([
          { _tag: "Tag", name: Query.Tag("users").name },
          {
            _tag: "Tag",
            name: Users.name,
          },
        ]);
        yield* advance(10);
        expect(yield* triggers).toStrictEqual(["watch", "invalidation"]);
      }).pipe(provide);
    }));

  it("a fetch moves to a surviving build when its build closes, and reverts when none survives", () =>
    runTest(() => {
      const { GetUser, db } = makeUsers({ staleTime: "30 seconds" });
      return Effect.gen(function* body() {
        const scopeA = yield* Scope.make();
        const scopeB = yield* Scope.make();
        const buildA = yield* Layer.buildWithScope(
          Layer.fresh(GetUser.layer),
          scopeA
        );
        const buildB = yield* Layer.buildWithScope(
          Layer.fresh(GetUser.layer),
          scopeB
        );

        // The fetch runs under the first watcher's build. A pending get under another build is a survivor.
        const a = yield* watch(
          GetUser.changes({ id: "1" }).pipe(Stream.provideContext(buildA))
        );
        const get = yield* Effect.forkScoped(
          GetUser.get({ id: "1" }).pipe(Effect.provideContext(buildB))
        );
        yield* flush;
        yield* Scope.close(scopeA, Exit.void);
        yield* advance(10);
        expect(yield* Fiber.join(get)).toStrictEqual({ id: "1", name: "Ann" });
        expect(a.seen).toStrictEqual(["Ann"]);
        expect(yield* triggers).toStrictEqual(["watch", "watch restart"]);
        yield* a.stop;

        // No build survives: a stale Success stays and stops waiting.
        yield* advance("31 seconds");
        const b = yield* watch(
          GetUser.changes({ id: "1" }).pipe(Stream.provideContext(buildB))
        );
        expect(b.seen).toStrictEqual(["Ann waiting"]);
        // A cold entry is removed outright, and its get caller is interrupted.
        const cold = yield* Effect.forkScoped(
          GetUser.get({ id: "2" }).pipe(Effect.provideContext(buildB))
        );
        yield* flush;
        yield* Scope.close(scopeB, Exit.void);
        yield* flush;
        expect(b.seen).toStrictEqual(["Ann waiting", "Ann"]);
        const entry = yield* TestQuery.entry(GetUser, { id: "1" });
        expect([entry?.stale, entry?.fetch]).toStrictEqual([true, "none"]);
        expect(Exit.hasInterrupts(yield* Fiber.await(cold))).toBe(true);
        expect(yield* TestQuery.entry(GetUser, { id: "2" })).toBeUndefined();
        expect(db.calls).toBe(4);
      }).pipe(Effect.provide(TestQuery.layer()));
    }));

  // The cleanups below wait on a Latch the test opens, so the order of events is the test's to set.
  it("a fetch finishes its cleanup before its restart begins and before its build's resources are released", () =>
    runTest(() => {
      const events: string[] = [];
      const cleanup = Latch.makeUnsafe();
      class Slow extends Query.Service<Slow>()("Slow", {
        args: {},
        error: Schema.Never,
        staleTime: 0,
        success: Schema.Number,
      }) {
        static readonly layer = this.toLayer(
          Effect.gen(function* layer() {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => events.push("resource released"))
            );
            return () =>
              Effect.sync(() => events.push("fetch started")).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Effect.andThen(
                    cleanup.await,
                    Effect.sync(() => events.push("fetch cleaned up"))
                  )
                )
              );
          })
        );
      }
      return Effect.gen(function* body() {
        const scope = yield* Scope.make();
        const build = yield* Layer.buildWithScope(Slow.layer, scope);
        yield* Slow.prefetch({}).pipe(Effect.provideContext(build));
        yield* flush;
        yield* Slow.invalidate({});
        yield* flush;
        expect(events).toStrictEqual(["fetch started"]);
        yield* cleanup.open;
        yield* flush;
        expect(events).toStrictEqual([
          "fetch started",
          "fetch cleaned up",
          "fetch started",
        ]);

        yield* cleanup.close;
        const closing = yield* Effect.forkScoped(Scope.close(scope, Exit.void));
        yield* flush;
        expect(events).toStrictEqual([
          "fetch started",
          "fetch cleaned up",
          "fetch started",
        ]);
        yield* cleanup.open;
        yield* Fiber.join(closing);
        expect(events).toStrictEqual([
          "fetch started",
          "fetch cleaned up",
          "fetch started",
          "fetch cleaned up",
          "resource released",
        ]);
      }).pipe(Effect.provide(TestQuery.layer()));
    }));

  it("makeCache builds the cache when it runs and disposes it with its Scope", () =>
    runTest(() => {
      let listeners = 0;
      const signal: Query.Signal = {
        get: () => true,
        subscribe: () => {
          listeners += 1;
          return () => {
            listeners -= 1;
          };
        },
      };
      return Effect.gen(function* body() {
        const make = Query.makeCache({
          connectivity: signal,
          idleMs: 300_000,
          report: () => {},
          visibility: signal,
        });
        expect(listeners).toBe(0);
        const scope = yield* Scope.make();
        yield* make.pipe(Scope.provide(scope));
        expect(listeners).toBe(2);
        yield* Scope.close(scope, Exit.void);
        expect(listeners).toBe(0);
      });
    }));

  it("makeCache disposes a cache whose build is interrupted", () =>
    runTest(() => {
      let listeners = 0;
      const signal: Query.Signal = {
        get: () => true,
        subscribe: () => {
          listeners += 1;
          return () => {
            listeners -= 1;
          };
        },
      };
      // Yields once, right after the build subscribes both signals.
      let yielded = false;
      const scheduler = new Scheduler.MixedScheduler();
      scheduler.shouldYield = () => {
        if (listeners !== 2 || yielded) {
          return false;
        }
        yielded = true;
        return true;
      };
      return Effect.gen(function* body() {
        const scope = yield* Scope.make();
        const fiber = Effect.runFork(
          Query.makeCache({
            connectivity: signal,
            idleMs: 300_000,
            report: () => {},
            visibility: signal,
          }).pipe(
            Scope.provide(scope),
            Effect.provideService(Scheduler.Scheduler, scheduler)
          )
        );
        fiber.interruptUnsafe();
        yield* Fiber.await(fiber);
        yield* Scope.close(scope, Exit.void);
        expect(yielded).toBe(true);
        expect(listeners).toBe(0);
      });
    }));

  it("a cache waits for its fetches' cleanup when it is disposed", () =>
    runTest(() => {
      const events: string[] = [];
      const cleanup = Latch.makeUnsafe();
      class Slow extends Query.Service<Slow>()("Slow", {
        args: {},
        error: Schema.Never,
        staleTime: 0,
        success: Schema.Number,
      }) {
        static readonly layer = this.toLayer(() =>
          Effect.ensuring(
            Effect.never,
            Effect.andThen(
              cleanup.await,
              Effect.sync(() => events.push("fetch cleaned up"))
            )
          )
        );
      }
      return Effect.gen(function* body() {
        const scope = yield* Scope.make();
        const cache = yield* Layer.buildWithScope(
          Layer.merge(Slow.layer, Query.layer()),
          scope
        );
        yield* Slow.prefetch({}).pipe(Effect.provideContext(cache));
        yield* flush;
        const closing = yield* Effect.forkScoped(
          Effect.andThen(
            Scope.close(scope, Exit.void),
            Effect.sync(() => events.push("cache disposed"))
          )
        );
        yield* flush;
        expect(events).toStrictEqual([]);
        yield* cleanup.open;
        yield* Fiber.join(closing);
        expect(events).toStrictEqual(["fetch cleaned up", "cache disposed"]);
      });
    }));

  it("a fetch cut by its build closing leaves a fresh entry fresh", () =>
    runTest(() => {
      const { GetUser, db } = makeUsers({
        refetchInterval: "5 seconds",
        staleTime: "Infinity",
      });
      return Effect.gen(function* body() {
        const scope = yield* Scope.make();
        const build = yield* Layer.buildWithScope(GetUser.layer, scope);
        const watcher = yield* watch(
          GetUser.changes({ id: "1" }).pipe(Stream.provideContext(build))
        );
        yield* advance(10);
        // The interval refetches an entry that is fresh by staleTime. Nothing survives the close, so the fetch reverts.
        yield* advance("5 seconds");
        yield* watcher.stop;
        yield* Scope.close(scope, Exit.void);
        const entry = yield* TestQuery.entry(GetUser, { id: "1" });
        expect([entry?.stale, entry?.fetch, db.calls]).toStrictEqual([
          false,
          "none",
          2,
        ]);
      }).pipe(Effect.provide(TestQuery.layer()));
    }));

  it("fetch exits: a Fail is stored, an interrupt reverts and a defect reaches the watchers unstored", () =>
    runTest(() => {
      const { GetUser, db, provide } = makeUsers({ staleTime: "Infinity" });
      return Effect.gen(function* body() {
        const watcher = yield* watch(GetUser.changes({ id: "1" }));
        yield* advance(10);

        db.mode = "fail";
        yield* GetUser.invalidate({ id: "1" });
        yield* advance(10);
        const failure = yield* GetUser.peek({ id: "1" });
        expect(
          AsyncResult.isFailure(failure)
            ? failure.cause.reasons.map((reason) => reason._tag)
            : []
        ).toStrictEqual(["Fail"]);

        db.mode = "interrupt";
        yield* GetUser.invalidate({ id: "1" });
        yield* advance(10);
        expect(watcher.seen).toStrictEqual([
          "Ann",
          "Ann waiting",
          "Failure(nope) previous",
          "Failure(nope) previous waiting",
          "Failure(nope) previous",
        ]);
        // A get waiting on a fetch that reverts is interrupted.
        const pending = yield* Effect.forkScoped(GetUser.get({ id: "1" }));
        yield* advance(10);
        expect(Exit.hasInterrupts(yield* Fiber.await(pending))).toBe(true);

        db.mode = "die";
        yield* GetUser.invalidate({ id: "1" });
        yield* advance(10);
        expect(yield* Fiber.await(watcher.fiber)).toStrictEqual(
          Exit.die("boom")
        );
        expect(show(yield* GetUser.peek({ id: "1" }))).toBe(
          "Failure(nope) previous"
        );

        // A Failure with no previous Success is dropped when its last watcher leaves.
        db.mode = "fail";
        const bare = yield* watch(GetUser.changes({ id: "2" }));
        yield* advance(10);
        expect(bare.seen).toStrictEqual(["Failure(nope)"]);
        yield* bare.stop;
        expect(yield* TestQuery.entry(GetUser, { id: "2" })).toBeUndefined();
      }).pipe(provide);
    }));

  it("ten restarts of one fetch in a row are reported once per streak", () =>
    runTest(() => {
      const { GetUser, provide } = makeUsers({ staleTime: "Infinity" });
      return Effect.gen(function* body() {
        yield* watch(GetUser.changes({ id: "1" }));
        for (let i = 0; i < 9; i += 1) {
          yield* GetUser.invalidate({ id: "1" });
        }
        expect(yield* TestQuery.problems).toStrictEqual([]);
        for (let i = 0; i < 5; i += 1) {
          yield* GetUser.invalidate({ id: "1" });
        }
        const problems = yield* TestQuery.expectProblem("FetchRestarted");
        expect(
          problems.map((problem) => [problem.query, problem.logKey])
        ).toStrictEqual([["users/GetUser", `{"id":"1"}`]]);

        // A settle ends the streak.
        yield* advance(10);
        yield* GetUser.invalidate({ id: "1" });
        for (let i = 0; i < 10; i += 1) {
          yield* GetUser.invalidate({ id: "1" });
        }
        expect((yield* TestQuery.expectProblem("FetchRestarted")).length).toBe(
          1
        );
      }).pipe(provide);
    }));

  it("the first definition under a name wins, and the second is reported", () =>
    runTest(() => {
      const first = makeUsers({ staleTime: "Infinity" });
      const second = makeUsers({ staleTime: 0 });
      return Effect.gen(function* body() {
        yield* first.GetUser.prefetch({ id: "1" });
        yield* advance(10);
        // The second definition says "always stale". The first one's staleTime is the entry's.
        expect(yield* second.GetUser.get({ id: "1" })).toStrictEqual({
          id: "1",
          name: "Ann",
        });
        yield* second.GetUser.peek({ id: "1" });
        expect(first.db.calls).toBe(1);
        const problems = yield* TestQuery.expectProblem("DuplicateName");
        expect(problems.map((problem) => problem.query)).toStrictEqual([
          "users/GetUser",
        ]);
        // One name is one service key, so both classes resolve to the one fetcher provided.
      }).pipe(first.provide);
    }));

  it("keys are canonical JSON of the encoded args, and the log key redacts", () =>
    runTest(() => {
      let calls = 0;
      class Search extends Query.Service<Search>()("Search", {
        args: {
          filter: Schema.optionalKey(
            Schema.Struct({ a: Schema.String, b: Schema.String })
          ),
          page: Schema.Number,
          token: Schema.Redacted(Schema.String),
        },
        error: Schema.Never,
        staleTime: "Infinity",
        success: Schema.Number,
      }) {
        static readonly layer = this.toLayer(() =>
          Effect.sync(() => (calls += 1))
        );
      }
      // The args are the key, so they needn't be a struct.
      class ById extends Query.Service<ById>()("ById", {
        args: Schema.Any,
        error: Schema.Never,
        staleTime: "Infinity",
        success: Schema.Number,
      }) {
        static readonly layer = this.toLayer(() =>
          Effect.sync(() => (calls += 1))
        );
      }
      return Effect.gen(function* body() {
        const token = Redacted.make("s3cret");
        // Property order doesn't matter. A different secret is a different entry.
        const results = [
          yield* Search.get({ filter: { a: "a", b: "b" }, page: 1, token }),
          yield* Search.get({
            filter: { a: "a", b: "b" },
            page: 1,
            token: Redacted.make("s3cret"),
          }),
          yield* Search.get({
            filter: { a: "a", b: "b" },
            page: 1,
            token: Redacted.make("other"),
          }),
          yield* ById.get("1"),
          yield* ById.get(1),
        ];
        expect(results).toStrictEqual([1, 1, 2, 3, 4]);
        expect(
          (yield* TestQuery.fetches).map((fetch) => fetch.logKey)
        ).toStrictEqual([
          `{"filter":{"a":"a","b":"b"},"page":1,"token":{"~redacted":true}}`,
          `{"filter":{"a":"a","b":"b"},"page":1,"token":{"~redacted":true}}`,
          `"1"`,
          "1",
        ]);

        // Building a key throws, and never prints the args or anything an arg can set, such as its string tag.
        class Tagged {
          readonly [Symbol.toStringTag] = "s3cret";
        }
        const messages: string[] = [];
        const probes: readonly Effect.Effect<
          unknown,
          never,
          Search | ById | Query.Cache
        >[] = [
          // SAFETY: "s3cret" is a string where the args Schema wants a number; the test proves the key builder rejects it.
          // oxlint-disable-next-line typescript/no-explicit-any -- the wrong-typed value is the point of the case; the Schema rejects it at runtime.
          Search.get({ page: "s3cret" as any, token }),
          ById.peek({ secret: 1n }),
          ById.prefetch(new Tagged()),
          ById.invalidate(Number.NaN),
        ];
        for (const effect of probes) {
          const exit = yield* Effect.exit(effect);
          // SAFETY: squash returns the rejection the test installed; the cases above fail with Errors.
          messages.push(
            Exit.isFailure(exit)
              ? (Cause.squash(exit.cause) as Error).message
              : "no throw"
          );
        }
        expect(messages).toStrictEqual([
          `[Query] "Search": the args don't encode with the query's args Schema`,
          `[Query] "ById": the encoded args hold a value JSON can't carry (a bigint). Give the args Schema a JSON encoding.`,
          `[Query] "ById": the encoded args hold a value JSON can't carry (a class instance). Give the args Schema a JSON encoding.`,
          `[Query] "ById": the encoded args hold a value JSON can't carry (a non-finite number). Give the args Schema a JSON encoding.`,
        ]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Search.layer, ById.layer, TestQuery.layer())
        )
      );
    }));

  it("an optional field of the args struct that is undefined is the same entry as a missing one", () =>
    runTest(() => {
      let calls = 0;
      const fetcher = Effect.sync(() => () => Effect.sync(() => (calls += 1)));
      const options = {
        error: Schema.Never,
        staleTime: "Infinity",
        success: Schema.Number,
      } as const;
      class Search extends Query.Service<Search>()("Search", {
        ...options,
        // oxlint-disable-next-line eslint/sort-keys -- the struct lists token first to match the redaction cases below; the test asserts the canonical key order.
        args: {
          token: Schema.Redacted(Schema.String),
          page: Schema.optional(Schema.Number),
          // Here `null` is data and `undefined` is dropped, so the two are told apart.
          size: Schema.optional(Schema.NullOr(Schema.Number)),
          // A required key keeps its undefined.
          cursor: Schema.UndefinedOr(Schema.String),
        },
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      // The Schema decides what the args may be: this property may be missing, and may not be undefined.
      class Exact extends Query.Service<Exact>()("Exact", {
        ...options,
        args: { page: Schema.optionalKey(Schema.Number) },
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      // Two more ways to write a struct with optional fields. What isn't a field keeps its undefined.
      class Rest extends Query.Service<Rest>()("Rest", {
        ...options,
        args: Schema.StructWithRest(
          Schema.Struct({
            id: Schema.Number,
            page: Schema.optional(Schema.Number),
          }),
          [Schema.Record(Schema.String, Schema.UndefinedOr(Schema.Number))]
        ),
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      class Keyed extends Query.Service<Keyed>()("Keyed", {
        ...options,
        args: Schema.Record(
          Schema.Literals(["a", "b"]),
          Schema.optional(Schema.Number)
        ),
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      return Effect.gen(function* body() {
        const token = Redacted.make("s3cret");
        const cursor = undefined;
        const results = [
          yield* Search.get({
            cursor,
            page: undefined,
            size: undefined,
            token,
          }),
          yield* Search.get({ cursor, token }),
          yield* Search.get({ cursor, size: null, token }),
          yield* Rest.get({ extra: undefined, id: 1, page: undefined }),
          yield* Rest.get({ extra: undefined, id: 1 }),
          yield* Keyed.get({ a: undefined, b: 1 }),
          yield* Keyed.get({ b: 1 }),
        ];
        expect(results).toStrictEqual([1, 1, 2, 3, 3, 4, 4]);
        expect(
          (yield* TestQuery.fetches).map(
            (fetch) => `${fetch.query} ${fetch.logKey}`
          )
        ).toStrictEqual([
          `Search {"cursor":null,"token":{"~redacted":true}}`,
          `Search {"cursor":null,"size":null,"token":{"~redacted":true}}`,
          `Rest {"extra":null,"id":1}`,
          `Keyed {"b":1}`,
        ]);
        const exact = yield* Effect.exit(Exact.get({ page: undefined }));
        // SAFETY: squash returns the Schema's rejection Error; the message is what the test asserts.
        expect(
          Exit.isFailure(exact)
            ? (Cause.squash(exact.cause) as Error).message
            : "no throw"
        ).toBe(
          `[Query] "Exact": the args don't encode with the query's args Schema`
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Search.layer,
            Exact.layer,
            Rest.layer,
            Keyed.layer,
            TestQuery.layer()
          )
        )
      );
    }));

  it("the drop comes before the args Schema sees the args, and runs nothing of theirs to decide", () =>
    runTest(() => {
      const options = {
        error: Schema.Never,
        staleTime: "Infinity",
        success: Schema.Number,
      } as const;
      const fetcher = Effect.succeed(() => Effect.succeed(1));
      // A check gets the args after the drop, so it treats undefined as it treats a missing property.
      class Checked extends Query.Service<Checked>()("Checked", {
        ...options,
        args: Schema.Struct({ page: Schema.optional(Schema.Number) }).check(
          Schema.makeFilter((args) => "page" in args)
        ),
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      // The caller passes a number. This undefined is made by the Schema's own encoding, and JSON can't carry it.
      class Encoded extends Query.Service<Encoded>()("Encoded", {
        ...options,
        args: Schema.Struct({ value: Schema.optionalKey(Schema.Unknown) }).pipe(
          Schema.decodeTo(
            Schema.Number,
            SchemaTransformation.transform({
              decode: () => 1,
              // oxlint-disable-next-line anti-slop/no-known-value-widening -- the transform's encode side must spell the anonymous args shape; inference narrows value to undefined and breaks the Getter.
              encode: (): { readonly value?: unknown } => ({
                value: undefined,
              }),
            })
          )
        ),
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      // A declared type's guard is the Schema's to run. `when` names undefined, so the guard isn't asked.
      // `until` doesn't, and only the guard could say, so the Schema gets the undefined and rejects it.
      const guarded: unknown[] = [];
      const Stamp = Schema.declare((u): u is Date => {
        guarded.push(u);
        return u instanceof Date;
      });
      class Guarded extends Query.Service<Guarded>()("Guarded", {
        ...options,
        args: {
          until: Schema.optionalKey(Stamp),
          when: Schema.optional(Stamp),
        },
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      // What the drop leaves is handed on as it was defined, and args that lose nothing are handed on themselves.
      const seen: unknown[] = [];
      class Plain extends Query.Service<Plain>()("Plain", {
        ...options,
        args: Schema.Struct({
          id: Schema.String,
          page: Schema.optional(Schema.Number),
        }).check(
          Schema.makeFilter((args) => {
            seen.push(args);
            return true;
          })
        ),
      }) {
        static readonly layer = this.toLayer(fetcher);
      }

      return Effect.gen(function* body() {
        expect(yield* Checked.get({ page: 1 })).toBe(1);
        expect(yield* Guarded.get({ when: undefined })).toBe(1);
        expect(guarded).toStrictEqual([]);
        expect([
          yield* thrown(Checked.get({ page: undefined })),
          yield* thrown(Checked.get({})),
          yield* thrown(Encoded.get(1)),
          yield* thrown(Guarded.get({ until: undefined })),
        ]).toStrictEqual([
          `[Query] "Checked": the args don't encode with the query's args Schema`,
          `[Query] "Checked": the args don't encode with the query's args Schema`,
          `[Query] "Encoded": the args don't encode with the query's args Schema`,
          `[Query] "Guarded": the args don't encode with the query's args Schema`,
        ]);
        expect(guarded).toStrictEqual([undefined]);
        // The Schema reads `id`, which isn't enumerable, and never reads `broken`, which throws.
        // SAFETY: the Schema reads only id and the enumerable page; the cast names what defineProperties built.
        const defined = Object.defineProperties(
          { page: undefined },
          {
            broken: {
              enumerable: true,
              get() {
                throw new Error("read");
              },
            },
            id: { value: "1" },
          }
        ) as { readonly id: string; readonly page: undefined };
        const same = { id: "2", page: 2 };
        // A getter is the Schema's to run, once, and a property the args inherit is the Schema's to find.
        let reads = 0;
        const getter = {
          id: "3",
          get page() {
            reads += 1;
            // oxlint-disable-next-line eslint/no-useless-return -- a get accessor must return for tsc; the undefined value is the point, and the Schema drops the field.
            return;
          },
        };
        const inherited: { readonly id: string } = Object.assign(
          Object.create({ page: undefined }),
          { id: "4" }
        );
        for (const args of [defined, same, getter, inherited]) {
          yield* Plain.get(args);
        }
        expect(seen[1]).toBe(same);
        expect(reads).toBe(1);
        expect(
          (yield* TestQuery.fetches).map(
            (fetch) => `${fetch.query} ${fetch.logKey}`
          )
        ).toStrictEqual([
          `Checked {"page":1}`,
          `Guarded {}`,
          `Plain {"id":"1"}`,
          `Plain {"id":"2","page":2}`,
          `Plain {"id":"3","page":null}`,
          `Plain {"id":"4","page":null}`,
        ]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Checked.layer,
            Encoded.layer,
            Guarded.layer,
            Plain.layer,
            TestQuery.layer()
          )
        )
      );
    }));

  it("what a field of the args struct holds reaches the args Schema as it was passed", () =>
    runTest(() => {
      let calls = 0;
      const fetcher = Effect.sync(() => () => Effect.sync(() => (calls += 1)));
      const options = {
        error: Schema.Never,
        staleTime: "Infinity",
        success: Schema.Number,
      } as const;
      const Page = Schema.Struct({
        page: Schema.optional(Schema.NullOr(Schema.Number)),
      });
      class Paged extends Schema.Class<Paged>("Paged")({
        page: Schema.optional(Schema.Number),
      }) {}
      class Nested extends Query.Service<Nested>()("Nested", {
        ...options,
        args: { filter: Page, id: Schema.String },
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      class Held extends Query.Service<Held>()("Held", {
        ...options,
        args: {
          instance: Paged,
          option: Schema.Option(Page),
          record: Schema.Record(Schema.String, Schema.UndefinedOr(Page)),
          tuple: Schema.Tuple([Page, Schema.UndefinedOr(Page)]),
          union: Schema.Union([Page, Schema.String]),
        },
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      // Args that are not themselves a struct are not looked into either.
      class ByClass extends Query.Service<ByClass>()("ByClass", {
        ...options,
        args: Paged,
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      class ByUnion extends Query.Service<ByUnion>()("ByUnion", {
        ...options,
        args: Schema.Union([Page, Schema.String]),
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      class BySuspend extends Query.Service<BySuspend>()("BySuspend", {
        ...options,
        args: Schema.suspend(() => Page),
      }) {
        static readonly layer = this.toLayer(fetcher);
      }
      return Effect.gen(function* body() {
        const page = { page: undefined };
        // The JSON encoding has no `undefined`, so below the args struct it and `null` are one entry, whichever
        // comes first, and the later caller gets the earlier one's data. A missing property is another entry.
        const results = [
          yield* Nested.get({ filter: { page: undefined }, id: "a" }),
          yield* Nested.get({ filter: { page: null }, id: "a" }),
          yield* Nested.get({ filter: { page: null }, id: "b" }),
          yield* Nested.get({ filter: { page: undefined }, id: "b" }),
          yield* Nested.get({ filter: {}, id: "a" }),
          yield* Held.get({
            instance: new Paged(page),
            option: Option.some(page),
            record: { direct: undefined, held: page },
            tuple: [page, undefined],
            union: page,
          }),
          yield* ByClass.get(new Paged(page)),
          yield* ByClass.get(new Paged({})),
          yield* ByUnion.get(page),
          yield* BySuspend.get(page),
        ];
        expect(results).toStrictEqual([1, 1, 2, 2, 3, 4, 5, 6, 7, 8]);
        expect(
          (yield* TestQuery.fetches).map(
            (fetch) => `${fetch.query} ${fetch.logKey}`
          )
        ).toStrictEqual([
          `Nested {"filter":{"page":null},"id":"a"}`,
          `Nested {"filter":{"page":null},"id":"b"}`,
          `Nested {"filter":{},"id":"a"}`,
          `Held {"instance":{"page":null},"option":{"_tag":"Some","value":{"page":null}},` +
            `"record":{"direct":null,"held":{"page":null}},"tuple":[{"page":null},null],"union":{"page":null}}`,
          `ByClass {"page":null}`,
          `ByClass {}`,
          `ByUnion {"page":null}`,
          `BySuspend {"page":null}`,
        ]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Nested.layer,
            Held.layer,
            ByClass.layer,
            ByUnion.layer,
            BySuspend.layer,
            TestQuery.layer()
          )
        )
      );
    }));

  it("a definition and a cache throw on durations that can't be meant", () => {
    expect(define({ staleTime: -1 })).toThrow(
      `[Query] "Bad": staleTime can't be negative`
    );
    expect(define({ staleTime: "-Infinity" })).toThrow(
      "staleTime can't be negative"
    );
    // SAFETY: "-1 second" is not a valid Duration; the test proves the definition rejects it.
    expect(define({ idleTimeToLive: "-1 second" as Duration.Input })).toThrow(
      "idleTimeToLive can't be negative"
    );
    expect(define({ refetchInterval: 0 })).toThrow(`"500 millis"`);
    expect(define({ refetchInterval: "0 seconds" })).toThrow(
      "refetchInterval must be positive"
    );
    expect(define({ refetchInterval: 999 })).toThrow(`"500 millis"`);
    expect(() => Query.layer({ idleTimeToLive: -1 })).toThrow(
      "[Query] idleTimeToLive can't be negative"
    );
    // Zero and "Infinity" are legal where they mean something.
    expect(
      define({
        idleTimeToLive: 0,
        refetchInterval: "500 millis",
        staleTime: "Infinity",
      })
    ).not.toThrow();
    expect(define({ refetchInterval: 1000 })).not.toThrow();
  });

  it("an unexpected problem fails the test's Scope", () =>
    runTest(() => {
      const first = makeUsers({ staleTime: "Infinity" });
      const second = makeUsers({ staleTime: "Infinity" });
      return Effect.gen(function* body() {
        const exit = yield* Effect.exit(
          Effect.andThen(
            first.GetUser.peek({ id: "1" }),
            second.GetUser.peek({ id: "1" })
          ).pipe(Effect.provide(TestQuery.layer()))
        );
        const defect = Exit.isFailure(exit)
          ? Cause.squash(exit.cause)
          : undefined;
        expect(defect).toBeInstanceOf(TestQuery.ProblemsError);
        if (!(defect instanceof TestQuery.ProblemsError)) {
          throw new TypeError("expected a ProblemsError");
        }
        expect(defect.problems.map((problem) => problem._tag)).toStrictEqual([
          "DuplicateName",
        ]);
      });
    }));

  it("changes does not emit after a terminal defect for a slow consumer", () =>
    runTest(() => {
      let calls = 0;
      class Flaky extends Query.Service<Flaky>()("test/FlakyChanges", {
        args: { id: Schema.String },
        error: Schema.Never,
        staleTime: 0,
        success: Schema.Number,
      }) {
        static readonly layer = this.toLayer(() =>
          (calls += 1) === 1 ? Effect.succeed(1) : Effect.die("boom")
        );
      }
      return Effect.gen(function* body() {
        const gate = yield* Latch.make(false);
        const waiting: boolean[] = [];
        const consumer = yield* Flaky.changes({ id: "1" }).pipe(
          Stream.runForEach((result) =>
            Effect.gen(function* each() {
              waiting.push(result.waiting);
              if (waiting.length === 1) {
                yield* gate.await;
              }
            })
          ),
          Effect.exit,
          Effect.forkChild
        );
        yield* flush;
        yield* Flaky.invalidate({ id: "1" });
        yield* flush;
        gate.openUnsafe();
        const exit = yield* Fiber.join(consumer);
        expect(
          Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
        ).toBe("boom");
        expect(waiting).toStrictEqual([false, true]);
        const cache = yield* Query.Cache;
        expect(
          Query.internals(cache).inspect(Query.defOf(Flaky), { id: "1" })
            ?.watchers
        ).toBe(0);
      }).pipe(Effect.provide(Layer.merge(Flaky.layer, Query.layer())));
    }));
});
