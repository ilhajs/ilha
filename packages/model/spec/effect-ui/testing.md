# Effect UI: testing, MessageLog and DevTools inventory

## 0. Entry points

- `@effect/ui/testing` (`ui/src/testing/index.ts`) exports `Locator`, `Play`, `Scene`, `Steps`, `Story`, `TestHost`, `TestQuery`.
- `@effect/ui/html/testing` (`ui/src/html/testing/index.ts`) exports `HtmlLocator`, `HtmlPlay`, `HtmlScene`, `Ssr` (plus the bare `ssr` re-export), `TestAnimationFrames`, `TestFiles`, `TestGlobalEvents`, `TestImages`.
- `@effect/ui` exports `MessageLog` (`ui/src/MessageLog.ts`).
- `@effect/ui-devtools` exports `DevTools` and `Inspector`. `DevToolsHeadless` is a separate entry: `@effect/ui-devtools/DevToolsHeadless`.
- `@effect/ui-devtools/node` exports `DevToolsServer` and `DevToolsVite`. The bin `effect-ui-devtools` is `node/internal/bin.ts`.
- Everything is `@stability experimental`, `@since 0.1.0`.

### Test kinds (cross-cutting)

| Kind | Runs | How it drives | What it sees | Acknowledgement rule |
| --- | --- | --- | --- | --- |
| `Story` | `init`/`update` only, pure, synchronous | `send(msg)` | Model, `results`, `queries` | Full |
| `Scene` / `HtmlScene` | Pure; renders the view, never runs a child's `update` | Interactions through view handlers; no `send` | View: locators, `expect`, mounts | Full, plus mounts and `expectIgnored` |
| `Play` / `HtmlPlay` | Real runtime on `TestHost`, with real Layers and children | Interactions as Effects, each settling before and after | Tree, plus `root.model()`, `log()`… | Only `expectIgnored` carries over |
| `TestHost` raw | Real runtime | `root.send`, `Locator.fire`, `settle` | Everything, between settles | None |
| `ssr` | Server render, then hydrate in a fresh document | — | `SsrError` checks | — |

Cursor steps are synchronous for Story and Scene. Each step runs immediately, replaces the immutable `current` record and returns the cursor, so steps chain, and the cursor is `Pipeable`. Play steps are `Effect`s.

Failure stacks: a step error is rethrown with the stack of the call site (`callSite`/`atSite` in `ui/src/internal/steps.ts:~470-490`). The end check's stack points at the line that called `make`.

---

## 1. `testing/Steps.ts`: shared steps and data

The module docs at `Steps.ts:1-35` define the **acknowledgement rule**:

- **Message steps** are `subscription`, `layerFailed`, Story `send`, Scene interactions and child steps such as `childEmit`/`childFailure`, `collected`, and `shared` when it sends.
  - They throw while any of these is outstanding: a Command or load-more is pending, an enabled query has no result at its args, or a Scene mount isn't acknowledged.
  - **Exempt** (doesn't block): a Command with `mode: "switch"` or `"queue"`, any stream Command, and anything named by `keepPending`. Implemented as `exempt` at `internal/story.ts:1964`.
- **Every acting step** throws while an emitted event or a `$.send` isn't acknowledged (`emitted`/`sent`), or while an ignored interaction isn't acknowledged with `expectIgnored`. Acting steps are message steps, the settle steps (`resolve`, `fail`, `next`, `end`, `waitExpired`, `loaded*`, `loadFailed`, `loadMore*`), `props`, `given`, `childPending`, `givenChild` and `mounted`.
- **Pure assertions** don't trigger the checks: `emitted`, `sent`, `keepPending`, `check`, `expect*`, `expectMount`.
- **End check** (`make`'s scope closes with success) fails on any of these:
  - anything pending, including kept or exempt work, and any load-more;
  - an unloaded query unless `keepPending` named it;
  - an unacknowledged mount;
  - an unacknowledged event, send or ignored interaction.

  It is skipped when the scope closes with a failure. `start()` cursors get the pre-step checks only, never the end check.

- **`given` after any acting step** throws rather than discard pending work, unacknowledged outputs or mounts, or an unloaded query entry the new Model would disable. See `checkGiven` and `checkGivenQueries` at `internal/story.ts:2155-2200`.
- Error format: `"<Module>.<step>: earlier work isn't settled or acknowledged:\n  - …"`. Each item carries a hint, for example `settle it with resolve or fail, or keep it with keepPending` (`internal/story.ts:2035-2152`).

### Types

| Name | Shape | Semantics | Ref |
| --- | --- | --- | --- |
| `Pending<Msg>` | `{command, status: "running"\|"queued"\|"awaiting", message?, awaiting?: AwaitedQuery[]}` | A Command issued and not yet delivered. `queued` waits behind its group under `queue`; `awaiting` has a result but waits for `afterRefetch` queries or an earlier queued message. | Steps.ts:58 |
| `AwaitedQuery` | `{name, args}` | A query an `afterRefetch` run waits on. A `queryMany` has one per key. | :78 |
| `Record<P,M,Msg,E>` | `component, props, pending, emitted, sent, interrupted, loadingMore, subscriptions(), queryInfo(), reports` | The base record. `sent` holds unacknowledged `$.send`s (nothing receives them in a test). `interrupted` holds runs cut by `switch` or `interrupt`; it needs no acknowledgement, and an awaiting cut run delivers its message instead. `subscriptions()` throws on duplicate keys and excludes query watches. `reports` is what the component reports to each owner it `reads` with `report`. | :92 |
| `QueryInfo` | `{name, query, args}` | `args` is `undefined` when the query is disabled; a `queryMany` gives its unique args. | :150 |
| `Given<C>` | Per query: a Success value, an infinite query's pages, or keyed entries | What `given`'s second argument takes. | :167 |
| `KeyedLoad<R>` | `{args, value, waiting?, patched?}` \| `{args, error, waiting?}` | One `queryMany` key. | :186 |
| `Target` | `Command.Definition.Any` \| issued Command | A definition matches by name; an issued Command also matches args with `Equal.equals`. | :207 |
| `StreamTarget` | A stream definition or issued stream | Used by `next` and `end`. | :220 |
| `Steps<C>`, `Steps.Any` | — | The shared cursor. Write helpers as `<S extends Steps.Steps.Any>(s:S)=>S`. | :275, :561 |

### Shared steps on `Steps<C>`

| Step | Kind | Semantics | Ref |
| --- | --- | --- | --- |
| `subscription(key, msg)` | message | Delivers a message from an active Subscription key. Throws for inactive keys or query-watch keys, listing the active keys. The message isn't checked against the stream. | :282 |
| `layerFailed(failure)` | message | Delivers what `Component.provide`'s `onFailure` maps the failure to; does nothing without one. | :288 |
| getters `current`, `pending`, `interrupted`, `loadingMore`, `subscriptions`, `queryInfo` | — | Read from the current record. | :290-312 |
| `given(model\|fn, queries?, shared?)` | special | Before any acting step it replaces `init`'s output and drops `init`'s Commands, events and sends. It never runs `update`. Keyed queries drop stored keys they no longer return, with no `onChange`. `queries` writes loaded results at the args the new Model returns, order-independent, rendering once; it throws if a named query is disabled or keyed args aren't current. `shared` is `[[Owner, value], …]` and sends no `onChange`. | :341 |
| `shared(owner, value)` | message if it changes a value | Sets the value an owner shares; keyed by the owner, so it reaches headless children too. If the value differs from the previous one or the default, every `onChange` in `reads` fires. The first value of an **optional** owner sends nothing. The owner's `update` never runs; sends to it must be acknowledged with `sent`. A send to an optional owner with no value is dropped. Without a value, a required read uses `shares(init(props).model, props)` when all the owner's props are optional; otherwise rendering a Scene throws, naming this step. | :381 |
| `props(next\|fn)` | acting | Never reaches `update`; it changes the view, query args and subscription keys. | :389 |
| `resolve(target, result)` | acting | Takes the oldest **running** match. `result` is the definition's raw result, before `Command.map`, and the mapping is replayed. A queued run of the group then starts. An `afterRefetch` run becomes `awaiting` on its matching own queries, minus those its `writes` store, or delivers at once when none match. | :413 |
| `fail(target, error)` | acting | Sends the message `Command.match` maps the typed failure to. A stream ends. Throws if the body can't fail (`no typed failure mapped by Command.match`). Doesn't wait for refetches. | :420 |
| `next(target, result)` | acting | Sends one element of a running stream Command, which stays pending. | :422 |
| `end(target)` | acting | Ends a running stream, sending nothing. | :424 |
| `waitExpired(target)` | acting | Ends an `afterRefetch` wait by budget and delivers its message. Throws if nothing matching is waiting. | :430 |
| `loaded(name, value, {waiting?, patched?})` / `loaded(name, args, value, opts)` for keyed | acting | Writes a Success at the current args, then sends `onChange`. Throws if the query is disabled. For an infinite query, `value` is the page array and it settles a pending load-more unless `waiting`. Unless `waiting` or `patched` it is a settle: it ends an `afterRefetch` wait. It throws while a running or queued Command's patch is live on the query; then only a `patched` write is allowed. A patch is live only if the result held a Success when the Command was issued. | :446, :458 |
| `loadFailed(name, error, {waiting?})` / keyed form | acting | Writes a typed failure and keeps `previousSuccess` if one exists at the current args. Settles a load-more unless `waiting`. | :473, :479 |
| `loadedMore(name, page)` | acting | Appends a page. Throws when no load-more is pending. | :490 |
| `loadMoreFailed(name, error)` | acting | Pages stay; `more` becomes `Failed`. | :499 |
| `loadedMany(name, entries)` | acting | One batched keyed write. The result holds the stored keys plus these, and `onChange`'s `changes` holds these. Throws on args the query doesn't currently return. | :509 |
| `emitted(...events)` | assert/ack | Acknowledges the oldest N events after checking them in order with the `events` Schema equivalence. Needs at least one. | :519 |
| `sent(owner, message)` | assert/ack | Acknowledges the oldest send, which must go to the nearest `owner` with `message` (compared with the owner's `receives` equivalence). | :527 |
| `keepPending(target\|queryName)` | ack | Stops matched Commands, a query's unloaded entries or its load-more from blocking message steps. A query mark ends when its args change. Kept Commands and load-mores still fail the end check; kept queries pass it. Throws if nothing pending matches. The mark carries over when a queued run starts. | :543 |
| `check(f)` | assert | `f(current)` throws to fail. | :545 |
| `expectExact(...targets)` | assert | Exactly these pending Commands, in order. | :548 |
| `expectHas(target)` | assert | — | :550 |
| `expectNone()` | assert | — | :552 |

Engine details from `internal/story.ts`:

- `apply` (:1372) puts Commands through the same `schedule` as the runtime. Under switch/interrupt, a cut **awaiting** run delivers its message inside the same `update`, before the new Command is added. A cut run leaves at once because there is no fiber cleanup, and the next queued run starts.
- `h.isRunning(name, groupKey)` in a Story or Scene is derived from `pending` (:1340).
- `pruneKeyed` (:1310): after a step, keyed results holding keys no longer returned are pruned. The step throws after 100 rounds if `onChange` keeps changing the key set.

---

## 2. `testing/Story.ts`

| Export | Signature | Semantics | Ref |
| --- | --- | --- | --- |
| re-exported types | `AwaitedQuery, KeyedLoad, Pending, QueryInfo, StreamTarget, Target` | Aliases of the `Steps` types. | :70 |
| `Story<P,M,Msg,E,Q>` | extends `Record`, adds `model`, `results` (opaque), `queries()` | The record. | :129 |
| `Steps<C>` | extends `Steps.Steps<C>`, adds `send(msg\|model=>msg)`, `model`, `results`, `queries` | `send` is a message step. An `undefined` message or `Component.noop` is a no-op. A defect in `init` or `update` throws on the calling line. | :195, :213 |
| `make(component, props)` | `Effect<Steps<C>, never, Scope>` | Scoped, with the end check. | :296 |
| `start(component, props)` | `Steps<C>` | No end check. | :319 |
| `parts(headless, {model?, props} \| record)` | `Parts` | The plain parts a consumer's closure reads. Given a Scene record it uses the scene's `shared` values and `givenChild` Models; given `p.child` it uses the child's `init` Model. | :346 |
| `head(component, model, props?)` / `head(record)` | `HeadEntry[]` | One instance's `head` option output. With a component, every query is empty. Throws if the record isn't from a Story or Scene. | :396 |
| `Divergence<M,Msg,E>` | `{seq, message, recorded: Outcome, recomputed: Outcome}` | — | :439 |
| `Outcome<M,E>` | `{model, events, commands: Wire-encoded, lists: ListIssue[], sends: Wire-encoded}` | — | :453 |
| `Replay<…>` | `{path, model, props, results, queries(), replayed, divergence}` | On divergence, the state is the Model **before** the diverging message. | :473 |
| `fromLog(component, entries: Entry[]\|Wire[], {path?})` | `Replay` | See the rules below. | :523 |

`fromLog` rules (`internal/replay.ts:125-477`):

- It starts at the first `Mounted` or `Update` for the path (the first logged instance of that component name unless `path` is given) and takes its Model, props and query results.
- It replays each later `Update` with the recorded props, `queries` and `shared`. `PropsChanged` sets props and `QueryChanged` writes a result, so the final state includes them.
- Each instance number is tracked separately. A second `Mounted` at the same path starts over, and the result is the last instance's state.
- Comparisons: Model and events by `Schema.toEquivalence`; commands, lists and sends by the JSON of their Wire encoding. Commands are never run.
- It accepts live entries or Wire frames. Wire values are decoded through the component Schemas. Errors start with `Story.fromLog:`:
  - `the log has no entry for <Component>`
  - `entry #N (path) has a <field> that can't be decoded, because it was logged as a ~truncated placeholder`
  - `writes "x", which isn't a query`
- It also tracks `LayerPending`/`LayerReady`/`LayerFailed` by `boundary`, plus the open runs, for the internal `viewOf` (rendering the replayed view with fallbacks and `isRunning`; not public).

---

## 3. `testing/Scene.ts`

The module docs (:1-60) say: a scene is pure; it has no `send` and no Model access. Interactions reach `update` only through view handlers. A child is a leaf, named by component, then by key. Anything that crosses into a child belongs in a Play.

| Export | Semantics | Ref |
| --- | --- | --- |
| `MountTarget = Mount.Definition.Any \| Mount.Any` | A definition matches by name; an issued mount also matches args by the args Schema equivalence. | :87 |
| `MountedResult<D>` | `[]` for a noop mount, else `[result]`. | :97 |
| `Scene<P,M,Msg,E>` record | Adds `defaultPrevented`, `view()`, `root: Locator.Node`, `get`, `query`, `all`. `defaultPrevented` is true when a handler had `preventDefault:true` and produced a message, or had `"always"`, or the event is `submit`. Any other step resets it to false. The view is rendered after keyed prunes, so a `view` defect fails the step. | :114 |
| `Expect<S>` | `toExist()`, `toBeAbsent()`, `toHaveText(str\|RegExp)` (exactly one match; whitespace collapsed and trimmed), `toHaveCount(n)`. A failure lists the view's elements. | :150 |
| `Steps<C, Parts, Report>` | See the table below. | :190 |
| `make(c, props)` / `make(c, props, {elements?, slots: h=>({slot: content})})` / `make(headless, props, {elements?, view: (parts,h)=>content})` | Slot content appears at runtime paths such as `/Panel/[body]/Editor[e]`. In a headless scene every handler comes from parts; an event runs every part layer on its element in the runtime's order, and each layer's `preventDefault` applies to its own message. End check adds unacknowledged mounts and ignored interactions. | :432 |
| `start(…)` | No end check. | :511 |
| `children(view, component?\|{key})` | The children declared in a view. | :535 |
| `fallback(view, child, [key], AsyncResult.Initial\|Failure)` | The child's `fallback` output, or `undefined`. Throws on the runtime's path conflicts (two children at one path, or a child at another child's path). | :553 |

Scene steps (in addition to the shared steps):

| Step | Kind | Semantics | Ref |
| --- | --- | --- | --- |
| `defaultPrevented`, `view`, `root`, `get`, `query`, `all` | getters | — | :190-215 |
| `collected(reports)` | message when it sends | Headless scene only. Runs the owner's `shares.collects.onChange` and sends when the result differs from the last one (the starting point is its message for no reports). Throws when there is no `collects`. | :221 |
| `click(target)` | interaction | A string means `Locator.text`. The innermost element with a `click` handler, the target or an ancestor, gets it. The payload is `{button:0,x:0,y:0,shift/ctrl/alt/meta:false,pointerType:"mouse"}`. Throws if nothing matches, several match, or nothing handles it. | :230 |
| `fire(locator, event, payload={})` | interaction | Same lookup for any event. `submit` must be handled. | :238 |
| `childEmit(child, [key], event)` | message | Sends the parent's `onEmit(event)`. `child` can be a component, provided copy, lazy component or feature service. Throws for none or several matches. Throws if the child is declared with `p.child` by another instance ("A scene doesn't run a child's update"). | :250/:264 |
| `childFailure(child, [key], cause)` | message | The slot shows its fallback's failure branch, and the parent's `onFailure(AsyncResult.failure(cause))` message is sent. | :282/:294 |
| `childPending(child, [key])` | acting | The slot shows its fallback with `AsyncResult.initial(true)` until a `childFailure`. Throws without a `fallback`. | :314/:324 |
| `givenChild(headless, [key], model)` | acting | The Model a headless child expands from, keyed by path. The child's `update` never runs. | :343/:347 |
| `mounted(target, ...result)` | acting | Ends the one matching mount and sends the view's `Mount.map` message. A mount ends once, except `Mount.makeStream`, which takes one value per step. Only the scene's own mounts count: its elements', slot content it passes, and parts it owns. Throws for none or several matches, listing the mounts. | :367 |
| `expectMount(mount)` | ack | Exactly one mount with this definition and the last-rendered args equal; acknowledges it as running. | :373 |
| `expect(locator)` | assert | — | :376 |
| `expectHandled()` | assert | Optional. | :378 |
| `expectIgnored()` | ack | Required after an ignored interaction; throws after any other step. | :383 |
| `expectDefaultPrevented(expected=true)` | assert | — | :385 |
| `parts(f)` | assert | Headless only. | :391 |

Mount tracking (`internal/scene.ts:197-375`):

- After every step the mounts are followed through the runtime's sibling matching (`match.matchSiblings`/`patches`).
- A **new mount is in-flight work**: it blocks the next message step and the end check until `mounted` or `expectMount` names it.
- A step that **removes an unacknowledged mount throws**: "the step removed a mount nothing acknowledged".

---

## 4. `testing/Play.ts` (internal `internal/play.ts`)

- `StepError = TestHost.SettleError | RootCrashed | TestQuery.ProblemsError` (:84). `Expect = Scene.Expect<Effect<void, StepError>>` (:98).
- `Play<Model,Msg,Events>` (:118) has:
  - `root: TestRoot`;
  - `click(target)` (mouse-primary payload);
  - `fire(locator, event, payload={})`;
  - `expect(locator)`, which settles and then checks;
  - `expectIgnored()`, which fails when the last interaction produced a message or none has run.
- `make(component, props | Effect<props>)` (:167):
  - Requires `TestHost`, `Scope` and the component's `R`; mounts and settles.
  - The end check, on scope success, settles once more (crash or problem fails the test) and fails on an ignored interaction nobody acknowledged.
  - Work still asleep on the clock or waiting outside the app doesn't fail it; read `root.pending()`.
- Semantics:
  - Each step settles before it acts, so it picks up `TestClock.adjust`, navigation or `setOnline`, and settles after.
  - Lookup failures and "nothing handles" throw as defects with the call-site stack.
  - Commands, events and sends need no acknowledgement.
  - In base Play, events bubble to the nearest ancestor handler. HtmlPlay doesn't bubble the "own" events (focus, blur and the other non-bubbling ones).

---

## 5. `testing/TestHost.ts`

| Export | Semantics | Ref |
| --- | --- | --- |
| `TestElement` | `tag, attrs, props, children, parent, handlers, eventOptions, owners, dispatch, fire`. `owners` lists, per event a headless part handles, the instance paths deepest first. To act as a user editing a controlled property, set `props` directly, then fire. No default actions. | :94 |
| `TestText`, `TestNode` | — | :120, :134 |
| `makeHost()` | Renderer host with `operations()` (strings such as `create <div>`, `attr <x> a=…`, `prop`, `insert`, `remove`, `text`, `head`), `clearOperations`, `commits()`, `onCommit(listener)`. `runsMounts:false`. Controlled props are `value/checked/selected/open`; no-op prop sets are skipped. | :234 |
| `TestHost` service | `host, log: MessageLog.Memory, drain(budget), busy(), pending(), budget, register(tree), visibility/connectivity (settable signals), problems(), report, expectProblem(tag), drainingClock, trees()` | :341, :466 |
| `Tree` | `{pending(), crashed(), path}` | :381 |
| `Pending` = `PendingCommand{_tag:"Command",path,name,status}` \| `PendingFetch{_tag:"Fetch",path,query,logKey,status:"running"\|"held",trigger}` \| `PendingLoad{_tag:"Load",path,name}` | Command status is `running`, `queued`, `awaiting` or `stopping` (interrupted, fiber not yet exited). | :395-445 |
| `DrainExhausted` | A problem reported when a clock-woken drain runs out of budget; the next `settle` fails on it. | :455 |
| `Flush = "queued"\|"first"\|"last"\|{seed}` | When the render flush runs among scheduler tasks. `{seed}` makes a randomised placement reproducible, for finding order-dependent behaviour. | :490 |
| `layer({budget=100_000, logSize=∞, flush})` | Provides `TestHost`, `Renderer`, the test executor (`CurrentExecutor`) and `MessageLog.memory`. `flush` defaults to config `EFFECT_UI_TEST_FLUSH` (`queued`/`first`/`last`/integer seed), then `"queued"`. Visibility and connectivity start true. Unconsumed problems kill the Layer scope with `ProblemsError`. | :526 |
| `Root<M,Msg,E>` | `path, session, model() (undefined after a crash), send(msg)` (logs as a `Dispatch` source), `emitted, log() (this session), pending(), fetches() (FetchStarted entries), entry(query,args) (inspect without creating or retaining), head<H>(), frames()` | :654 |
| `TestRoot` | Adds `container, text(), all, query, get`. | :695 |
| `mount(c, props\|Effect, {fallback?, query?, frames?})` | The first render is immediate; Commands, Subscriptions, fetches and Layers wait for settle. It forces the host's Visibility, Connectivity and Problems even if overridden nearer. Its Clock drains the scheduler when a sleeper wakes, so `TestClock.adjust` runs woken work. `frames` projects each commit, defaulting to `text()`, with consecutive repeats dropped. | :731 |
| `register` | `@internal` | :817 |
| `RootCrashed{path,cause}` | — | :869 |
| `SettleError{message,pending,log}` | The message includes the last 20 log entries and the pending list. | :885 |
| `settle` | Drains until idle. A fiber blocked on a Queue or TestClock counts as idle. Promise work gets about 3 quiet macrotasks; lazy loads are awaited. Then fails with `RootCrashed` or `ProblemsError`. | :919 |
| `setVisible(b)`, `setOnline(b)` | false→true refetches watched entries that are stale or due. | :992, :1006 |
| `problems`, `expectProblem(tag)` | `expectProblem` dies when no problem has that tag. | :1018, :1038 |
| `formatLog(entries)` | One entry per line. | :1067 |
| `formatTimeline(entries)` | Facts (no `causedBy`) with their consequences indented; an orphan shows `(after #n)`. Line format, e.g. `#7 /Parent Update Inc (dispatch) -> Cmd events … sends …`. | :1105 |
| `Stub<Self,P,E>` / `stub(feature)` | Renders `<stub data-stub=name>`, records the distinct props in order, `emit(events)` makes every mounted stub emit (settle first), and `layer` provides it. | :1227, :1245 |

## 6. `testing/TestQuery.ts`

- `Fetch {query, logKey (Redacted args redacted), trigger, restart, stored, page?, cursor?}` (:66). A caller joining an in-flight fetch records nothing. `stored:false` marks a get-only fetcher call.
- `Entry<A,E> {stored, view (with patches), patched, stale, watchers, fetch: "none"|"running"|"held", trigger, patches:{live,held}, more?}` (:94).
- `ProblemsError{problems}` (:114).
- Service `TestQuery {setVisible, setOnline, fetches(), entry(), problems(), expectProblem()}` (:133, :162).
- `layer({idleTimeToLive?})` (:186) wraps `Query.layer`; problems go to a collector, and unconsumed ones become a defect at scope close.
- Effect accessors: `setVisible`, `setOnline`, `fetches`, `entry`, `problems`, `expectProblem` (:269-348).

## 7. `testing/Locator.ts`

- `Node {tag?, attrs?, props?, text?, children?}` (:45). This is a structural tree, so the same locators run on Scene views and TestHost trees.
- `Locator {description, all(root)}` (:60).
- Text helpers: `textOf` (:72) and `elements` (:84, document order, root included). Tagless nodes are seen through.
- Locators:
  - `text(s, {exact?})` (:119): the **innermost** elements containing the text (exact means trimmed equality).
  - `attr(name, value?)` (:143).
  - `testId(id)`, i.e. `data-testid` (:161).
  - `tag` (:170).
  - `inside(container, locator)` (:180).
- Lookups: `all` (:198); `query` (:210) throws on several matches; `get` (:230) throws on none or several.
- `Firable` (:245). `fire(node, event, payload={})` (:263): the innermost handler, at the node or an ancestor, gets it.

## 8. `html/testing/HtmlLocator.ts`

- It runs over structural trees, TestHost trees **and the real DOM**.
- **Hidden elements are excluded** unless `hidden:true`: `hidden`, `aria-hidden="true"`, `input[type=hidden]`, `template`, a closed `dialog`, or a popover that isn't open.
- Implicit roles cover a large tag table plus:
  - input types: button, checkbox, radio, slider, spinbutton, searchbox, combobox (with `list`), textbox;
  - `select` is listbox or combobox; `header`/`footer` are banner/contentinfo outside sectioning content; `section` is region only when named; `th` is row- or columnheader; `img alt=""` is presentation; `a`/`area` with `href` is link.
- Accessible name order: `aria-labelledby` → `aria-label` → labels → `alt` → `legend`/`caption` → content (for name-from-content roles) → `title` → `placeholder`.

| Export | Ref |
| --- | --- |
| `RoleOptions {name?: string\|RegExp, checked?, level?, hidden?}` | :547 |
| `queryAllByRole(root, role, opts)`, `getByRole` (throws, listing roles and names), `roleOf(root,node)`, `nameOf(root,node)` | :611, :633, :672, :688 |
| `role(role, opts)`: a Locator | :705 |
| `label(text, {exact?=true})`: fields by `<label for>`, a wrapping label, `aria-labelledby` or `aria-label` | :741 |
| `placeholder(text)` | :803 |
| `dialogState(node)`: `"closed"\|"open"\|"modal"` (`.modal(true)` sets `open="modal"`) | :826 |
| `value(node)`: the prop, else the attribute | :867 |
| `checked(node)`: `aria-checked`, else the prop, else the attribute | :900 |
| `popoverState(node)` | :922 |
| DOM actions: `click(el)`, `type(el, v)` (fires InputEvent `input` then `change`), `keydown(el, key, {shift,ctrl,alt,meta})` (keydown then keyup), `submit(el)` (`requestSubmit`) | :933-1001 |

## 9. `html/testing/HtmlScene.ts`

`Expect<S>` extends the Scene `Expect` with `toHaveValue`, `toBeChecked(b=true)`, `toBeDisabled(b=true)` and `toHaveAccessibleName(str|RegExp)`, each requiring exactly one match (:98-106).

`Steps` extends `Scene.Steps`; every step is an interaction:

| Step | Semantics | Ref |
| --- | --- | --- |
| `click(target)` | Sends `pointerdown`, `mousedown`, `mouseup`, `click`, then the browser defaults. Cancelling `pointerdown` skips `mousedown`/`mouseup` but not `click`; only a cancelled `click` skips the defaults; only `click` and its defaults set `defaultPrevented`. A disabled `button/input/select/textarea`, or one in a disabled `fieldset`, **throws**. If the press removes or disables the element, the rest isn't sent. A submit button submits its form with the view's fields (its own name and value included). A checkbox fires `input`+`change` with `checked` flipped; an unchecked radio fires with `checked:true`. A `popovertarget` button fires `toggle` per `popovertargetaction`. The whole click is one interaction. | :159 |
| `type(loc, value, {composing?, inputType?})` | `input` with value. An input also sends its current `checked`. Defaults: `composing:false`, `inputType:"insertText"`. | :167 |
| `change(loc, string \| Partial<InputPayload>)` | Includes `files` for file inputs. Defaults: `composing:false`, `inputType:""`. | :175 |
| `compositionEnd(loc, value?)` | Defaults to the current value. | :183 |
| `keydown(loc, key, details)` | Modifiers, `composing`, `repeat` and selection default to false or null; `editable` is derived from the element. | :189 |
| `submit(loc)` | Enter-style submit of the form; no submitter. | :195 |
| `focus` (`focusVisible:true`), `blur` | — | :197, :199 |
| `drop(loc, payload?)` | Goes to the innermost `dropTarget` (any layer's) accepting the drag types (case-insensitive; `"Files"` is added when there are files). The default is always prevented. Throws if no target accepts. | :213 |
| `fireElement(binding, loc, event, detail)` | A custom-element event, decoded by its Schema. Ignored if the handler returns `undefined`. | :226 |
| `fireDocument(event, payload)`, `fireWindow`, `fireCustomEvent(event, {detail=null})` | Runs `HtmlSubscription.onDocument/onWindow/onCustomEvent` listeners: capture, then bubble. Each phase re-reads the current `subscriptions`, so a listener added by the capture message runs and a removed one doesn't. Per-listener `preventDefault`; bubble listeners see capture's `defaultPrevented`. Throws if nothing listens, listing the keys. | :253, :263, :274 |
| `frame(delta=16)` | Runs `onAnimationFrame`. Throws if nothing listens; ignored if it returns `undefined`. | :289 |
| `make`, `start` | Same overloads as Scene. | :628, :674 |

## 10. `html/testing/HtmlPlay.ts`

`HtmlPlay` extends `Play` with the same-named HtmlScene steps as Effects (:118-208): `click`, `type`, `change`, `keydown(loc|"document", key, details)`, `submit`, `focus`, `blur`, `drop`, `fireElement` and `expect` with the field matchers.

Differences from HtmlScene:

- `type`, `change` and checkbox/radio clicks **write the DOM prop first** (and uncheck the rest of the radio group), so uncontrolled fields keep the input. A controlled field reverts to the view's value after settle unless the Model took the edit.
- `popovertarget` toggles `popoverOpen`.
- `click` settles between press and release; release events run with no render between them, so a submit reads the fields as they were before the click's own message.
- Non-bubbling events go to the matched element only.
- `keydown("document", …)` dispatches on the shared `TestGlobalEvents` if provided (reaching every root on it), else on its own fake. It fails if no listener exists, but only the `TestGlobalEvents.make` fake can report missing listeners.
- Custom-element controlled props are written as plain values.

`make` is at :491.

## 11. `html/testing/Ssr.ts`: `ssr(component, props, {budget="500 millis", static?, query?, logSize?, frames?})` (:325)

- It requires a `TestClock` and dies otherwise ("run it under it.effect").
- **Server phase:** steps the clock to each wake until idle or the budget is spent.
- **Client phase:** the clock is set to start+budget. While instances wait for their Layer, it steps the clock for up to the budget more, then fails naming the waiting paths.
- Result `Ssr` (:99): `html, state (after serializeState→JSON.parse), model, head, document, container, root: TestHost.Root, adopted: paths, log, serverLog, commands [{path,name,index}] (init Commands run by adopted instances), misses [{query,logKey}]`.
- `SsrError{problems: string[]}` (:126) fails when:
  - an instance's Model isn't adopted, or differs after re-encoding (this catches props drift);
  - a node outside a deferred instance is rebuilt instead of adopted, or a marker is left behind;
  - the server's and client's merged heads differ (JSON-LD compared canonically, `class` as a set, `data-*` per name);
  - the head sync warns;
  - a shipped query entry doesn't round-trip;
  - a hydrated entry is fetched inside the fetch-free window (skipped with `static`; caller-only fetches allowed);
  - an instance is still waiting for its Layer at the budget;
  - any problem is reported on either side, **including `Command.ServerCommandIssued`** (use `Renderer.prerender` to test that).

## 12. Fake Layers in `html/testing`

| Module | API | Semantics |
| --- | --- | --- |
| `TestGlobalEvents` | `Targets {document, window}`, service `{fire(target, event, payload)→cancelled, fireCustomEvent(event, payload)→cancelled}`, `make()`, `layer` (also provides `HtmlSubscription.GlobalEvents`), Effects `fire`, `fireCustomEvent` | Capture listeners, then bubble, in insertion order; snapshotted per phase, skipping any an earlier message removed. Defaults as in `fireDocument`. Run `TestHost.settle` afterwards. (:63-202) |
| `TestAnimationFrames` | Service `{fire(delta=16)}`, `make()` (clock at 0, also `now`/`listen`), `layer`, Effect `fire` | Advances the fake clock, then calls every listener. (:57-137) |
| `TestFiles` | Service `{pending(): PickOptions[], settle(picked)}`, `make`, `layer`, Effects `choose(files)` / `dismiss` (`{opened:true, files:[]}`) | Every `HtmlFiles.pick` stays pending until settled; `settle` throws when nothing is pending and settles **all** pending picks. (:62-153) |
| `TestImages` | Service `{settle(source, "loaded"\|"error")}`, `make`, `layer`, Effects `load(source)`, `fail(source)` | Sources are equal by `{src,srcSet,sizes,crossOrigin,referrerPolicy}`. Throws listing pending sources if none match. (:62-173) |

---

## 13. `MessageLog.ts`

**Off by default.** The `MessageLog` service is a `Context.Reference` whose default `noop` has `enabled:false`. The runtime checks `enabled` before building an entry, so an app without a log pays nothing; the internal `messageLog.ts` split even avoids shipping the encoder. The runtime assigns `seq` itself, so every sink numbers entries identically. `record` must be synchronous and must not throw. Apps can't write entries, and the service is never part of a component's `R`. Entries hold **live references**, not copies; encoding happens only at the sink.

### Services and sinks

| Export | Semantics | Ref |
| --- | --- | --- |
| `MessageLog {enabled, record(entry)}` | — | :66 |
| `noop`, `MessageLog` (Reference) | — | :78, :88 |
| `Memory`, `makeMemory({size=1000})`, `memory({size})` | Ring buffer; `entries()` returns oldest first. | :934-990 |
| `fanoutAll(logs)` | Enabled if any log is. | :992 |
| `fanout(layers)` | Merges Layers, keeping the other services they provide (e.g. DevTools' `Controllables`); the later Layer wins. | :1015 |
| `makeEncoded(onBatch, {maxEntryBytes})` | `record` only queues. A scoped fiber drains, encodes to Wire and calls `onBatch`. A failing batch is dropped with `logError`. Encode warnings are logged once per component and field. Entries recorded after scope close are dropped. | :2191 |
| `socket(url, {buffer=1000, maxEntryBytes, host="browser"})` | WebSocket sink. Each connection gets `Hello{version,host}` plus the replay buffer. Retries with exponential backoff (200 ms, capped at 10 s) and warns once. Requires `Socket.WebSocketConstructor`. | :2249 |

### Common fields

- `Base` (:231): `{seq, at (Clock ms), session, causedBy?}`.
  - An entry **without `causedBy` is a fact**: a message from a DOM event, Command result, Subscription, mount or `root.send`; a `QueryChanged`; a Layer build, run or mount ending; or a `FetchStarted` started by a timer, host signal or Command.
  - `causedBy` is the seq of the root fact, however deep the chain. Render entries name the fact that last dirtied the instance. `CommandInterrupted` names the fact that stopped the run. A watch-triggered `FetchStarted` names the fact whose render declared the args. The seq may point at an entry a ring buffer has evicted.
- `InstanceBase` (:257): `+ {path, instance (unique per session, increasing; tells remounts at one path apart), component (full Component, sent as its name on the Wire)}`.
- `FailedIn` (:99): `init|update|view|content|domEvent|mount|command|subscription|layer|fallback|onEmit|onFailure|head|send|shares|shared`.
- `Issued {seq, index}` (:125): the issuing `Update`/`Mounted` entry and the index into its `commands`.

### `Source` (what sent an `Update`'s message) (:160)

| Tag            | Fields                                               |
| -------------- | ---------------------------------------------------- |
| `DomEvent`     | `name`                                               |
| `Command`      | `name, issued, spanId?, traceId?`                    |
| `Subscription` | `key, name, deps?`                                   |
| `Query`        | `name, seq` (of its `QueryChanged`)                  |
| `Emit`         | `path, seq` (the child's entry)                      |
| `Failure`      | `path, seq` (the child's `Failed`)                   |
| `Send`         | `path, seq` (the sender)                             |
| `Shared`       | `name` (local read name), `path` (owner), `seq`      |
| `Collected`    | —                                                    |
| `Mount`        | `seq` (`MountStarted`), `name, args, argsSchema`     |
| `Dispatch`     | — (outside the tree: `root.send`, DevTools dispatch) |

### Entry types (`Entry = SessionStarted | FetchStarted | InstanceEntry`) (:277-925)

| Tag | Fields | Notes |
| --- | --- | --- |
| `SessionStarted` | `app` | A `mount` or server render started. |
| `FetchStarted` | `query, logKey, trigger (watch/get/prefetch/visibility/connectivity/interval/invalidation/loadMore/reset), restart, inWindow, stored, page?, cursor?` | `logKey` has Redacted args redacted. `inWindow` marks a fetch of a hydrated entry while the fetch-free window is open. Each infinite page is its own entry. |
| `Waiting` | `props, model (server's), queries?, boundary?` | A hydrating instance waiting for its Layer; its first entry. Followed by `Mounted` (adopted), or `Mounted` from `init` on a handled failure, or `Unmounted` without `Mounted`. |
| `Mounted` | `props, model, queries?, commands, events, adopted, boundary?` | `adopted` comes from the server or from history. The first values of watches come later as `QueryChanged`. |
| `Update` | `source, message, props, model (after), commands, events, lists ($.loadMore/$.reset), sends, viewTransition?, queries? ($.queries read), shared? ($.reads read), boundary?` | The whole state, so replay can start at any `Update`. |
| `PropsChanged` | `props` | Logged before the writes the props cause; equal props log nothing. |
| `QueryChanged` | `name, result` (opaque) | Logged before the `Update` of its `onChange`. |
| `LayerPending` | `status: Pending\|Rebuilding\|Awaiting` | Missing in old frames means `Pending`. |
| `LayerReady` | — | — |
| `LayerFailed` | `cause, redacted?` | `redacted` means the failure was redacted from the server. |
| `Failed` | `props, in, name?, cause, update?{message,source}, issued?` | The only record of a throwing `update`'s message. With `issued`, this is the run's end entry. A failed root is followed by `Unmounted`; a root `fallback` that throws logs a second `Failed` with `in:"fallback"`. |
| `Unmounted` | — | A child logs before its parent. Also closes the instance's Subscriptions and pending Layer, which never log their own end. |
| `Kept` | — | A keep-alive child removed its nodes but stays mounted; its element mounts stop and it contributes no head or reports. |
| `Drawn` | — | A kept child is shown again and its mounts restart. |
| `SubscriptionStarted` / `SubscriptionStopped` | `key, name, deps` | e.g. `make("room","42")` gives `key 'room:"42"'`. Group by `name`; never parse `key`. |
| `MountStarted` | `name, args, argsSchema` | Never logged on the server or TestHost. New args published to a running mount log nothing. |
| `MountEnded` | `name, started, reason: completed\|closed\|failed, silent` | — |
| `CommandStarted` | `name, issued, spanId, traceId` | `causedBy` is the issuing fact, the fact that freed the queue, or the Layer ready. An end with no start means the run never began. |
| `CommandAwaiting` | `name, issued, entries: AwaitedEntry[]` | Logged only for a non-empty awaited set. |
| `CommandEnded` | `name, issued, spanId?, traceId?, silent, waitEnded?, outstanding?` | `silent` means every result was `noop`. `WaitEnded = settled\|nothing\|budget\|switch\|interrupt\|closed`. |
| `CommandInterrupted` | `… reason: InterruptReason` | `interrupt\|switch\|unmount\|layer\|self`. Logged at fiber exit, which is when `isRunning` stops counting and the queue advances. |
| `CommandDropped` | `name, issued, reason:"server"` | Only `update` Commands; `init` Commands are dropped silently on the server. |
| `SendDropped` | `owner, issued` | A send to an optional owner that isn't present. |

### Wire (versioned, one-way) (:1047-1400)

- `wireVersion = 1`. `WireHost = "browser"|"server"|"terminal"|"test"`.
- `Wire` is a `Schema.Union` of a `Hello{version,host}` frame plus every entry tag. `WireEntry` excludes `Hello`.
- Encoding:
  - Props, Model, message and events go through the component's Schemas.
  - A send goes through the owner's `receives` Schema. Shared values go through the owner's `shares.schema`, or structurally without one.
  - Command and mount args go through `args` **field by field**, with a structural fallback.
  - A Cause becomes `{pretty, reasons:[Fail|Die|Interrupt]}`.
  - Commands become `{_tag: Effect|Stream|Interrupt, name, group (re-encoded and redacted), args}`.
- **Placeholders** (`Placeholder`, `isPlaceholder`):
  - `{"~unserialisable": kind}`;
  - `{"~redacted": true}`;
  - `{"~truncated": bytes}` for a Model, message, query result, shared value or send message over `maxEntryBytes`.
- **Redaction:** every `Schema.Redacted` in props, Models, messages, events, args, sends and shared values is redacted. **Sent in clear:** a Subscription's `key`/`deps`, and error message text inside a Cause.
- Deps: `NaN`/`±Infinity` are sent as a placeholder and `-0` as `0`.
- Readers must treat a placeholder as an unknown leaf: two placeholders are never known to be equal.
- Encoder API:
  - `Encoder`, `makeEncoder({maxEntryBytes, onWarning})` (warns once per component and field);
  - `encodeCommand`, `encodeSend`;
  - `encodeArgs` (marked internal but exported; never throws);
  - `structural(value)`: JSON best effort. Handles cycles, Date, Error (`{name,message}`), `toJSON`, and Map/Set/TypedArray as unserialisable.

### Recorder and causality (`internal/recorder.ts`)

- One recorder per root session. Instances are numbered from 0 per session (`born++`) in first-recorded order.
- `step` opens a new fact. `follow` re-enters a cause for late work. Render entries take the cause stored for the instance when it was dirtied.
- `boundary` is the nearest ancestor (or self) with a provided Layer in the same environment.
- `queries` is attached to every `Update`/`Mounted` of a component with queries.

### Dev-mode checks (not the log)

- The package `imports` map selects `internal/devOn.ts` by default and `devOff.ts` under the `production` condition.
- devOn throws on:
  - duplicate sibling element keys;
  - a slot placed twice;
  - a part applied outside its owner's view;
  - two owners setting the same event option on one element;
  - a child whose Layer is pending or failed with no `fallback`;
  - a root placing a slot;
  - child-path conflicts.
- `hotOn.ts`/`hotOff.ts` are selected the same way.

---

## 14. `ui-devtools/DevTools.ts`

- Exports `Position = "TopLeft"|"TopRight"|"BottomLeft"|"BottomRight"` and `WebMcpOptions {dispatch?}`.
- `layer({position="BottomRight", size=1000, exclude, server, webMcp})` (~:148) provides `MessageLog` and `BrowserHost.Controllables`. It needs `document`. Behaviour:
  - **Overlay:** an iframe appended to `body` and removed on close; mounted with `MessageLog.noop`, so it never logs itself. Page styles and input don't reach it, and the app's document/window listeners don't hear it. The launcher can be dragged, moved with arrow keys or the corner picker; corner, open state and size persist in `localStorage` (`@effect/ui-devtools/{position,open,size}`). The theme follows `prefers-color-scheme`. The iframe is sized to the launcher or panel, so the page stays clickable.
  - **Panels:**
    - Timeline (newest first), with filters Messages, Commands and Everything (the `messages` filter keeps updates, mounts and failures; `commands` adds runs);
    - an instance tree with find and browse;
    - per-entry tabs: Model with diff, Message, Props, Commands (each run's state), Events, Lifecycle (Layer builds, Subscriptions, mounts, runs), and Raw (with Copy frame);
    - the causal chain (back and forward links), Follow latest, Back, Clear, and a failure count.
  - **Clear** empties the timeline but keeps mounted instances and each one's pre-clear state for diffs and Time travel. It is disabled while paused.
  - **`exclude`** takes message `_tag`s across all components. An excluded `Update` gets no row; a burst replaces the instance's earlier excluded entry, one slot per instance, while Model diffs and Time travel stay accurate. This is **not** a privacy mechanism.
  - **Time travel** on a selected entry opens a slider (`ScrubbedPage`). It hides the root's container and paints an `inert` copy from each instance's state at that entry, folded from the raw entries the overlay keeps (`internal/history.ts`). The live tree keeps running hidden until Resume. While paused, the iframe joins the top layer so the copy's dialogs and popovers can't cover it.
  - **`server` URL:** also streams frames via `MessageLog.socket` to `/log` and opens `/control` for Show, Resume, MessageSchema and Dispatch requests. An agent's paint is the same pause as Time travel, and either side can resume. With `DevToolsVite` the URL and `size` come from a `<meta name="effect-ui-devtools">` tag.
  - **WebMCP:** when `document.modelContext` exists, it registers the same tool set as `effect_ui_<tool>` with `annotations {debugging:true, readOnlyHint, consequentialHint}` and unregisters on close. `effect_ui_dispatch` needs `webMcp:{dispatch:true}`; `webMcp:false` disables registration. Errors come back as `{isError, error}` in the payload, because Chromium masks rejections.
  - The overlay reads only Wire frames, so Redacted values stay placeholders, including in copied frames. Everything stays in memory.
- `attach(options)` is `@internal`. The Vite plugin uses it to auto-attach through the global `Symbol.for("@effect/ui/devtools")`, which `hotOn.devTools` reads in `BrowserHost.mount`. Entries are buffered until the overlay is built. An explicit `layer` takes over, so only one overlay mounts.

### `BrowserHost` control surface that DevTools relies on (`ui/src/html/BrowserHost.ts:627-805`)

- `Recorded {model, queries?, props?}`.
- `Controllable {session, path, pause(state)→Painted, resume, instance(n)→ControlledInstance}`.
  - The paused copy runs nothing: no Commands (not even `init`'s), Subscriptions, fetches, mounts, Layers or lazy loads. It logs nothing, leaves the head alone and is invisible to the Router.
  - Modals and auto popovers in the copy are shown as manual popovers.
  - The live tree's modals and auto popovers are closed while paused (without `toggle`/`close` reaching its Model), and its document/window listeners don't hear the user's input.
  - Gotchas: uncontrolled DOM state, scroll, focus and media aren't painted; element mounts that measure read zero while hidden; the copy has duplicate ids.
- `ControlledInstance {instance, path, component, message: Schema, dispatch(msg)→Dispatched}`. The dispatch is logged with source `Dispatch` and runs after a pending view transition.
- `Dispatched` is `Updated{seq}`, `Failed{seq}`, or `Ignored{reason: closed|waiting|frozen|unchanged}`.
- `Painted {fellBack (paths started from init), fallbacks (paths showing a feature fallback)}`.
- `Controllables {register}`, a Reference whose default ignores every root.

## 15. `ui-devtools/Inspector.ts`

A headless core. It reads Wire frames only and states only what the entries say.

| Export | Semantics | Ref |
| --- | --- | --- |
| `Outside {_tag, seq}` | The seq isn't held (evicted, cleared or never seen). | :50 |
| `Reason` | `InterruptReason \| ended\|server\|completed\|closed\|failed\|ready\|stopped` | :76 |
| `Record {kind: layer\|subscription\|mount\|command, instance, name, key?, issued?, start?, end?, reason?}` | Built from the entry that begins it; an end without a seen begin makes no record, except a `CommandStarted` whose issuer was never seen. A `Failed` without `issued` ends no run. Server `init` runs stay open with no start. An open record outlives its entries. | :129 |
| `Instance {instance, path, component, mounted?, unmounted?}` | — | :160 |
| `Summary` | `+ parent?, waiting, running, ended[{reason,count}], latest?, below{instances, failing, running}` | :195 |
| `Link {rel: causedBy\|issued\|source\|started, seq, index?}` | — | :234 |
| `Previous {seq, changed?: boolean\|"unknown", model?, props?}` | Computed on arrival; survives eviction and clear (a baseline is kept). | :265 |
| `Change {kind: changed\|added\|removed\|unknown, path, before?, after?}` | — | :285 |
| `Session` | `id, app, entries(), resolve(seq), instances(), instanceCount(), summary(n), active(), children(n?), find(text), records(n?), run(issued), back(seq), forward(seq), previous(seq), clear()` | :305 |
| `Inspector` | `ingest(batch)` ignores a seq not above the last (idempotent re-ingest), `sessions()`, `remove(id)` | :351 |
| `diff(before, after)` | Key-wise and index-wise; a placeholder is always reported as `"unknown"`. | :397 |
| `make({size=1000, exclude})` | Links to replaced excluded entries resolve to `Outside`. | :423 |

## 16. `ui-devtools/DevToolsHeadless.ts`

`layer({server="http://127.0.0.1:4774", host="terminal", size=1000})` is `MessageLog.socket(<server>/log)` using the global `WebSocket`. Read-only (no control). For DOM-less hosts such as OpenTUI. (~:53)

## 17. `node/DevToolsServer.ts`, plus internal `server.ts`, `tools.ts`, `mcp.ts`

- `defaultPort = 4774` (fixed, so `.mcp.json` can be committed).
- `Options {port, size=1000, dispatch=false, keep=5 closed sessions}`.
- `layer(options)` serves `GET /` (the viewer page; a 404 hint if it isn't built), `/mcp`, `/log`, `/control` and `/watch`, on **127.0.0.1 only**.
- `url({port})` returns the server URL.
- Security:
  - `/mcp` rejects requests that carry an `Origin` header.
  - The WebSocket routes accept only loopback origins (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`); others get 403.
  - There is no token.
- Routes:
  - `/log` ingests Wire frames into the server's own Inspector and History, so reads survive a reload or tab close and server-render sessions appear. On disconnect sessions are marked closed and pruned to `keep`.
  - `/control` is the page's request/reply channel with a 10 s timeout. The page pushes `State{sessions, paused}`.
  - `/watch` feeds the viewer: `Held{sessions}`, then each session's `SessionStarted` and its frames, then live frames.
- A session is one mounted root; a reload starts a new one. Tools default to the newest **connected** session.
- MCP: Streamable HTTP, protocols 2025-11-25, 2025-06-18 and 2025-03-26. The server's `instructions` string recommends starting with `list_sessions`/`list_instances`. Results over 24 000 bytes come back as `{"~outline", note}`; pass `path` to read a subtree.

| Tool | Params | Hints | Semantics |
| --- | --- | --- | --- |
| `list_sessions` | — | read | `session, app, host, connected, controllable, paused, instances, entries, first, last` |
| `list_instances` | `session?` | read | Instances with Command-run status text. |
| `list_entries` | `session?, instance?, filter (messages\|commands\|all), tag (entry or message _tag), after?, limit 1–500 (50)` | read | Rows `{seq, tag, instance, path, label, changed, causedBy}`. Newest `limit` without `after`, oldest-first with it. |
| `count_entries` | `session?, instance?` | read | By entry tag, and by message tag for `Update`s. |
| `get_entry` | `session?, seq, path?` | read | The Wire frame. |
| `get_chain` | `session?, seq` | read | Steps: `source`/`causedBy`/`issued`/`entry`/`command`/`started`/`not started`/`end{reason, afterMs}`/`running`/`result`/`named by`. |
| `get_state` | `session?, instance, at?, path?` | read | Model, props and queries at a seq (from History); `unmounted at #n` when relevant. |
| `diff_state` | `session?, seq, from?` | read | Changes against the previous state entry, or against the state at `from`. |
| `show_entry` | `session?, seq` | control | Pauses and paints; returns `paused, fellBack, fallbacks`. |
| `resume` | `session?` | control | — |
| `get_message_schema` | `session?, instance, tag?` | read | JSON Schema from the page (`toJsonSchemaDocument(toCodecJson(message))`). |
| `dispatch` | `session?, instance, messages: Json[1..100]` | write (destructive, open-world) | Off unless `dispatch` is on. All messages are decoded first (none is sent unless all decode; a redacted field needs a real value). Sent in order with an 8 s/`within` budget, stopping at the first non-`Updated`. Returns `outcomes, applied, of, notSent, paused, unseen, unavailable (skipped\|evicted\|excluded), note`. `Unknown` means it may still apply, so read before resending. |
| `wait` | `session?, since?, instance?, run?{seq,index}, timeout 0–60000 (5000)` | read | Waits for open Command records to end; returns `settled, last, open`. |

Errors are a `ToolError{message}`, for example: "No session has connected yet…", "can't be controlled: it is server rendered or a terminal app, or its tab was closed or reloaded", "Entry #N is not in the session's buffer", "#N is not among the last N entries the page keeps to paint from".

## 18. `node/DevToolsVite.ts`

- `OverlayOptions {position, exclude, webMcp}`. `Options extends DevToolsServer.Options` and adds `hot=true` and `overlay=true|OverlayOptions`. It also exports the structural types `Plugin`, `ViteConfig`, `TransformContext`, `DevServer`, `HtmlTag`.
- `plugin(options)`:
  - Applies only to `vite dev`: not builds, previews, or when `VITEST` is set.
  - Starts and stops the server with Vite and logs both URLs. If the port is taken it warns, adds no meta tag, and dev continues.
  - Injects the meta tag (`{url, size}`) and virtual modules `/@effect-ui/devtools` (auto `DevTools.attach`) and `/@effect-ui/hot`.
  - **Hot:** on `vite:beforeFullReload`, roots save each instance's encoded Model and query results (plus scroll) to `sessionStorage["@effect/ui/hot"]` and adopt them after reload; a Model that no longer decodes restarts from `init` with a console warning. It enables `experimental.hmrPartialAccept` unless the config sets it to false. It adds HMR footers to detected component exports (`hotExports`), so compatible edits redraw in place, keeping Models and Subscriptions. It falls back to a full reload for Schema-incompatible edits, replaced children, and components with queries, shared state, parts, slots or a Layer.
- The `.mcp.json` entry is `{ "mcpServers": { "effect-ui": { "type": "http", "url": "http://127.0.0.1:4774/mcp" } } }`.

## 19. `node/internal/bin.ts`

`effect-ui-devtools [--port n] [--size n] [--keep n] [--dispatch] [-h]`. Integer validation exits with code 2. Prints the URL and the MCP URL.

## 20. Internal `viewer.ts`

The read-only page at the server root reuses the overlay component full-page over `/watch`. It can't paint (`paintable:false`) and also serves terminal apps.

---

## Notable concepts not in LLMS.md

LLMS.md covers `fromLog`, `expectMount`/`mounted`, `fireDocument`, `frame`, `TestGlobalEvents.fire`, `TestAnimationFrames.fire`, `Story.parts`, slot scenes, `s.shared`, and `SendDropped`/`PropsChanged` by name only. It doesn't mention any of the following:

1. **The acknowledgement rule in full:**
   - the message-step vs acting-step split and its exemptions (`switch`/`queue`/stream Commands, `keepPending`);
   - which kept items still fail the end check (Commands and load-mores do; queries don't);
   - `given` refusing to discard work after an acting step;
   - the end check being skipped when the test already failed;
   - `start()` vs `make()`.
2. Shared steps: `keepPending`, `waitExpired`, `loadedMany`, `loadedMore`, `loadMoreFailed`, `loadFailed` with `previousSuccess`, the `waiting`/`patched` options and the live-patch rule, `next`/`end` for streams, `layerFailed`, `expectExact`/`expectHas`/`expectNone`, `check`, `interrupted`, `loadingMore`, `queryInfo`, `reports`, `given(model, queries, shared)`, and resolving with the raw result before `Command.map`.
3. Scene steps: `childFailure`, `childPending`, `givenChild`, `collected`, `expectHandled`, `expectDefaultPrevented`, the `defaultPrevented` record field and its rules, `Scene.children`, `Scene.fallback`, the "removed an unacknowledged mount" error, the "declared with p.child" error, and the `elements` option.
4. `Story.head`, `Story.start`/`Scene.start`, the `Replay`/`Divergence`/`Outcome` shapes, and how `fromLog` decodes Wire frames and fails on placeholders.
5. HtmlScene's browser-faithful click sequence (pointer/mouse cancellation rules, disabled controls throwing, submitter fields, checkbox/radio input+change, popovertarget toggle) and the steps `type` (with `composing`/`inputType`), `change` (with `files`), `compositionEnd`, `submit`, `focus`/`blur`, `drop` (with `dropTarget` type matching), `fireElement`, `fireWindow`, `fireCustomEvent`; the matchers `toHaveValue`, `toBeChecked`, `toBeDisabled`, `toHaveAccessibleName`.
6. HtmlPlay differences: it writes DOM props before the event, controlled fields revert, it settles between press and release, non-bubbling events don't bubble, and `keydown("document")`.
7. The `HtmlLocator` role and name engine (it runs on the DOM too, has hidden-element rules, and offers `dialogState`, `popoverState`, `value`, `checked`, `roleOf`, `nameOf`, and the DOM action helpers).
8. `TestHost` internals:
   - the `Flush` policies and `EFFECT_UI_TEST_FLUSH` (including seeds);
   - `budget`, `DrainExhausted`, `SettleError` with log tail and pending, `RootCrashed`;
   - `pending()` kinds and statuses (including `stopping`, `held`, `Load`);
   - `root.fetches()`, `root.entry()`, `root.head()`, `root.frames()` with the `frames` projection;
   - `makeHost().operations()`, `TestElement.owners`, `formatLog`/`formatTimeline`, `TestHost.stub(feature)`;
   - `setVisible`/`setOnline`, and `expectProblem`/`ProblemsError` failing at scope close.
9. The `TestQuery` harness (`fetches` and the `Fetch` shape, the `Entry` inspector view, `idleTimeToLive`).
10. The `ssr()` failure catalogue, budget and clock stepping, the `static` option, and the `misses`/`commands`/`adopted`/`serverLog` fields; `ServerCommandIssued` failing `ssr`.
11. `TestFiles` and `TestImages` fakes.
12. **Every MessageLog entry type and field** (the table in §13): the fact/`causedBy` causality model, `instance` numbering, `boundary`, `Waiting`, `Kept`/`Drawn`, `CommandAwaiting`/`CommandDropped`, `InterruptReason`, `WaitEnded` with `outstanding`, the `silent` flags, `FetchStarted.inWindow`/`stored`/`page`/`cursor`, and the `Failed` fields `in`/`update`/`issued`.
13. MessageLog sinks (`memory`, `makeMemory`, `fanout`/`fanoutAll`, `makeEncoded`, `socket` with its replay buffer and backoff); the Wire version and `Hello` frame; the placeholder catalogue and `maxEntryBytes` truncation; what is **not** redacted (Subscription keys and deps, error messages); `structural`, `encodeCommand`, `encodeSend`, `isPlaceholder`.
14. Dev-mode checks behind the `production` export condition (devOn/devOff), and the hot module (hotOn/hotOff).
15. DevTools:
    - overlay behaviour (iframe isolation, localStorage persistence, `exclude` semantics, Clear semantics, tab set);
    - Time travel painting with `inert` copies and its gotchas;
    - the `BrowserHost.Controllables`/`Controllable`/`ControlledInstance`/`Dispatched`/`Painted` API;
    - the `Inspector` core API and `diff`;
    - `DevToolsHeadless` for terminal hosts;
    - `DevToolsServer` (loopback-only binding, Origin rules, routes, `keep`, the 13 MCP tools with their params and limits, the 24 KB outline fallback, dispatch outcomes and notes, `wait`);
    - WebMCP registration (`effect_ui_` prefix, `webMcp:{dispatch}`);
    - the `DevToolsVite` plugin (auto overlay, hot state preservation via sessionStorage, partial HMR rules, meta-tag discovery, port-conflict behaviour);
    - the `effect-ui-devtools` CLI and the read-only viewer page.
