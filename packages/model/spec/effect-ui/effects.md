# Effect UI: effects inventory (Command, Subscription, Mount, Feature, html helpers)

## 1. `Command.ts` (`packages/ui/src/Command.ts`)

### Type ids, guards and accessors

| Export | Sketch | Semantics |
| --- | --- | --- |
| `TypeId` / `DefinitionTypeId` / `UnmatchedTypeId` | `"~@effect/ui/Command"`, `…/Definition`, `…/Unmatched` (:98, :116, :135) | Brand an issued Command, a definition (factory or Service class), and an unmatched Command. |
| `isCommand(u)` | :1027 | Has `TypeId`. Matches issued Commands and `Interrupt`. Unmatched Commands also carry `TypeId`, since `UnmatchedProto` includes it. |
| `isUnmatched(u)` | :1038 | Has `UnmatchedTypeId`. |
| `isDefinition(u)` | :1051 | Has `DefinitionTypeId`. |
| `nameOf(def)` | :1061 | The Service key if `Context.isKey(def)`, otherwise the factory's `name`. |
| `groupKeyOf(def, group)` | :1072, `@internal` | `undefined` when `group` is undefined; otherwise canonical JSON of the encoded pick. |

### Models and types

- **`Mode = "concurrent" | "switch" | "queue"`** (:172). The exact semantics are in §1.3. There is deliberately no "ignore while running" mode: `update` would still apply its Model change, so keep a `Submitting` state in the Model and issue nothing while it holds.
- **`ArgsInput`**: a fields record or a `Schema.Struct` (:181). `ArgsFields<In>` is at :192. `ArgsOf<In>` (:204) is the decoded struct that the body, `invalidates`, `optimistic` and `writes` receive.
- **`GroupField<In>`** (:222): only args fields whose encoded form is JSON can be named in `group`.
- **`GroupArg<Args,G>`** (:239): `[]` when the Command has no group, otherwise `[group?: Pick<Args,G>]`. Used by `interrupt` and `h.isRunning`.
- **`MakeArgs<Args>`** (:249): the args parameter is optional when every field is optional (`make()` defaults to `{}`).
- **`Options<In,G>`** (:271):
  - `args` is required. The log encodes it through the Schema, redacting `Schema.Redacted` fields.
  - `stream?: boolean` declares a Stream Command, so a story knows the kind without building a Layer.
  - `mode?` defaults to `"concurrent"`.
  - `group?: G[]`: the group key is canonical JSON of the encoded picked fields. Without it, all runs of the Command in one instance form one group.
  - A `group` field that isn't among the args **throws at definition time**: `"${name}: the group field "x" isn't one of its args"` (`makeGroup`, ~:950). The pick codec is built lazily on first use.
- **`FrameworkServices`** (:307): `{ Scope, Refs: Renderer.Refs, Cache: Query.Cache }`, widened by module augmentation. `Html.ts` adds `HtmlHost: Html.Host`. `FrameworkService` (:320) is the union. These are removed from `R`, so a component never "requires" them.
- **`Declared`** (:331), computed from the args at issue:
  - `invalidates: Query.Target[]` is applied **when the run's fiber exits, however it exits**.
  - `optimistic: Query.Patch[]` is registered at issue.
  - `writes: (success) => Query.Write[] | undefined`.
  - `afterRefetch: Duration | undefined`.
- **`Data`** (:355): `Declared` plus:
  - `name`
  - `args` (the decoded struct)
  - `mode`
  - `groupKey`
  - `argsSchema` and `service` (both `@internal`)
- **`Proto<Msg,Source,SourceE>`** (:385): `resolve` (success → Msg, composes every map) and `reject` (typed error → Msg, or `undefined`). Both are internal.
- **`Kind = "Effect" | "Stream"`** (:428).
- **`Issued<Msg,R,Source,K,SourceE>`** (:451):
  - `_tag: K`
  - `effect` (Effect kind, with map/match applied) or `stream` (Stream kind). The other field is `undefined`.
  - `work`, internal: the raw body. The runtime runs this, so the exit can tell success from typed failure.
- **`Unmatched<A,E,R,K>`** (:487): issued by a Service with a non-Never `error`. It is _not_ a `Command`, so `$.run` and `Command.map` reject it in the types until `match`.
- **`Interrupt`** (:514): `{ _tag: "Interrupt", name, groupKey }`. Produces no message.
- **`Command<Msg,R>`** (:538) = `Issued<…,"Effect"> | Issued<…,"Stream"> | Interrupt`. A Command whose result is `never` (`Effect.never`, `Effect.die`, `Stream.never`) can be run by any component.
- **Utility types**: `Requirements<C>` :550, `Message<C>` :560, `Result<C>` :574 (the definition's own success, used by story `resolve`), `Failure<C>` :588 (the typed error, used by story `fail`), `Mapped<C,B>` :603 (an `Interrupt` stays an `Interrupt`).
- **`Definition<Args,A,IsStream,E,G>`** (:624): `stream`, `mode`, `group`, and the internal `~group(args) → GroupSource`. `Definition.Any`, `Definition.Args<D>` and `Definition.IsStream<D>` are at :651–700.
- **`Factory`** (:707): what `make` returns. `make(...args)`, `name`, `args` Schema.
- **`Service<Self,Key,Args,Success,IsStream,Error,G>`** (:735): a `Context.ServiceClass` plus `Definition`. Members are `toLayer`, `args`, `success`, `error` (defaults to `Schema.Never`) and `make`. `make` returns `Unmatched` when `Error["Type"]` isn't `never`.
- **`Service.Implementation`** (:799): `(args) => Effect<A, Err, FrameworkService>` or `Stream<…>`. The body may use framework services on every call.
- **`Service.Options`** (:822): `Options` plus:
  - `success` (required)
  - `error?`
  - `invalidates?: (args) => Target[]`: optional; **omitting it invalidates nothing**.
  - `optimistic?: (args) => Patch[]`
  - `writes?: (success, args) => Write[]`: not allowed with `stream: true`, per the second overload.
- **`GroupSource`** (:933, internal): `{ key, schema, picked }`. The log encodes the picked fields with redaction rather than logging the raw key.

### 1.1 Constructors

- **`make(name, options, body)`** (:1120). Body: `(args) => Effect<Msg, never, R extends FrameworkService>`, or a Stream with `stream: true`.
  - The body can't fail (`E = never`).
  - If the body requires a non-framework service, it doesn't compile, and the error names `FrameworkService`.
  - Declares nothing to the cache: `invalidates`, `optimistic` and `writes` are empty, `service` is `undefined`.
  - Gotcha: `Effect.tryPromise(fetch)` compiles but can't be faked. Put I/O behind a `Service`.
  - **The body Effect is built when `make(args)` is called, at issue time.** `work: run(args)` is evaluated eagerly, so side effects in the outer body function (outside the Effect) run inside `update`.
- **`Service<Self>()(key, options)`** (:1234). Returns a class. `key` is both the log/story name and the Context key.
  - `toLayer(fnOrEffect)` gives `Layer.succeed` for a function, or `Layer.effect` for an Effect that builds one. The Effect runs once per Layer build and captures dependencies. `Scope` is excluded from the Layer's `R`.
  - Each issued run resolves the service: `Effect.flatMap(service, run => run(args))`, or `Stream.unwrap` for a Stream Command.
  - `invalidates`, `optimistic` and `writes` are computed from the args at issue.
- **`interrupt(definition, group?)`** (:1670). Interrupts the instance's running, queued and awaiting runs of that Command name, only those of the group when a pick is given.
  - Produces no message.
  - An interrupted run dispatches nothing and logs `CommandInterrupted` when its fiber exits.
  - It still holds its group until then: queue/switch successors wait for its cleanup.

### 1.2 Combinators

| Export | Sketch | Semantics |
| --- | --- | --- |
| `map` | dual, :1355 | Composes `resolve`, and also wraps `reject` (after `match`, the failure message is mapped too). Keeps name, args, options and `Source`. The data-first form returns an `Interrupt` unchanged; the pipeable form takes only issued Commands. Gotcha: the pipeable form infers one `Source`/`R`, so use the data-first form for unions. |
| `as(message)` | dual, :1402 | `map(() => message)`. A Stream Command emits the same value for every element. After `match`, both channels are replaced. |
| `asNoop` | :1452 | `as(Component.noop)`. The run ends with no message and `CommandEnded{silent:true}`. Takes issued Commands only, never `Unmatched`, so a typed failure can't be dropped by accident. After `match` it silences both channels; to keep the failure, use `match({onSuccess: () => noop, onFailure})`. On a navigation Command it also hides a `"blocked"` outcome. |
| `match({onSuccess,onFailure})` | dual, :1508 | Only for `Unmatched`. `onSuccess` maps the success or each Stream element. `onFailure` maps the typed failure, which **ends** a Stream Command. Defects and interrupts are not mapped. Using `match` on a Command that can't fail doesn't compile. |
| `afterRefetch(budget)` | dual, :1620; type guard `AwaitsRefetch` :1537 | Only for an Effect-kind `Service` Command, issued or unmatched, on either side of `map`/`match`. Stream and `make` Commands give a type error with an explanatory message key. Applying it twice: the second replaces the first. Details below. |

`afterRefetch` details (:1560–1610 and `commandRun.ts#Runs.wait`):

- **What it waits for:** everything the run invalidated (declared targets plus targets implied by patches), minus entries its own `writes` stored fresh. Of those, only entries that have a watcher (from any instance) when invalidation is applied. A watcher that arrives later doesn't join.
- **When an entry settles:** when it has no refetch in flight and none owed, whether the refetch succeeds, fails or dies. The wait ends on the slowest entry.
- **Budget:** a `Duration.Input`. `"Infinity"` waits with no bound, `0` doesn't wait, and a bare number is milliseconds. It runs on the Effect Clock, starting when invalidation is applied: remaining = budget − `handle.sinceApplied()`.
- **Cut runs:** a run cut by the budget, by `switch` or by `interrupt` delivers its success **at once**, and its refetches keep running.
- **Failures and closing:** a typed failure is delivered at once. An interrupt before the body succeeds sends nothing. If the instance closes during the wait, the message is dropped (`waitEnded: "closed"`).
- **`h.isRunning`** stays true through the wait.
- **Under `queue`:** the next run starts when the body exits, and messages keep issue order.
- **Render timing:** each awaited entry's query result is written before the success, in one render, for the last entry to settle. Two entries settling apart can briefly show a patched row next to a refetched one.
- **Logging:** when the awaited set is non-empty, `CommandAwaiting{entries}` is logged. An empty set logs `CommandEnded{waitEnded:"nothing"}`. `CommandEnded.waitEnded` is one of `settled | nothing | budget | switch | interrupt | closed`, plus `outstanding` entries.

### 1.3 Concurrency: exact scheduler (`internal/schedule.ts`, shared by the runtime and Story)

- **Run statuses:**
  - `running`
  - `queued`
  - `awaiting`: the fiber has exited and the result (a message or noop) waits for its own afterRefetch wait, or under `queue` behind an earlier result.
  - `stopping`: stopped, but the fiber, including cleanup, hasn't exited yet.
- **Group:** `(instance, Command name, groupKey)`. A run **holds** its group while it is `running` or `stopping`.
- **`schedule(inFlight, command)`:**
  - `Interrupt`: action `none`. Interrupts every _non-stopping_ entry with that name (and the groupKey, if given).
  - `concurrent`: always starts and interrupts nothing.
  - `switch`: interrupts every non-stopping entry of the group (running, queued **and awaiting**). Starts now if nothing holds the group, otherwise queues until every cut fiber has exited.
  - `queue`: queues while any group run is `running` or `stopping`. An `awaiting` run doesn't hold the group.
  - A `stopping` run is never interrupted again.
- **`next(inFlight, run)`:** the oldest `queued` run of the group, once nothing holds the group.
- **`deliverable`:** under `queue`, the group's _oldest_ awaiting run (preserves issue order); otherwise the run itself. Returns nothing until that run's wait has ended.
- **Ordering in `exited` (normal success):** the result is computed, the run is marked `awaiting`, **the next queued run is promoted (forked) first**, then the wait starts if `afterRefetch` applies, then delivery happens. The promoted fiber starts after `Effect.yieldNow`, so the message is delivered before its work runs.
- **Stopping an awaiting run** (interrupt or switch while in an afterRefetch wait) delivers its held message at once, unless the instance or tree is closed, in which case it is dropped.
- **A queued run that never got a fiber** is removed immediately when stopped and logs `CommandInterrupted` right away.

### 1.4 Runtime guarantees (`internal/commandRun.ts`, `fork.ts`, `kernel.ts`)

**Issue**

- `update` returns Commands. `Kernel.send` calls `issueAll` **in array order** (`kernel.ts:~600`), each with `{seq, index}` (`seq` is the `Update` log entry's seq; `-1` when there is no log).
- Issuing stops if the instance closes mid-loop.
- A Command issued by a closed instance is ignored.

**On the server**

- No Command runs. `server.drop` logs `CommandDropped{reason:"server"}`, only for `update` Commands (those with an `issued`).
- It reports a `ServerCommandIssued` problem every time (:1700, `runtime.ts:~215`).
- `init` Commands are dropped silently because the client runs them on adopt. A variant message says "the server renders a list's first page only".

**Query handle**

- For a `Service` Command, when the query cache is loaded, the runtime calls `cache.beginRun({command, invalidates, optimistic, afterRefetch})` **at issue**, so optimistic patches apply immediately.
- If that throws, the instance fails `in: "init"` (before first render) or `"update"`.
- A `Service` Command with `writes` but no cache loaded yet gets an "early" handle once the cache loads.

**Start**

- Gated by the instance's keyed-provide `hold`: a run issued before a keyed Layer reselect is held, then dropped with reason `"layer"` on swap.
- Waits for the instance's Layer (`env.ctx`). If the Layer failed, the run stops with reason `"layer"`.
- Each run gets:
  - its own sequential `Scope`, provided as `Scope.Scope` and closed with the run's exit;
  - `Renderer.Refs`, where `lookup` waits for the commit;
  - an Effect span named after the Command, with attributes `{path, mode}`.
- `CommandStarted{spanId, traceId}` is logged inside the span.
- The fiber is forked through the tree's executor scheduler **after `Effect.yieldNow`**, so it never runs synchronously inside `update`.
- Navigation Commands (`@effect/ui/Router/*` Service Commands) in a routed tree run deferred in the issuing flush with `PreventSchedulerYield` (`due.ts`).

**Stream Commands**

- Each element is `resolve`d and sent **immediately** as it arrives. Elements are not held, queued or ordered by `queue`.
- A Stream that succeeds ends with `CommandEnded`.
- A Stream that fails with a matched typed error gets the `onFailure` message through the held/deliver path.

**Silent results**

- `isNoop(message)` messages are never sent.
- `silent` is true only if there was at least one result and every result was noop.
- A Stream that ends with zero elements is `silent: false`. A run that ends while its instance is closing is also `silent: false`.
- Noop is recognized by its type-id string, not identity (works across duplicate `effect` copies; `noop.ts`).

**Failures**

- A defect, or a typed failure with no `reject`, fails the instance: `Kernel.fail(inst, "command", cause, …, name, issued)`.
- A throw inside `resolve`, `reject` or `writes` becomes a die and fails the instance too.
- If the instance is already closed when a run fails, the runtime runs `Effect.logError("<path> is gone, and its Command X failed")` and doesn't fail anything.
- A stopped run that **dies** during interruption/cleanup is reported as a `CleanupFailed` problem (:1722). It doesn't fail the instance or the replacing run.

**Interrupt reasons** (`MessageLog.InterruptReason`)

- `interrupt`: `Command.interrupt`.
- `switch`: a later run of a `switch` group.
- `unmount`: the instance was removed or the app disposed.
- `layer`: the provided Layer failed before the run could start, or a keyed provide reselected and dropped earlier runs.
- `self`: the work interrupted itself.

**Ownership and closing**

- Every run is owned by the issuing instance and ends with it. A save that must outlive a page is issued from a longer-lived ancestor.
- On close (`Runs.close`), the runtime first waits for fibers already "held" by the instance (descendants' and subscriptions' still-running cleanup), then stops all runs with `unmount`. Its own still-running fibers are added to the ancestors' hold set, so a parent's cleanup waits for them.

**`h.isRunning(def, group?)`**

- Defined in `View.ts:2049`/`:2229`, and in the parts helper at `Component.ts:1601`.
- True while the instance has any run of that name (and groupKey, if given) in the list: queued, running, awaiting, or stopping until its fiber exits.
- Ends when the message is delivered, or at fiber exit for a run that sends nothing.
- Available in the view and parts only; `update` can't read it.
- In a Story or Scene it is derived from pending Commands.

**Story resolution**

- `resolve` takes the message for a Command that returns a message, or the definition's own success for a mapped Command.
- `fail` takes the typed error.
- A Stream Command uses `next` per element and `end` at completion. The mapping runs in the test.

### 1.5 Problems (tagged classes)

- **`ServerCommandIssued{message, path, command}`** (:1700).
- **`CleanupFailed{message, path, command, cause}`** (:1722). Message: `"[@effect/ui] <path>'s Command <name> was stopped, and it died before its fiber exited."`

---

## 2. `Subscription.ts`

| Export | Sketch | Semantics |
| --- | --- | --- |
| `TypeId` | :56 | Brand. |
| `Subscription<Msg,R>` | `{ key, name, deps?, stream: Stream<Msg, never, R> }` (:89) | `E = never`. A defect fails the instance. A Stream that **ends stays stopped until its key leaves and comes back**; put reconnect logic inside the Stream. `R` joins the component's requirements. `deps` is always an array (a single dep and a one-element tuple are identical), or `undefined`. |
| `Dep` / `Deps` | `string \| number \| boolean \| null`; a single dep or a tuple (:104, :113) | Primitives only. |
| `Requirements<S>` | :122 | Extracts `R`. |
| `keyOf(name, deps?)` | :153 → `internal/subscriptions.ts` | No deps: `name`, with every `:` doubled. With deps: `name:` plus comma-joined deps. Strings are JSON-quoted; other values use their literal, with `-0` written as `"-0"`. So `1`≠`"1"`, `["a,b","c"]`≠`["a","b,c"]`, `NaN`≠`null`, `0`≠`-0`; `keyOf("page:null")` = `page::null` and `keyOf("page", null)` = `page:null`. |
| `make(name, stream)` / `make(name, deps, build)` | :194 | With deps, the builder sees **only its deps, never the Model**, which prevents stale Model reads. The stream is `Stream.suspend(() => build(deps))`: the builder runs when the Stream starts, so it never runs on the server. Different deps give different keys, so the old key closes before the new one starts. |
| `DirectControls<State,Msg>` | `{ emit(msg, accepted?), fail(cause), enter(f(latest)) }` (:242) | For host packages. |
| `direct(name, deps, state, attach)` | :269 | A Subscription that attaches synchronously to a host event source instead of running a Stream. `attach(context, controls)` returns a detach function. `state` is updated on every `subscriptions` run for the key; read it inside `enter`. `emit` dispatches synchronously and calls `accepted` right before dispatch (e.g. to `preventDefault`). Used internally by `HtmlSubscription` and `Router`. |

### Lifecycle (`internal/subscriptionRun.ts#sync`)

**When it runs**

- The component's `subscriptions({model, props, queries})` is re-run on mount, after each `update`, and on a props change.
- **Falsy entries are filtered** (`Component.ts:3793`, `.filter(e => !!e)`), so `cond && Subscription.make(…)` works.
- Skipped when the instance is closed or the host is `inert`.

**On the server**

- Only the root instance, once per tree. No Streams run.
- Subscriptions carrying an internal `onServer` hook are called with the root context (used by the Router).
- A throw from `subscriptions` is rethrown on the server. On the client it fails the instance `in: "subscription"`.

**Validation**

- Two entries with the same key fail the instance: `"<path>: two Subscriptions share the key K. A key runs one Stream, so give each its own name or deps."`
- Returning `Router.prefetch` twice also fails the instance.

**Diff by key**

1. Keys that disappeared are stopped first: `SubscriptionStopped{key, name, deps}` is logged, the direct source is detached, and the fiber is interrupted. A fiber still finishing is held by ancestors.
2. New keys start next: `SubscriptionStarted{key, name, deps}`.
3. **For an existing key, only `latest` is updated. The Stream is NOT restarted**, even if the new declaration has a different `stream`. Only direct Subscriptions read `latest`.

**Start**

- Gated by the keyed-provide `hold`, and waits for the instance's Layer context.
- Each key gets its own sequential `Scope`.
- Forked after `yieldNow`, so the start is asynchronous.
- Each element is delivered through `enter`: dirty ancestors are rendered first (`Kernel.renderAbove`), then the message is sent if the key is still current. Elements from a stopped key are dropped.
- A non-interrupt failure while the key is current fails the instance `in: "subscription"`, tagged with the key.

**Keyed-Layer swap and close**

- A keyed-Layer swap stops every key and logs `SubscriptionStopped` for each.
- On close, everything is stopped and still-running fibers are held by ancestors.

**Rule of thumb from the docs:** if the lifetime is an event, use a Command; if you can say "while …", use a Subscription. Sources come from services or the clock, never captured globals.

---

## 3. `Mount.ts`

| Export | Sketch | Semantics |
| --- | --- | --- |
| `TypeId` / `DefinitionTypeId` | :60 / :78 | Brands. |
| `Options<In>` | `{ args }` (:103) | `args` is required. The log encodes it with redaction. **Its Schema equivalence decides whether a render changed the args.** |
| `Definition<Args,A,Node,R>` | `{ name, args }` (:120) | What tests name a mount by. `Definition.Any`. |
| `Factory` | callable `(…MakeArgs) => Issued` (:163) | Returned by `make` / `makeStream`. The function's `name` property is set. |
| `Issued<Msg,R,Node,Source>` | `{ name, args, argsSchema, stream, run, resolve, ~args, ~sameArgs }` (:188) | `Node` is contravariant: `onMount` accepts a mount whose `Node` the element's node is assignable to. `Source` is the pre-map result, used by story `mounted`. |
| `Any`, `Result<M>`, `Args<D>` | :267, :277, :289 | Utility types. |
| `isMount`, `isDefinition` | :340, :350 | Guards. |
| `make(name, {args}, (node, args, changes) => Effect<A, never, R>)` | :406 | Sends one result. Return `Component.noop` for nothing: no message, and the log records `MountEnded{silent:true}`. |
| `makeStream(name, {args}, (node, args, changes) => Stream<A, never, R>)` | :481 | Sends one result per element, through **the latest render's `map`**. Elements mapped to noop send nothing. The Stream runs in the mount Scope, so listeners added with `Stream.callback` are removed when the element goes. After the Stream ends, nothing more is sent. In a story, each `mounted` step sends one value. |
| `map(f)` | dual, :540 | Composes `resolve`, keeping name, args and the definition result type. **The runtime applies the map from the latest render** when a result arrives, so closed-over values are current. |
| `sameArgs(a, b)` | :575, `@internal` | Same name, and args that are `===` or equal by `Schema.toEquivalence(argsSchema)`. Shared by the runtime and Story. |

Gotchas:

- Args without a real Schema (callbacks, class instances) need `Schema.declare` or `Schema.Any`. They then compare by identity and show in the log as a placeholder.
- `onMount` of an `Effect<void>` body doesn't compile, with the hint `"onMount's mount ends with a message or Component.noop…"` (`View.ts:282`).

### Runtime (`internal/mountRun.ts`, `internal/mountArgs.ts`, `View.ts:1630–1690`)

**One mount per element**

- Calling `.onMount` twice on one builder **throws**: `onMount(X): this element already has the mount Y, and an element takes one` (`View.ts:1683`).

**Attach and start**

- `attach` runs only if `host.runsMounts === true`. The server and `TestHost` never run mounts or log them.
- Same element, same mount **name**: `update` swaps in the new issued mount, and new args are published to `changes` if `!sameArgs`. The body is not restarted.
- Different name: the old mount stops and the new one starts. A render with no mount stops the running one (`detach`).
- The start is scheduled **after commit** (`refs.afterCommit`) and waits for the instance's Layer.
- `MountStarted{name, args, argsSchema}` is logged.
- The fiber is forked **with `now=true`** (no `yieldNow`), so the body starts synchronously after commit.
- The context includes the mount's sequential Scope and `Refs`.

**Scope lifetime**

- The Scope is created per element-mount and closes only on stop: element removed, mount replaced, or tree closed.
- **A completed `make` body's Scope outlives the body.** Resources acquired with `acquireRelease` stay until the element goes. Releasing them later writes no log entry.

**`changes`**

- The Stream is created lazily on first pull and starts with the current args.
- It is **conflating**: a reader that falls behind keeps only the newest unread args.
- Several readers waiting are woken in the order they began to wait.
- On close, readers end newest first and unread args are dropped.
- Publishing new args writes no log entry. Mount-sourced `Update`s carry the args the element last rendered with.

**Results**

- `send` resolves through the latest mount's `resolve`. Noop results set `silent`. Nothing is sent after stop.
- The message source is `{_tag:"Mount", seq: <MountStarted seq>, name, args, argsSchema}`.

**End**

- `MountEnded{name, started, reason: "completed"|"closed"|"failed", silent}` is logged.
- A failure (non-interrupt) fails the instance `in: "mount"`.

---

## 4. `Feature.ts`

| Export | Sketch | Semantics |
| --- | --- | --- |
| `TypeId` | :60 | Brand; a static property on the class: `{name}`. |
| `Implementation<Props,Events>` | `{ component: Mountable, context: Context<never> }` (:85) | The Layer's build-site Context **minus `Scope`** closes the implementation's requirements. It isn't an instance, so Layer memoization is harmless: every child still gets its own instance, Model and Scope. |
| `Service<Self,Props,Events>` (interface) | (:97) | `props`, `events`, `render(h, opts)`, `toLayer(component)`. The log encodes a feature's props with the _contract_ `props` Schema, whatever the implementation. |
| `Any`, `isService(u)` | :142, :151 |  |
| `Service<Self>()(name, {props, events?})` | :198 | A `Context.Service` keyed `feature/${name}`. `events` defaults to `Schema.Never`. **`name` is the path segment of every instance**, so paths don't change when the implementation does. `toLayer(C)` doesn't compile if `C`'s props or events don't fit the contract. |
| `.render(h, {key?, props, onEmit, fallback, slots?: never})` |  | Builds a child record (`internal/child.ts#make`). **`fallback` is required** and receives `AsyncResult.Initial` (a Layer above is still building) or `AsyncResult.Failure` (a Layer above failed). A feature takes no slots. `render` works when detached from its class (falls back to the base class). |
| `.toLayer(component)` |  | `Layer.effect(Base, Effect.map(Effect.context<R>(), ctx => ({component, context: Context.omit(Scope)(ctx)})))`. The Layer requires the component's `R`, and the parent requires only `Self`. |

Runtime (`kernel.ts#mountChild` ~:1014, `#settle`; `devOn.ts:141`):

- If the owner's env has no context yet, the fallback renders, and the child is re-settled when the Layer finishes. On failure it gets `Failure(cause)`.
- In dev, a missing `fallback` at that moment throws: `"<path>: feature/X isn't available, because a Layer above it is still building or failed. Pass \`fallback\`."`
- When the context is ready, the implementation is looked up. If it's missing: **throws `"<path>: nothing provides feature/X"`**.
- The child's env is `Context.merge(ctx, impl.context)`.
- A throw inside the fallback fails the owner `in: "fallback"`.
- `Component.lazy` is the alternative for code splitting. A Feature whose Layer is built from `import()` also splits (LLMS.md:1075).

---

## 5. `html/HtmlCommand.ts`

Every helper wraps a `Command.make` factory: framework services only (`Renderer.Refs`, `Html.Host`), so they add nothing to `R`.

- **Timing:** the ref is resolved through `Refs.lookup` **after the commit of the render the issuing `update` caused**.
- **Scope:** lookup is within the issuing instance only. It searches the instance's rendered tree, including elements an owned part decorated.
- **Testing:** a test on `TestHost` fakes `Html.Host` with `Layer.succeed(Html.Host, …)`.
- **Story:** resolve with the exported factory, e.g. `.resolve(HtmlCommand.Focus, {found})`.

| Helper | Factory / name | Result | Notes |
| --- | --- | --- | --- |
| `focus(ref, f, options?)` :224 | `Focus` :81 `"HtmlCommand.focus"` | `Found{found}` | `FocusOptions{preventScroll?}`. Ref node type `HTMLElement \| SVGElement`. |
| `blur(ref, f)` :238 | `Blur` :101 | `Found` |  |
| `scrollIntoView(ref, f, options?)` :251 | `ScrollIntoView` :115 | `Found` | `ScrollOptions{behavior: auto\|instant\|smooth, block, inline: start\|center\|end\|nearest}`. |
| `measure(ref, f)` :269 | `Measure` :137 | `Option<Html.Rect>` | Rect `{x,y,width,height,top,right,bottom,left}` in CSS px relative to the viewport. `none` when the ref isn't rendered. |
| `select(ref, f)` :309 | `Select` :153 | `Found` | input/textarea only. Doesn't move focus. The browser host first writes the controlled `value` if the DOM shows something else (e.g. a rejected character), since writing it afterward would drop the selection. |
| `requestSubmit(ref, f)` :330 | `RequestSubmit` :181 | `Submitted{found, submitted}` | `ref` is a form, or a control belonging to one (by nesting or the `form` attribute). The browser validates unless `novalidate`, then fires `submit` to the form's handler. `submitted: false` when there's no form. |
| `showPicker(ref, f)` :405 | `ShowPicker` :355 | `Opened{found, opened}` | input/select. Calls `showPicker()`, or `click()` on a file input when unsupported. `opened: false` outside a user action or on a disabled element. **A Command issued from a click or keypress runs within that user action.** |

Host contract `Html.Host` (`Html.ts:134`): `focus, blur, scrollIntoView, measure, select, requestSubmit → boolean, showPicker → boolean`.

---

## 6. `html/HtmlSubscription.ts`

**Types**

- `DocumentEvents` (:44): `keydown/keyup → KeyPayload`; `mousedown/mouseup/click/pointerup/pointercancel → PointerPayload`. `pointerup` plus `pointercancel` together end every press, including touch-to-scroll, which sends no `mouseup`.
- `WindowEvents` (:67): `focus`, `blur`. These don't bubble, so you hear only the window's own focus changes.
- `GlobalPayload<P> = P & {defaultPrevented}` (:87). In the bubble phase it includes every element handler's `preventDefault`, because the host's listeners run on the document in capture. **In the capture phase it depends on listener order, so don't read it there.**
- `CustomEventPayload{detail: unknown}` (:97): `null` when the event has no detail.
- `GlobalEventOptions` (:111): `View.EventOptions` (`preventDefault?: boolean | "always"`) plus `capture?`.

**Services**

- `GlobalEvents` service (:138) / Reference (:158): `listen(target: "document"|"window", event, {capture, custom?}, listener(payload, preventDefault)) → remove`. **The default never fires.** `BrowserHost.layer` provides one over its document and `defaultView` (iframe-correct). Tests use `HtmlScene.fireDocument / fireCustomEvent / fireWindow` or `TestGlobalEvents`.
- `AnimationFrames` service (:474) / Reference (:486): `{ now(), listen(cb(timeMs)) → stop }`. **The default never fires** (`now` returns 0). The browser implementation uses `requestAnimationFrame` and `performance.now`.

**Constructors**

- **`onDocument(event, handler, options?)`** (:289):
  - The handler is a message or `payload => Msg | undefined`.
  - `preventDefault: true` cancels **only when the handler returns a message**; `"always"` cancels unconditionally, before the handler runs.
  - Key: `@effect/ui/html/document:"<event>"`, or `…:"<event>","capture"` for a capture listener.
  - **One listener per (target, event, phase) per instance.** A second one is a duplicate-key failure, so merge cases into one handler.
- **`shortcuts(table, options?)`** (:354): `onDocument("keydown", HtmlKeyboard.shortcuts(table))` with `preventDefault` **defaulting to `true`**. It uses the same key as `onDocument("keydown")`, so it can't coexist with one; combine via `HtmlKeyboard.shortcuts` inside `onDocument`.
- **`onWindow(event, handler, options?)`** (:394): key `@effect/ui/html/window:"focus"`.
- **`onCustomEvent(event, handler, options?)`** (:448): a document listener with `custom: true`. **It shares the key space with `onDocument`** (`@effect/ui/html/document:"<event>"`), so the same event name collides.
- **`onAnimationFrame(handler)`** (:551):
  - The handler is a message or `delta => Msg`.
  - Key `@effect/ui/html/animationFrame`, one per instance.
  - The first delta counts from Subscription start (`last = source.now()` at attach), so a pause/resume doesn't jump. The delta is clamped to ≥0.
  - A hidden tab gets no frames, so the first frame back covers the whole time away. Cap the delta in `update`.
  - Each frame's message is dispatched synchronously, so the update, the render and a Canvas repaint all land in the same frame.

**Runtime mechanics (all listeners)**

- They are `direct` Subscriptions, not Streams (`listenFor`, ~:165).
- The listener is attached synchronously at start. Each event goes through `enter`: dirty ancestors are rendered first, then **the handler from the latest `subscriptions` result** runs, so a handler may read the current Model. If the latest declaration removed the listener, nothing runs.
- `emit` dispatches synchronously inside the host callback. `preventDefault` is applied right before dispatch.
- A handler throw fails the instance `in: "subscription"`.
- Nothing listens on the server.

---

## 7. `html/HtmlKeyboard.ts`

**`Shortcut<Msg>`** (:30): `{ key, message, mod?, shift?, ctrl?, alt?, meta?, whileTyping?, repeat? }`.

**`shortcuts(table)`** (:103) is a pure handler, usable for `keydown` or `keyup`, on the document or on an element. A row matches when every rule holds:

1. Events with `composing`, or (on document payloads) `defaultPrevented`, are ignored → `undefined`.
2. `key` must be `===` (case-sensitive).
3. With `mod: true`: exactly one of ctrl/meta is pressed (XOR), and `mod` overrides `ctrl`/`meta`. Otherwise `ctrl` and `meta` must equal the row values, defaulting to `false`.
4. `alt` must equal the row value, default `false`.
5. `shift` is checked only when the row sets it, so `"?"` or `"G"` matches regardless of the layout's Shift.
6. While `payload.editable` is true, the row must have `whileTyping: true`.
7. While `payload.repeat` is true (auto-repeat), the row must have `repeat: true`.

Rows are checked in order and the first match wins. No match returns `undefined`, so `preventDefault: true` cancels only matched keys.

On elements, returning `undefined` doesn't fall through to an ancestor element's handler: the host stops at the innermost listening element. A document listener can still receive the event.

---

## 8. `html/HtmlFiles.ts`

- **`FileReadError{cause}`** (:66).
- **Readers** (:82, :101, :121): `readAsBytes(blob)`, `readAsText(blob, encoding = utf-8)` and `readAsDataUrl(blob)`.
  - They are built on `blob.stream()` (works in Node and workers), and **interrupting cancels the read**: `Command.interrupt`, a `switch` run or an unmount all stop the browser reading.
  - A data URL with an empty type uses `application/octet-stream`. Docs warn data URLs cost +33% everywhere, including the Model and the log; prefer `URL.createObjectURL`.
  - Read part of a large file with `blob.slice`.
- **`PickOptions{accept?: string[], multiple?, capture?: "user"|"environment"}`** (:142). **`Picked{opened, files}`** (:161).
- **`Files` service `{pick(options) → Effect<Picked>}`** (:183) / Reference (:194):
  - **The default never settles.**
  - The browser implementation creates a detached `<input type=file>` and calls `Html.Host.showPicker` (`opened: false` and no files if refused). It settles on `change` (the files) or `cancel` (no files).
  - A browser that doesn't report a dismissal leaves the pick pending.
  - Interrupting stops waiting, but the picker stays open.
- **`Pick`** (:226) is the Command `"HtmlFiles.pick"`. **`pick(f, options = {})`** (:275).
- Prefer a `label` for a file input for a visible "Choose file" control. Files from a rendered input arrive in `Html.InputPayload`. Type `File` args with `Schema.instanceOf(File)`.

---

## 9. `html/HtmlScheduler.ts`

- **`Options{budget?: Duration.Input}`**, default 5 ms (:20).
- **`make(options?)`** returns a `Scheduler` (:96). **`layer(options?)`** gives `Layer.succeed(Scheduler.Scheduler, make())` (:109). `makeDefault` is internal (:100). `BrowserHost.mount` uses one when the caller hasn't provided a Scheduler.

**Time slicing**

- One queue for all fibers.
- A task drains queued fiber work until the budget is spent. A running fiber yields when the deadline passes, or after `maxOpsBeforeYield` operations.
- Deadline checks use adaptive stride sampling of `performance.now`.
- Work queued during a task runs in the next task.
- A fiber resumed outside a task (for example by a `fetch`) uses what's left of the last budget, then starts its own budget, unless work is already waiting for a task, in which case it joins that work.

**Posting tasks:** `scheduler.postTask` where available (one pending post per lane), else `MessageChannel`, else `setTimeout(0)`.

**Priorities:** lower runs first; ties run FIFO. Effect queues everything at priority 0.

| Priority | Behavior                                     | `postTask` lane |
| -------- | -------------------------------------------- | --------------- |
| <0       | runs before other fiber work                 | `user-blocking` |
| 0        | runs in order                                | `user-visible`  |
| >0       | runs only when no other fiber work is queued | `background`    |

`Effect.yieldNowWith(p)` changes a fiber's priority. A fiber that yields because its budget ran out resumes at its queued priority. Fibers it forks or wakes start at 0.

**Gotchas:** one synchronous step can't be split, so move long work to a Worker. Background work can starve while foreground work keeps arriving.

**Related internals** (`executor.ts`, `fork.ts`):

- All runtime fibers (Commands, Subscriptions, Layer builds, mounts) fork through `CurrentExecutor.scheduler` when one is set. The render flush is queued with `executor.schedule` (a microtask by default).
- `TestExecutor` puts every fiber task and the flush in one priority+FIFO queue. It supports flush placement `"queued" | "first" | "last" | {seed}`, a seeded mulberry32 for randomized interleavings, and `drain(budget)`.
- `fork(…, now?)`: without `now`, it prepends `Effect.yieldNow`. Every forked fiber is tracked in `tree.owned`.

---

## 10. `html/HtmlImages.ts`

- **`ImageSource{src?, srcSet?, sizes?, crossOrigin?: "anonymous"|"use-credentials", referrerPolicy?}`** (:18).
- **`Images` service `{load(source) → Effect<"loaded"|"error">}`** (:42) / Reference (:53).
  - **The default never settles.** Interrupting drops the load.
  - The browser implementation uses a detached `<img>`. If it's already `complete`, it settles immediately with `naturalWidth > 0 ? "loaded" : "error"`.
  - No Command wrapper is exported; use `Images.use(...)` inside your own Command or Stream. Tests use `TestImages`.

---

## 11. `html/Canvas.ts` (brief)

- **Shapes:** Schema and non-validating constructor pairs for `Rect`, `Circle`, `Path` (with `PathCommand` `MoveTo|LineTo|QuadTo|BezierTo|Close`, plus `lineCap`/`lineJoin`), `Text` (`content`, `font`, `align`, …) and a nestable `Group` (:336). `Shape` union (:383), `Point`, `LineCap`, `LineJoin`, `TextAlign`, `TextBaseline`.
  - Union equivalence is overridden to compare by `_tag` first (`sameByTag`), for performance.
- **`paint(ctx2d, {width, height, shapes})`** (:540): clears, then paints in order. Works on any 2D context, including `OffscreenCanvas`.
- **`PointerEvent`** (`pointerdown|pointermove|pointerup`), **`Pointer`** (`PointerPayload` plus `event`, with x/y in scene coordinates), **`PixelRatio`** (`number | "auto"`).
- **`Paint`** (:631) is a `Mount.makeStream` named `"Canvas.Paint"`. Args: `{width, height, shapes, pixelRatio, listen}`.
  - It repaints only when the args differ by equivalence.
  - The backing store is size × ratio, with a scaled transform. `"auto"` reads `devicePixelRatio` at paint time.
  - Pointer coordinates are scaled to scene units.
  - When listening for move or up, a press calls `setPointerCapture`. `pointercancel` is reported as `pointerup`.
- **`view(h, {width, height, shapes, pixelRatio = 1, onPointerDown/Move/Up})`** (:786) returns the `h.canvas` builder.
  - It writes the `width` and `height` attrs. With a ratio ≠ 1 it also writes inline px width/height; a chained `.style` replaces them.
  - **It takes the element's one mount.**
  - Only events with a handler are listened to. A handler result of `undefined` maps to noop.
  - The server renders the canvas plus fallback children and draws nothing.

---

## 12. Cross-cutting internals that define observable behavior

- **`due.ts`:** `defer(tree, f)` puts work into the tree's idle `work` queue and wakes the tree. Used for navigation Commands in routed trees and for releasing a run after an `afterRefetch` wait.
- **`fork.ts`:** `follow(tree, late?)` runs callbacks inside the tree's causal tracking, which gives log `causedBy` and flush ordering. `servicesOf(env)` walks to the nearest ancestor env with a built context.
- **`closing.ts`:** `hold(inst, fibers)` registers still-running fibers on the instance and every ancestor, so closing waits for children's cleanup in order.
- **Log entries:** `CommandStarted` / `CommandEnded{silent, waitEnded?, outstanding?}` / `CommandInterrupted{reason}` / `CommandAwaiting{entries}` / `CommandDropped{reason:"server"}` / `SubscriptionStarted` / `SubscriptionStopped` / `MountStarted` / `MountEnded` (`MessageLog.ts:545–790`).
  - A run with an end entry but no `CommandStarted` never began: it was stopped while queued or while waiting for the Layer.
  - `causedBy` names the step that issued the run, freed its group, or ended the Layer build.

---

## Notable concepts not in LLMS.md

1. **`group`** option and group keys: canonical JSON of the encoded fields, JSON-encodable fields only, unknown fields throw at definition.
2. **Exact mode semantics:**
   - `switch` cuts running, queued **and awaiting** runs and starts only after the cut fibers' cleanup has exited.
   - `queue` isn't held by an awaiting run.
   - There is no "exhaust/ignore" mode, by design.
   - Stopping runs hold the group; switch/interrupt never re-interrupt a stopping run.
3. **`Command.interrupt(def, groupPick?)`** and **`h.isRunning(def, groupPick?)`** with a group argument. `isRunning` also counts queued, awaiting and stopping runs, and is view/parts-only.
4. **`Command.as`** (only `asNoop` is in LLMS.md) and the data-first vs pipeable union gotcha for `map`/`as`.
5. **`Command.afterRefetch(budget)`**: all of its semantics, plus `CommandAwaiting` and `CommandEnded.waitEnded/outstanding`.
6. **`optimistic`** patches applied at issue; **`writes`** (success → cache writes, not for Stream); `invalidates` applied on _every_ exit of a started run.
7. **`stream: true`** Command kind. Elements are delivered immediately and are not order-held. `match.onFailure` ends the Stream. Story steps `next` / `end`.
8. **`FrameworkServices`** module augmentation (`Scope`, `Refs`, `Cache`, `HtmlHost`) and the `FrameworkService` compile error for `make` bodies.
9. **Problems** `ServerCommandIssued` and `CleanupFailed`. `CommandDropped` on the server (init Commands dropped silently). The `"<path> is gone, and its Command failed"` logError.
10. **Ownership:** runs die with the issuing instance; issue long-lived saves from an ancestor. Command spans named after the Command, with `path` and `mode` attributes. A per-run Scope and Refs. Async start via `yieldNow`. Commands issued in array order.
11. **Interrupt reasons** `interrupt | switch | unmount | layer | self`, including runs dropped when a keyed provide reselects.
12. **`Command.Service` `make` body is evaluated eagerly at issue**, for `Command.make` (`work: run(args)`). Pure code outside the Effect runs in `update`.
13. **Subscription key encoding rules** (`keyOf`): colon doubling, JSON-quoted strings, the `-0`/`NaN` distinctions, single dep ≡ one-element tuple. **The `name` / `deps` fields.**
14. **An existing Subscription key is never restarted**, even when its stream changes. Only `latest` updates. An ended Stream stays stopped until its key leaves and returns. Removed keys stop before new keys start. Messages render dirty ancestors first. Falsy entries are filtered.
15. **`Subscription.direct`** (synchronous host attach with `emit/fail/enter`). `Router.prefetch` is allowed at most once in `subscriptions`. On the server, only the root's `onServer` hooks run.
16. **Mount runtime details:**
    - same name → args published, no restart; different name → restart;
    - the body starts synchronously after commit;
    - **a completed `make` body's Scope stays open until the element goes**;
    - `changes` is conflating, multi-reader, FIFO wake;
    - `MountEnded.reason` is `completed|closed|failed`;
    - `sameArgs` uses Schema equivalence;
    - `onMount` twice throws, and an `Effect<void>` body gets a dedicated type error.
17. **Feature runtime:**
    - `fallback` receives `AsyncResult.Initial | Failure`;
    - dev throws without one while a Layer is pending;
    - `"nothing provides feature/X"` throws;
    - the service key is `feature/${name}`, and `name` is the path segment;
    - the impl Context is merged minus `Scope`, and Layer memoization is harmless;
    - the log encodes props with the contract Schema;
    - `slots` are forbidden.
18. **HtmlCommand set:** `blur`, `scrollIntoView` (with options), `measure` (`Option<Rect>`), `select` (controlled-value write first), `requestSubmit` (`Submitted`), `showPicker` (`Opened`, file-input `click()` fallback). Exported factories `Focus`/`Blur`/… for story `resolve`. Refs resolve after commit within the issuing instance.
19. **`HtmlSubscription.onCustomEvent`**, which shares the document key space. **`GlobalEvents` / `AnimationFrames` service contracts** with never-firing defaults. **`defaultPrevented` is unreliable in capture.** `pointerup`/`pointercancel` in `DocumentEvents`. Handler throws fail the instance.
20. **`HtmlKeyboard` matching rules:** `mod` = ctrl XOR meta; `shift` checked only when set; `whileTyping`/`repeat` default false; `composing` and `defaultPrevented` ignored; first match wins; no fallthrough to ancestor elements.
21. **`HtmlFiles` readers** (`readAsBytes/Text/DataUrl`, cancel on interrupt, `FileReadError`), **`Files` service**, the `Pick` factory, and picker settlement and refusal rules.
22. **`HtmlScheduler`**: time slicing, budget, the priority and postTask lane mapping, the fallback chain, starvation gotchas. **`HtmlImages.Images`** loader. `TestExecutor` flush placement and seeded interleaving (internal).
23. **Canvas internals:** `PathCommand`, `TextAlign/Baseline`, `LineCap/Join`, pointer capture, `pointercancel` → `pointerup`, tag-first equivalence, inline sizing when `pixelRatio ≠ 1`.
