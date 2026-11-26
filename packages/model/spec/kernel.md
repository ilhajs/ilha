# `@ilha/model` kernel (wave 1): the runtime contract wave 2 builds on

The component runtime lives in `src/internal/kernel.ts`, driven through `Component.renderModelComponent`. One `IslandKernel` per Ilha `AtomRegistry` (one island); instance records outlive their Ilha fibers, keyed by path. Wave 2 (`provide`, shared state, keep-alive, slots, mounts, queries, parts) adds new files and fills the extension points listed below. It does not rework this kernel.

## Kernel and records

```ts
IslandKernel {
  registry, records: Map<path, InstanceRecord>, fibers: WeakMap<fiber, InstanceRecord>,
  writtenBy: WeakMap<vnode, InstanceRecord>,   // authorship stamps, first walk wins
  log, clock, recording, recordingLog,         // per-registry log (setLog)
  localStarted,
  globalLog, globalRecording, globalSeq, globalStarted,  // page-global log (MessageLog.attach)
  app, session,                                // log labels; app starts "island-N", first root renames it
  problems: Array<unknown>,                    // dev report: ServerCommandIssued, duplicate keys, ...
  warnedRedacted: Set<string>
}
```

```ts
InstanceRecord {
  kind: "record", kernel, definition, implementation, name, path,
  parent, author,                              // author wrote this instance's vnode (SPEC §4.1); usually parent
  fiber, props, callProps,                     // callProps: onEmit/onFailure/fallback/children the author wrote
  model: AtomHandle, signal: AtomHandle<number>,  // signal bumps on running-state/failure changes
  status: "live" | "failed" | "closed", failureCause,
  runs: Array<RunControl>, subs: Map<key, SubControl>,
  children: Set<path>,                         // last walk's child paths (close-diff)
  lastWalk: Array<{ name, key, path, author }>, // last walk's children with authors (mount resolution)
  env: Context.Context<never>,                 // Commands/Subscriptions resolve here (clientEnv; wave 2 provide fills)
  extensions: Map<string, unknown>,            // wave-2 slice state, keyed by slice ("keepAlive", "queries", ...)
  onClose: Array<() => void>                   // wave-2 close hooks (run on record close)
}
```

`kernelOf(registry)` creates on first use. `renderModelComponent` resolves the tree parent via `nearestRecord` (nearest fiber with a record), the instance key via `discoverKey` (search `parent.fiber.keyedHoles` for this fiber), and the path as `parent.path + segmentOf(name, key)` (`/Name`, `/Name[key]`, key escaped by `subscriptions.keyOf`). A record for a live path on a different fiber is closed first.

## Lifecycle

**Mount** (`mountRecord`): build the record (signal created eagerly so `init` failures can bump it); decode props (`Schema.decodeUnknownSync`, failure fails the instance with `in: "init"`); set `kernel.app` from the first root's name; run `init($, props)` where `$ = { props, set }` and `set` builds a branded step (`Component.initStepOf`, so `isStep` recognises it). A step with `model === undefined` fails the instance. Then: create the model atom (snapshot codec from `stateCodec.modelCodecOf` unless `isRedactedState`, which also warns once per component and forces `snapshot: false`); the signal atom (`snapshot: false`, never snapshotted); on the server return `renderViewAndWalk(rec)` immediately (no `Mounted` entry, no Commands, no subscriptions). On the client: `recordMounted` (returns the `seq` update Commands issue against), `issueCommands(..., "init")`, drop init emits when hydrated, then `renderViewAndWalk`.

**Rerender** (same fiber, record live): decode props, update `rec.props`/`rec.callProps`/`rec.author`; failed records render the fallback (walked and stamped, children diffed) instead of the view; otherwise `renderViewAndWalk`: run the view with the helper, walk and stamp, close children that disappeared (`child.parent === rec` only), `syncSubscriptions`.

**Dispatch** (`dispatch(rec, source, message)`): drops on non-live/closed fibers; loop guard (depth > 100 fails the instance); builds the update `$` (`makeUpdateApi`) — whole-message fn, per-tag record (unknown keys are a runtime failure: record the problem, fail the instance), or `Def.update` slices by brand. Applies under `startViewTransition` when types are queued and the host supports it: `rec.model.set(step.model)`, issue Commands with the update `seq`, route step events through the **author** (`routeEmit` over `author.callProps.onEmit`, per-tag record or function; `on<Event>` props are folded into `onEmit` by `readCallProps`, explicit `onEmit` wins per tag for records). Init events route the same way (skipped when hydrated, dropped on the server). Unmatched messages and handler throws fail the instance (`in: "update"`).

**Close** (`closeRecord(rec, reason)`): mark closed, delete from `records`/`fibers`, interrupt runs (`reason`: `"unmount"` on unmount/close diff, `"superseded"`/`"failure"`/... from the scheduler), stop subscriptions, run `onClose` hooks (each guarded), close tree children. Unmounting closes the scope: fibers exit, Layers release.

## Authorship (SPEC §4.1)

`walkAndStamp(rec, view)`: `checkChildPaths` walks the view (`paths.visit`, expanding elements/arrays/fragments/iterables and plain components, stopping at model components) calling `stamp(vnode)` on every model vnode — including ones nested inside another model's vnode-children (stamp-only: they mount under the tree parent, so they are not the walker's entries). First walk wins: the stamp keeps whoever wrote the vnode syntax, even when a forwarder renders it later through `h.children`. Duplicate sibling paths throw (the author fails with a key hint).

`authorOf(parent, name, key)` resolves a mounting child to the parent's last-walk entry, falling back to the parent. Emits, `scheduleOnFailure` messages and `onFailure` errors all route to `rec.author`, never the tree parent. `h.children` in the view helper exposes `rec.callProps.children`.

## Failure API

`failView(rec, where, cause, extra?)` (from render): mark failed, bump the signal, answer with the author's `fallback` (fallback throws are caught and recorded with `in: "fallback"`, answering `""`). `failOutside` (Commands, Subscriptions, scheduled work): mark, bump, the fiber rerenders the fallback. `markFailed` closes the scope and children, records `Failed` (`props`, `in`, `cause`, optional `name`/`issued`/`update`). A failing instance reports through `scheduleOnFailure` (microtask): the author's `onFailure` maps the `AsyncResult.Failure` to a message dispatched to the author; missing/throwing handlers are silent/guarded. `FailedIn` = `"init" | "update" | "view" | "fallback" | "command" | "subscription" | "server"` plus wave-2 `"mount" | "query" | "shared"`.

## Log-recording API

Entry drafts are built only when `kernelHasLog(kernel)` (per-registry recording live, or a page-global log attached — two cheap checks, zero cost otherwise). `recordEntry(rec, draft)` fans out to both sinks; `recordOnce` wraps each sink's **first** entry in `recording.session(...)`, so every log gets its own `SessionStarted` per root. The per-registry `seq` is returned (update callers issue Commands against it).

- `setLog(registry, log, clock?)`: rebuilds the per-registry recording (`internal/recorder.ts` via `messageLog.load`), resets `localStarted`.
- `MessageLog.attach(log) => detach` (`messageLog.attachGlobal`): the page-global sink. Kernels rebuild their global recording when the slot generation (`attachSeq`) changes, re-emitting `SessionStarted` on next record. Detach only clears its own log.
- Every entry is stamped by the recorder with `seq`, `at`, `session`, `path`, `instance` and `component` (`LoggedComponent`: `name`, `fullName`, `definition` with props/model/message/events Schemas).

## Commands and Subscriptions (wave-1 subset)

`issueCommands(rec, commands, seq, origin)`: on the server, `init` Commands are dropped silently (the client runs them on adopt) and `update` Commands are reported (`CommandDropped` + `ServerCommandIssued` problem); on the client, `Interrupt` runs through the scheduler (`schedule`), the rest start runs (`startRun`). `startRun` first checks `serviceTag`: a missing service fails the instance naming it (with a `clientOnly` hint for `Client`). Runs resolve `rec.env` with a forked scope; end/interrupt/stop record `CommandStarted/Ended/Interrupted` (silent ends for superseded queue drops). `isRunning` reads `rec.runs` (subscribes the signal, so the view rerenders).

`syncSubscriptions(rec)`: keys from `subscriptions(model, props)` state; falsy entries filtered; duplicate keys fail the instance (problem + `Failed`); removed keys stop (`SubscriptionStopped`); added keys start (`SubscriptionStarted`) — `direct` Subscriptions attach via `directAttach` (latest-state reads never rerun the view; `enter` reads latest without subscribing), the rest run fibers. Subscription emits dispatch with source `{_tag: "Subscription", key, name, deps}`; failures go to `failOutside` with the declaration name. Deps changes restart (wave-1 `keyOf`).

## Snapshot / SSR / hydration

Instance state snapshots through Ilha's snapshot mechanism keyed by path, encoded with `Schema.toCodecJson` (`stateCodec.modelCodecOf`); the signal atom never snapshots. Hydration adopts the state: `init` Commands and lists/sends run again, emits are dropped, redacted instances rebuild from `init` with a one-time warning. Unmount and SSR paths above.

## Wave-2 extension points (add files; don't rework the kernel)

- **provide/Env**: fill `rec.env` per instance (currently `clientEnv` only). `hasService`/`serviceName` stay.
- **keepAlive**: keep records in `kernel.records` past fiber close; key state in `rec.extensions`; re-mount reuses the record.
- **slots**: the walk already traverses plain wrappers; named-slot collection plugs into `visit`/`ChildCall` and `rec.extensions`.
- **mounts**: new `FailedIn` members, run through `issueCommands` order, stop on close; `Helper` gains `mount` (add to `buildHelper`).
- **queries**: per-instance bindings in `rec.extensions` + `rec.onClose`; `Mounted`/`Update` entries already carry `lists`/`sends` (empty); `QueryChanged`/`FetchStarted` reuse `recordEntry`.
- **shared state / parts**: owner lookup walks `parent`/`author` chains; readers subscribe like `isRunning` does (signal bump pattern).
- **Reads/queries/slots/keepAlive/mount in `Helper`**: extend `buildHelper` and `ViewExtras`; views stay `(h, model)`.
- **Known gaps wave 2 must close**: handler returns are `unknown` (the child cannot name the parent's `Msg`; the author's `update` validates at run time — see `CallOptions["~parent"]`); unmatched dispatched messages fail the instance but don't name the codec; `combine` across slices with different `Events` unions keeps the outer `Events`.
