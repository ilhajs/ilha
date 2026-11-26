# Effect UI public-API inventory: Component, View, UiSchema, UiStruct, Html, and the internals behind them

Source: `/tmp/effect-ui/packages/ui/src`. All paths below are relative to it. Every export is marked `@stability experimental`, `@since 0.1.0`.

## 1. `Component.ts`

### 1.1 Type ids and guards

| Export | Signature | Semantics | Ref |
| --- | --- | --- | --- |
| `TypeId` | `"~@effect/ui/Component"` | Marks a non-headless component. | Component.ts:93 |
| `NoopTypeId` | `"~@effect/ui/Component/Noop"` |  | :111 |
| `StepTypeId` | `"~@effect/ui/Component/Step"` |  | :223 |
| `SharedTypeId` | `"~@effect/ui/Component/Shared"` |  | :281 |
| `HeadlessTypeId` | `"~@effect/ui/Component/Headless"` |  | :1354 |
| `ComposedTypeId` | `"~@effect/ui/Component/Composed"` | Marks what `p.child` returns. | :1732 |
| `LazyTypeId` | `"~@effect/ui/Component/Lazy"` |  | :4418 |
| `isComponent(u)` | `u is Any` | Checks `hasProperty(TypeId)`. A headless component has no `TypeId`, so it fails this check. | :2214 |
| `isHeadless(u)` | `u is Headless.Any` |  | :2325 |
| `isLazy(u)` |  |  | :4521 |
| `isStep(u)` | `u is InitStep<…>` | `update` may return a bare Model or a step; this tells them apart. | :1034 |

### 1.2 Noop

- **`Noop`**: an interface rather than a `unique symbol`, so it doesn't widen to `symbol` as an inferred return type (:136). There is also a `Noop` Schema, `Schema.declare(isNoop)` (:147).
- **`noop`**: a frozen `{[NoopTypeId]: NoopTypeId}` (:198, internal/noop.ts:9). It's the result of a Command body, mapper, `Command.match` branch or `onMount` Effect that has nothing to report. When it's the _final_ result:
  - the runtime sends nothing and logs no `Update`;
  - `CommandEnded` / `MountEnded` record `silent: true`.
- **`isNoop(u)`**: matches by type id, not identity, so it works across duplicate copies of `effect` in one bundle (:214, noop.ts:17).
- **Gotchas:**
  - `$.run(Component.noop)` doesn't compile; `noop` is a message value, not a Command.
  - `=== noop` doesn't narrow a union; use `isNoop`.
  - View handlers still use `undefined` to mean "no message".
  - `$.run` accepts Commands that end in `Msg | Noop`, so a component with `message: Schema.Never` can still run Commands.

### 1.3 The step (`$`) API

**`Next<Model, Msg, Events, R>`** (:242) is what the runtime reads after `init`/`update`:

- `model`, `commands`, `events`
- `lists?: ListIssue[]`, `sends?: Send[]`, `viewTransition?: string[]`

Other models:

- `Send { owner: Headless.Any; message }` (:262)
- `ListIssue { name; op: "loadMore" | "reset" }` (:536)

**`Init<Model, Msg, Events, Props>`** (:827): `$` in `init`. It has only `props` and `set(model)`, because there is no Model yet. It returns an `InitStep`.

**`InitStep`** (:549): `model`, `commands`, `emitted`, plus these chainable methods:

- `set(model)`: replaces the Model, no merge (:560).
- `evolve(fields)`: uses `UiStruct.evolve` rules (:562).
- `run(...commands)`: requirements accumulate into `R`, one Command at a time (:564).
- `emit(...events)` (:568).

There is no `loadMore`/`reset` in `init`.

**`Step`** (:586) extends `InitStep` and adds `lists`, `sends` and `viewTransitionTypes` (`undefined` means none was asked for; `[]` means a transition without types). Every method returns a new immutable step (StepProto :848, `stepWith` copies):

- **`set` / `evolve`.** `evolve` on a union Model is a compile error; match the union first (:610).
- **`run(...commands)`** (:617)
  - Each Command is owned by the instance and ends when the instance ends.
  - Each gets its own Scope, closed with the instance.
  - Results come back as messages; `noop` sends nothing.
- **`emit(...events)`**: reports to the parent (:621).
- **`loadMore(name)`** (:627), for infinite queries only (`InfiniteNames<L>`).
  - Args are taken from the query _after_ this update's Model.
  - Nothing is issued for a disabled query.
- **`reset(name)`** (:633): drops every page after the first, then refetches. All held pages are saved in `history.state`, so `reset` is how a long list keeps that small.
- **`send(Owner, message)`** (:649)
  - Goes to the nearest instance of `Owner` above this one. It is applied as this update applies, _before_ this update's emits are delivered.
  - No `reads` entry is needed; the step carries `Shared.Of<Owner>` in `R`.
  - More than 100 send rounds in one flush fails the sender (anti-loop guard, sharedRun.ts:395).
- **`viewTransition(types?)`** (:719)
  - Asks the host to run the flush that renders this update inside `document.startViewTransition`.
  - No-op when the API is missing or under `prefers-reduced-motion` (commits once, unanimated), and ignored on TestHost and the server.
  - The rest of the flush runs inside the transition, so every update it renders animates. The flush waits about a frame for the browser callback: the DOM patch, head, navigation scroll/focus and `afterCommit` all land in the callback.
  - Messages and query results that arrive while waiting render in the callback too.
  - Commands start as soon as `update` returns.
  - Types are merged (set union) across steps until the flush is handed to the browser. Types asked for while the callback is pending are dropped.
  - The first mount and hydration never animate.
  - Two roots asking in the same frame: the first's animation is skipped.
  - Elements need unique `viewTransitionName`s.

**`Update<Model, Msg, Events, Props, L, Cur, SR>`** (:749) is `$` in `update`. It extends `Step` and adds:

- **`props`**: the current props from the Models above, even if their flush hasn't rendered yet. An ancestor waiting to render renders before the message arrives. If that ancestor no longer renders this instance, the instance is removed and the message dropped.
- **`queries`**: results as `h.queries` showed them for the pre-update Model.
- **`reads`**: owner values from the owners' Models _as this update runs_. A reader that sends to its owner still sees the old value in the same update. An `onChange` may be older than `$.reads`.
- **`send(Owner, msg)`** (:764).
- **`send("self", msg)`** (:786)
  - Only when `reads` has an `owner: "self"` entry; otherwise `message` is `never`.
  - Adds nothing to `R`. The outermost instance has none above it, so the send is dropped and logged as `SendDropped`.
  - Only `$` has it (not the steps its methods return), so call it first: `$.send("self", m).set(x)`.
- **`combine(...fns)`** (:808, impl :941)
  - A left fold: each function gets a fresh `$` holding the previous function's Model.
  - Commands, emits, lists and sends concatenate in call order; view-transition types merge.
  - `props`, `queries` and `reads` stay frozen at their values when the update started.
  - Inside a tag slice it takes slices of that tag or whole-message functions. Inside a whole-message update, a tag slice is rejected.

`StepRequirements<U>` (:840).

### 1.4 `define(options)` and `DefineOptions` (:2996, define :3481)

The two-step design: `define` holds everything nothing is inferred from, so slices and views written outside the component can be typed against the definition (typing them against `typeof Component` would be circular).

| Option | Type / shape | Semantics |
| --- | --- | --- |
| `name` | const string | Used for paths, messages and the log. Read back as `Component.definition.name`; the function's own `name` is untouched. |
| `props?` | Codec | Default `Schema.Struct({})`. |
| `model` | Codec |  |
| `message` | Codec | Usually a `UiSchema.TaggedEnum`. |
| `events?` | Codec | Default `Schema.Never`. |
| `queries?` | `{ [name]: { query, args, debounce?, onChange? } \| { queryMany, args, debounce?, onChange? } }` | `args({model, props, queries-of-others})` returns args, or `undefined` to disable; for `queryMany`, an array of args (empty = watch nothing). Giving both `query` and `queryMany`, or an infinite query under `queryMany`, is a type error (:2086-2093). Model plus query results together are the instance's state. A changed result re-renders. Each query is added to `R`. |
| ↳ `debounce` | `Duration.Input` | Delays only a _fetch_ for changed args, on the Clock. These skip the wait: mount, the server render, fresh or in-flight cache entries, and a change to `undefined`. While waiting, `h.queries` is `Initial` and `h.previous` holds the last value. A new change restarts the wait. Each new `queryMany` key waits on its own. |
| ↳ `onChange` | `query`: `(result) => Msg`; `queryMany`: `(results, changes: KeyedChange[]) => Msg` | The result is written first, so the message's `update` sees it in `$.queries`. |
| `slots?` | `ReadonlyArray<Sl>` | Places a parent fills; see §1.8. A definition with slots must finish with `view`, not `parts` (`make` throws, :3712). |
| `reads?` | `{ [localName]: Owner \| { owner, optional?, report?, onChange? } \| { owner: "self", optional: true, report?, onChange? } }` | See §1.10. |
| `shares?` | `fn` \| `{ value, schema?, receives? }` \| `{ value, schema?, receives?, collects: { schema, onChange } }` | Headless only. See §1.10. |
| `restore?` | `false \| (model, props) => Model` | History restore; see §6.11. |
| `elements?` | `View.Vocabulary<V>` | `define` only; `Html.component` supplies it. Without it, `h` is host-neutral (`el`/`text`). |

Runtime behavior of `define` (:3481-3600):

- Builds `receives` as `message.check(filter on _tag ∈ receives)`, or `Schema.Never` when `receives` is empty (:3605).
- Calls `sharedReads.check` and throws when:
  - one owner is listed twice with an `onChange` each;
  - a `"self"` entry lacks `optional: true`;
  - a `"self"` entry appears in a component without `shares` (shared.ts:155).

**Gotcha (:3324).** If the `model` Schema, or a query's success, error or args Schema, holds `Schema.Redacted` _anywhere_:

- the instance's state is never written as JSON;
- the server defers it and its whole subtree to the client and logs a warning once per component;
- the Router keeps no history entry for it.

Keep secrets in a leaf component or a service. Use `restore` instead when only history is the concern.

### 1.5 `Definition` (:2503), the object `define` returns

Fields: `name`, `props`, `model`, `message`, `events`, `receives`, `queries`, `elements`, `slots`, `reads`, `shares` (the `value` function), `sharesSchema`, `collects`, `restore`.

Helpers. Each returns its input typed against the definition; `update` re-binds `$` (:3580):

- `Def.init(f)`
- `Def.update(tag, f)`: a slice for one tag. `msg` and `$.combine` are narrowed to that tag; the returned function accepts any `$`, so another update can call it by hand.
- `Def.update(f)`: an update over the whole message type.
- `Def.update(record)`: a handler for **every** `_tag`, with no default key. An unknown key is a type error (`UnknownTag`). Open tags (template literals) are excluded via `DispatchedByTag`.
- `Def.subscriptions(f)`: `f({model, props, queries}) => (Sub | false | null | undefined)[]`. Falsy entries are filtered out. Subscriptions are keyed Streams, running while their key is listed; **two entries with one key fail the instance**.
- `Def.view(f)`, `Def.fragment((h, ...args) => out)`
- `Def.make(...)`

`Definition.Any` / `Definition.Of<Name>` (:2792): an erased definition; `provide` keeps the original.

### 1.6 `make(...)` overloads (:2645-2780)

1. **Normal component**: `{ init, update, view, subscriptions?, head? }` returns `Component<…>`.
   - `init` may return a bare Model.
   - `update` is a function or a per-tag record.
   - `R` is read off the inferred return types of `init`, `update`, `view`, subs, queries and reads, minus `Command.FrameworkService`.
   - Type error if `shares` is set (owners must be headless).
2. **Headless with parts**: `{ init, update, parts(p, model), subscriptions?, head? }` returns `Headless<Props, Events, Parts, …>`.
   - `parts` is `never` when slots are declared.
   - If `parts` returns a `p.child(...)`, its parts are unwrapped (`Composed.Parts`).
3. **Headless owner with no parts**: `{ init, update }` with neither `parts` nor `view`. The consumer's `view` closure receives `{}`. Without slots and `shares`, `parts: never` forces form 2.

`finish` runtime checks (:3667):

- `parts` combined with slots throws.
- `shares` combined with `view` throws ("only a headless component can share state").
- With no `view` and no `parts`, `parts` defaults to `() => ({})`.
- Outlets are made once per slot, so a forwarded slot is the same value every render.
- `queries` without the Query module loaded: an empty record is fine; anything else throws (:3615).

`head?: ($: {model, props, queries}) => HeadEntry<V>[]` is pure. On every flush that changed a view, the runtime folds the placed tree's heads (including a child's `fallback` content) with the root vocabulary's merge. A `Head.reduce` / `HtmlHead.reduce` entry maps the folded head of the instance and its subtree; the root's result is final (:3268).

### 1.7 View helper `h` (`ViewHelper` :2904, `Component.Helper<typeof Def>` :2880)

`h` = `View.WithTags<Msg, Props, V>` (§2.3: `props`, `el`, `text`, `isRunning`, `id`, `lazy`, vocabulary tags), plus:

- **`QueryHelpers<L>`** (:1842), only when queries are declared:
  - `h.queries[name]` (`QueryResultOf`).
  - `h.previous[name]`: `Option` of the Success held for _other_ args. `Some` only while enabled; `None` whenever `h.queries` has the stored result.
  - `h.patched[name]`: whether the value includes an unconfirmed optimistic patch (per entry).
  - `previous` and `patched` don't exist for `queryMany`.
- **`SlotHelpers<Sl>`** (:1867): `h.slots.<name>` is an opaque `View.Outlet`. It renders nothing if the parent passed nothing, and the view can't tell.
- **`SharedHelpers<SR>`** (:493): `h.reads.<localName>`; `undefined` for an absent optional owner.
- **`KeepAliveHelpers`** (:2935, impl View.ts:2219)
  - `h.keepAlive((s) => C)`: children called with `s` live as long as the author. Keys must be literals (`KeepAliveKeyHint` type error otherwise, View.ts:499).
  - `h.keepAlive(alive, (s) => C)`: `alive({model, props, queries, key})` is asked on every author render for each kept child. It **must** read model, props or queries from its argument, or it throws (keptRun.ts:101).
  - Returns `content`'s result and adds no node.
  - Implementation: `s` is `Object.create(h)` with `"~alive"` set; component calls read `h["~alive"]` (Component.ts:2306).

`Current<Model, Props, Queries>` (:2965) is the argument of subscriptions, head and query `args`. `Alive` (:2980) adds `key`.

### 1.8 Child calls (`Mountable.Call` :1192; `View.Child.Options` View.ts:414)

`Comp(h | s, options)` returns a `View.Child` node. Options:

| Option | Semantics |
| --- | --- |
| `key?: string` | Default `""`, so `key: ""` and no key are the same child. Path `Name[key]`. Inside `s` without a predicate: literal keys only. |
| `props` | Required unless `{}` extends `Props`. Required even if empty for erased (`Component.Any`) props. |
| `onEmit?` | `(events) => Msg \| undefined`, or a per-tag record `{ Tag: (e) => Msg \| undefined }` (`EmitHandlers`; wide tags rejected). Dispatched as `onEmit[event._tag](event)` (child.ts:61). Default ignores. |
| `onFailure?` | `(failure: AsyncResult.Failure) => Msg \| undefined`. Also tells the parent; the failure stays in the child either way. |
| `fallback?` | `(result) => Content`. Shown while failed, until the key changes; for a lazy component also while loading (`Initial`). Without it the child is blank. Required for a feature child (dev: `checkFallback` throws, devOn.ts:139). |
| `slots?` | `{ name: Input }`. Only declared names; content typed with the **parent's** `Msg`. Requirements surface in the parent. |
| `view` | Headless only: `(parts) => Content`; the whole view. |

Child rules (View.ts:300-350; paths.ts):

- Every child is a failure boundary.
- Two children at one path are one instance, so a branch swap (`cond ? X(h,{props:a}) : X(h,{props:b})`) keeps the Model and doesn't re-run `init`. Key the branches to reset.
- A second unkeyed child of the same component fails the parent with a "give each X its own key" error (paths.ts:207).
- A list of one unkeyed row that a new row replaces keeps the instance.
- Dropping a child from the view unmounts it and its Model goes with it.
- Path segment escaping (paths.ts:28): in names, `[` becomes `%5B`; in keys, the `/` of `]/` becomes `%2F`; `%` becomes `%25`. A slot's segment is `[name]`.
- Hot module replacement: `child.replace(from, to)` maps new component objects to old identities so children stay mounted (child.ts:37).

Slot rules (:3307; paths.ts):

- Content belongs to the parent: handlers send parent messages, events and failures map to the parent, and services resolve where the parent declared the child.
- A parent re-render patches only the slot content and doesn't run the child's view.
- Unplaced content isn't mounted. A slot placed again starts over.
- Placing a slot twice in one render throws (`places its slot X twice`, paths.ts:226), including across an author's view, its headless closures and its slot content (`checkAuthorPlacements`).
- A root placing a slot throws (dev, devOn.ts:150).
- An outlet inside an element that can't hold text: text passed through it fails its author (`Outlet.noText`).

### 1.9 Headless components and parts

**`Headless<Props, Events, Parts, R, Rcv, Sh, SV, Rp>`** (:1417):

- Callable as `X(h, { key, props, onEmit, onFailure, fallback, view: (parts) => … })`. `slots?: never`.
- `Shared.Of<this>` is removed from the requirements of the `view` closure, so readers inside it compile.
- It is not `Mountable`: it can't be a root, page or feature.
- Fields: `definition`, `props`, `model`, `message`, `events`, `receives`, `init`, `update`, `parts(model, props, PartsContext)`, `subscriptions`, `head`, `elements`, `~queries`.

Semantics (:1365-1410):

- The closure is the consumer's code: children declared in it, their `onEmit`/`onFailure`, and fallbacks all belong to the consumer.
- A closure that throws fails the headless child (source `content`), which then shows its fallback.
- A headless child re-renders whenever its consumer does. Its own `update` re-renders only the closure. Wrap it in a small component if the consumer renders often.
- `Router.prefetch` doesn't walk into closures.

**`PartsHelper` `p`** (:1599), plus `QueryHelpers` and `SharedHelpers` (`p.queries`, `p.previous`, `p.patched`, `p.reads`):

- **`p.props`**
- **`p.isRunning(Cmd, ...group)`**
- **`p.id(name, key?)`**
  - Derived from the instance path, so server and client agree and instances differ.
  - Outside a mount it falls under the component's own name.
  - Escaping: `[A-Za-z0-9]` kept, other characters become `_<base36>_`, joined with `-`. Safe in id lists and selectors (View.ts:1352).
- **`p.part(tag | [tags], decorate(builder, ...args))`** or **`p.part(decorate)`** for any element (:1624/:1636).
  - Tags are checked in the types and at apply time. A wrong tag throws `a part for <x> was given <y>` (View.ts:1191).
- **`p.child(Headless, { key?, props, onEmit?, onFailure?, parts: (childParts) => Out })`** (:1707)
  - Composes on another headless component; may nest.
  - The child belongs to _this_ component: `onEmit`/`onFailure` return this component's messages.
  - No `view`/`slots`/`fallback` (each throws, child.ts:84).
  - A throw in `parts` fails this component (source `view`).
  - A failed composed child stays failed and blank.
  - The consumer's closure runs at e.g. `Consumer/Drawer[]/Dialog[]`.

**Part application rules** (`View.makePart`, View.ts:1172; partsRun.ts):

- `decorate` gets a _blank_ builder of the consumer's class and tag. It never sees the consumer's settings and must return a builder.
- A part may not set `key` or apply another part (throws).
- A part's attributes overwrite the consumer's.
- Token-list attributes (`class`, `rel`, `aria-controls`, `aria-describedby`, `aria-flowto`, `aria-labelledby`, `aria-owns`; `tokenListAttributes`, View.ts:195) are _added_ with dedup, whether the consumer set them before or after applying the part.
- A part can remove a non-token attribute with `attr(name, undefined)`, but never the consumer's tokens.
- Props merge (part wins).
- Handlers, event options, ref, mount and tokens become one `Owned` layer.
- Part children come after the consumer's earlier children. Part `forward` hooks are appended.
- The result is the chain type, not the callable root, so `menu.trigger(h.button)("Open")` doesn't compile.

**Event dispatch across layers** (partsRun.ts:94-140):

- Layers are sorted deepest owner first (longest path), the consumer last.
- Each layer's handler fires to its owner.
- `preventDefault: true` cancels only when _that layer's_ handler produced a message.
- `"always"` from any layer wins.
- Two layers setting any other option of one event fail the render (dev, devOn.ts:117).
- A part applied outside its owner's view (owner closed) throws (dev).
- A part's ref and mount belong to its owner (`HtmlCommand.focus` in the headless update reaches it). The mount runs in the headless instance's Scope while the part stays applied.

Other types:

- `PartsContext { owner, running?, queries?, shared? }` (:1521): plain data, so `Story.parts` builds parts without a runtime.
- `Composed`, `Composed.Parts/Requirements/Shares` (:1753)
- `PartBuilder<T>`, `PartTag<T>` (:1804)
- `Headless.Any/Requirements/Parts` (:1559)

### 1.10 Shared state (owners and readers)

Types:

- `Shared<Name>` (:316): the requirement token, keyed by name at the type level. At runtime the _exact definition_ must match, not just the name.
- `Shared.Of/Any/Value/Receives/Report` (:328)
- `SharedRead`, `SharedReads`, `SharedOwner`, `SharedValues`, `SharedHelpers`, `SharedRequirements` (:433-520)
- `SharedLookup`, `SharedRecord` (:1540)
- `SharesCollects { schema; onChange(collected[]) }` (:2444)

**`shares`** (owner side, :3090):

- `value(model, props, reads)` gets the owner's own reads too, so an owner can derive from owners above it. To read its own kind, it needs a `schema` or an annotated return type.
- Every owner update re-runs the owner's closure, and every reader re-renders on change, so keep the value small.
- `schema` encodes the value in a reader's `Update` on the Wire; without it, encoding is best-effort via `MessageLog.structural`.
- `receives`: the tags readers may `$.send`.
- `collects.onChange(reports[])`
  - Reports come in no promised order.
  - Dispatched once a render pass has nothing left to render, and only when the message differs from the last one (initial baseline `onChange([])`).
  - Kept or hidden readers contribute no reports.

**`reads` entries** (reader side, :3080):

- `Owner` alone is shorthand for `{ owner }`.
- `optional: true`: the read is `undefined` without an owner, there is no `Shared.Of` requirement, and sends are dropped and logged `SendDropped`.
- `report(model, props, id)`: the reader's contribution to `collects`; `id` is the same as `p.id`/`h.id` of the reader.
- `onChange(value) => Msg`: delivered once per owner round before the next render, with the latest value. Only one `onChange` per owner across aliases.
- `owner: "self"`: the nearest instance of the same component above. Must be `optional: true`, the component must have `shares`, and `shares` should be written before `reads` so the types resolve.

**Runtime** (sharedRun.ts, shared.ts):

- An owner is found by walking up the paths (including the `under` placement path of kept children) and taking the longest-prefix live owner whose definition is the same object (:85-110).
- A missing required owner fails the reader. The error says either "and no X is above it" or "but a different component with the same name is above it at …" (:113).
- Owner value equality uses `sharedEqual`; an unchanged value does nothing (:236).
- Value changes mark readers dirty. Readers with `onChange` get a queued round (:244).
- An owner that also reads others refreshes at render time, once its props are final, so readers never see a value built from stale props (`rendered`, :259).
- Loop guards: more than 100 `onChange`/`collects` passes per owner per flush fails the owner (`"shares"`). More than 100 send rounds per sender per flush fails the sender (`"send"`) (:283, :395).
- Kept (hidden) readers stop reporting (`drawn` hook, :48).
- Without a host, `$.reads` for a required owner throws lazily: "nothing supplies it: render it below a X" (shared.ts:73, `unsupplied`).

`Mountable.update(model, msg, props, queries?, shared?)`: without `shared`, reading a required owner throws.

### 1.11 Query-shape types (:1983-2210)

- `QueryOne`, `QueryMany`, `QuerySpec`, `Queries<C>`, `SingleNames`, `InfiniteNames`, `KeyedNames`, `QueryServices<L>` (the queries themselves join `R`, never their fetchers' needs).
- `QueryResultOf<D>`
  - single query: `AsyncResult<Success, Error>`
  - infinite query: `AsyncResult<InfiniteData>`
  - `queryMany`: `KeyedResults`
  - A single or infinite query holds the result for the current args, else `Initial` (waiting while enabled).
- `InfiniteData { items (patched pages flattened, first item per definition key wins), pages, more: Query.More }`
- `KeyedEntry { args, result, patched }`
- `KeyedResults` (array plus `get(args) => Option`; a key with no settled result is `Initial`; entries carry no key, so write `.key()` by hand)
- `KeyedChange`, `ArgsFor`, `OnChange`

### 1.12 `Mountable` / `Component` / `Members` (runtime-visible shape)

`Mountable.Members` (:1097) fields:

- `definition`, `props`, `model`, `message`, `events`
- `init(props) => Next`
- `update(model, msg, props, queries?, shared?) => Next`
- `view(model, props, running?, queries?, path?, shared?, lazy?) => Node`
  - path defaults to `/<name>`;
  - without `lazy`, `h.lazy` rebuilds every time;
  - without `running`, nothing is running.
- `subscriptions?`, `head?`, `elements`
- `layer?(props, keys)`, `layerKeys?`, `layerFailure?`, `sharedLayer?`, `layerOnServer`, `~queries`

These are pure entry points that Story uses without a runtime.

Other types:

- `Component<Name, Props, Model, Msg, Events, R, V, L, Sl>` (:1270), `Members` (:1292)
- `Variance` (:1250): Props invariant, Events/R covariant, Sl contravariant. Because of this, a union of slot-less components is callable.
- Utility types: `Any`, `Props<C>`, `Events<C>`, `Requirements<C>`, `Model<C>`, `Message<C>`, `Slots<C>` (:1894-1980)

Components are functions whose fields are set with `defineProperty`, to avoid dictionary mode at more than 15 properties (:2286).

### 1.13 `Component.provide` (:4298) and its options

**Forms:**

- `provide(C, layer | layer[] | (props) => layer | { key, layer }, options?)`
- curried `provide(layer…, options?)(C)`; the curried form can't take `onFailure`, so a fallible Layer there is a type error (`CurriedCantFail`)
- keyed curried form, with `KeyTakes` checking the Model parameter

**Options:**

- `ProvideOptions { onFailure (required if the Layer can fail), local?, server?: false }` (:3820)
- `LocalOption` (:3850)
- `ProvideKeyed { key(props, model), layer(key) }` (:3939)
- `ProvideKeyedOptions` (`local: never`; `onFailure` required if fallible, and optional for infallible Layers but still called on a defect) (:3952)

**Type helpers:** `Provided<C, ROut, RIn>` (:3863), `RuntimeService` (:3901; never removed by `provide`: framework services, `Query.Visibility`, `Query.Connectivity`, `Query.Problems`, and every `Shared` requirement), `ProvideInput`, `ProvideRest`, `RequiresOnFailure` (:3916-4060).

**Semantics** (:4140-4240, layerRun.ts):

- Returns the same component with `R` becoming `Exclude<R, ROut> | RIn`; name, Model and message are kept.
- A Layer _value_ is built once per (Env × Layer identity), reference-counted, and shared between instances resolving from that Env; the last instance out closes it (layerRun.ts:370-420).
  - A memoised Layer inside it is shared per Env via `Layer.CurrentMemoMap.forkOrCreate`.
  - Sibling Envs build their own.
  - Like nested `Effect.provide`, a provide reuses what an Env above built; `Layer.fresh` forces a rebuild.
- `{ local: true }` or a props function builds once per instance at mount.
- An array is merged once with `Layer.mergeAll` (elements don't see each other).
- Props changes never rebuild; re-key instead.
- Nested provides: the inner wins and can use the outer's services. The handler closest to the component wins for `onFailure`.
- Builds run in the background. The component renders from `init` at once; Commands and Subscriptions wait for the Layer (`LayerPending` / `LayerReady` log entries).
- **Failure:**
  - With `onFailure`, it's mapped to a message; the component stays mounted, feature children below show `fallback`, and waiting Commands are interrupted. Retry means re-keying.
  - Without a handler, the instance fails (`"layer"`).
  - On the server, a handled failure is replaced with a redacted cause (`slotStatus.serverFailure`, which has no stack and stays stable across server and client). It's logged `LayerFailed { redacted: true }`.
- **`server: false`:** the server never builds the Layer and defers the instance; the client builds it fresh. Any opt-out in a nested chain keeps all of them off the server.
- **Keyed provide:**
  - The key is read once per flush, before the view, only when model or props changed, and compared with `Equal.equals`.
  - On a change: the Model is kept; in-flight Commands are interrupted; Subscriptions and queries restart; query results reset to initial. Commands issued in the flush that changed the key run against the new services.
  - The previous selection is released once the new one has built; a selection still building is interrupted.
  - Each feature slot below shows `fallback(AsyncResult.initial(true))` (`LayerPending` status `Rebuilding`).
  - A failed build doesn't fall back to the previous selection. Until the next key change, new Commands run against the _parent's_ services, and Subscriptions and queries wait.
  - A keyed provide disables sharing for every provide on that component; use a `LayerMap` to share.
  - The query cache isn't cleared, so put the selection in the query args.
  - On the server the key is read from `init`'s Model; the client reads it from the hydrated or restored Model.
  - A key function that throws becomes a defect and the build fails (layerRun.ts:22).

### 1.14 `Component.lazy(name, load)` (:4594; internal/lazy.ts)

- Returns `Lazy<Props, Events, R, Sl>`, callable like the component and with `preload(): Promise<void>` (never rejects).
- `name` stands in for the path name before the module arrives (Scene errors and the log show it).
- The first child rendered starts the load, once per app. The `fallback` gets `Initial` while loading and `Failure` if the load or the child fails. After loading, children mount at once without a fallback.
- A failed load: the next child that mounts loads again. `preload` also retries after a failure, since state `Failed` is neither `Loaded` nor `Loading` (lazy.ts:93).
- `onFailure` hears only child failures, not load failures.
- `load` must resolve to a non-headless component; anything else, or a throw, fails the load ("loaded no component that can be called").
- Server: waits for the load and renders. Client: doesn't load before hydrating, so it replaces the server nodes with the fallback, then with the component.
- An inert host (server pre-pass) doesn't start loads (lazy.ts:52).
- Kept-alive lazy children keep their fallback while loading.
- Provide module-only Layers inside the lazy module so they land in its chunk.

## 2. `View.ts`

### 2.1 Node model

- `Node = Element | Text | Child | Outlet` (:56)
- `Outlet { _tag, name, noText? }` (:76)
- `Text` (:96)
- `Element { tag, elementKey, attrs, props, handlers, eventOptions, refKey, mount, owned?, children }` (:234)
  - `attrs` are strings; `props` are host-interpreted.
  - Handlers are keyed by event, so re-render never touches listeners.
  - Unkeyed elements match by position.
- `Child` (:354): see §1.8; adds `alive?` and `owner?`.
- `Handler<Msg, Payload> = Msg | (payload) => Msg | undefined` (:115). Payloads are plain data; no host event object ever reaches component code.
- **`EventOptions.preventDefault: boolean | "always"`** (:144)
  - `true` prevents only when a message was produced (a message _value_ always prevents).
  - `"always"` prevents regardless.
  - Nothing stops propagation: the host gives an event only to the innermost element with a handler for it, even if that handler returns `undefined`.
  - Vocabularies may extend the options; unknown keys are ignored.
- `Owner { path, depth }`, `Owned` (:156-183)
- `Mount<Msg>`, `MountHint` (:265, :281)

### 2.2 Content and children

- `Input`, `Children` (:567, :586)
  - Use `C extends View.Children<Msg>` to keep requirements. Annotating `Children<Msg>` erases them.
- `Content` (:598), `Requirements<T>` (:611)
- `text(s)` (:627)
- `children(inputs)` (:643)
  - Flattens arrays; drops `false`, `null`, `undefined` and `""`.
  - Builders become elements.
  - **Adjacent text merges**, so server HTML hydrates without separator comments.
- `isElementBuilder`, `toNode`, `build(builder, inputs)` (:693-735)
  - `build` puts the builder's held children first, then the given ones, and runs `forward` hooks.
- `Forward`, `withForward`, `withContent`, `withNoTextContent(builder, inputs, vocab)` (:774-890)
  - `withNoTextContent` throws `<tag> can't hold text in the X vocabulary; text goes inside …` and marks outlets `noText`.
- `withFields(builder, fields)` (:962): every chain method copies; builders are immutable values.

### 2.3 `ElementBuilder` (:1392), `ContainerBuilder` (:1761), `Shorthand` / `shorthand` (:1840, :1858)

| Method | Semantics | Ref |
| --- | --- | --- |
| `on(event, handler, options?)` | Setting the same event again replaces both the handler and its options. | :1512 |
| `key(k)` | Unique among siblings. Duplicate `tag[key]` siblings throw in dev (devOn.ts:12). | :1534 |
| `attr(name, value \| undefined)` | `undefined` removes the attribute. On a part's blank builder it records a removal. | :1544 |
| `attrs(record)` | Removes keys whose value is `undefined`. | :1570 |
| `prop(name, value)` | Host-defined meaning. | :1611 |
| `ref(Renderer.Ref<HostNode>)` | For ref Commands within the rendering instance. The ref's node type must match. | :1623 |
| `onMount(issuedMount)` | Runs after commit in a Scope that lives with the element and survives patches. | :1666 |
| `forward(place)` | Wraps the finished element. | :1739 |
| `children(...inputs)` | Container only; appends after held children. | :1800 |

`onMount` details:

- A result message comes back to the component; `noop` is silent.
- The body runs once per element. Later args arrive through its `changes` Stream when they differ by the args Schema's equivalence.
- A different mount definition stops the old one and starts the new one; a render without a mount stops it.
- A defect fails the instance.
- It never runs on the server or TestHost.
- A second `onMount` on one element throws.
- An `Effect<void>` body is rejected (`MountHint`).

`forward` details:

- `place(finished)` returns an element (it throws if `place` returns something else, :793).
- The key goes on the _outer_ returned element; ref, mount and handlers stay on the inner one.
- With multiple hooks, the last one set runs first (outermost markup), so the first one's attribute writes happen last.

A builder is valid content by itself. `shorthand` makes `h.span("x")` equal `h.span.children("x")`; the call returns a non-callable builder, so `h.div(a)(b)` doesn't compile.

### 2.4 Parts

- `Part<Tag, Args, R>` (:1092)
- `PartTarget` (:1116): structural, so callable roots keep their chain type.
- `PartRequirements` (:1128)
- `wrapPart(part, wrapper)` (:1157): carries a part's `~R` onto a wrapper (identity at runtime).
- `makePart` (internal, :1172)

### 2.5 Helper

`HelperBase<Msg, Props>` (:2024):

- **`props`**
- **`el(tag, ...children?)`**: with a vocabulary that declares `textParents`, a tag outside that list gets a no-text builder (:2239).
- **`isRunning(Cmd, ...group)`** (:2049)
  - True while a run (of the group, if given) is queued, running, awaiting, or stopping until fiber exit (cleanup included).
  - Ends when the run's message is delivered, or at fiber exit for a run that sends nothing.
  - View-only; `update` can't read it, so decisions belong in the Model.
- **`id(name, key?)`**: path-derived.
- **`lazy(fn, ...args)`** (:2091, impl :2193)
  - Memoised by first argument (or `fn` itself when there are no args), compared with `===` on `fn` and every arg against the last render.
  - Reused nodes that hold only elements and text skip the patch; only controlled props are re-applied.
  - `fn` must be stable (declared outside the view) and pure in its args. What it reads off `h` (e.g. `isRunning`) may be stale.
  - A first argument already used by another call in the same render is rebuilt every render.
  - Unused entries are dropped at the end of the render.
  - A render that throws discards the store.

`Helper` adds `text(s)` (:2010).

Vocabulary types:

- `WithTags`: a vocabulary's own `text` tag replaces `Helper.text` (:1992).
- `Tags<V, Msg>` (:1979)
- `Elements { Msg, Tags, Host, Head?, HeadValue? }` (:1890)
- `Vocabulary { name, tags, textParents?, head?: HeadFold, Elements? }` (:1949)
- `HeadEntry`, `HeadValue`, `HeadFold` (:1906-1940)
- `KeepAlive<Msg, Ends>` brand (:522). Gotcha: typing a parameter as `View.Helper` drops the brand, so a component called with that `s` is kept with no key check.
- `LazyStore` (:2148)

### 2.6 Queries over views

- `textOf(node)` (:2342): a child contributes only its slot content's text.
- `nodes(node)` (:2364): document order; slot content follows the child.
- `slotNodes` (:2383)

Internal: `makeHelper` (:2310; per-vocabulary helper class with tags on its prototype), `readsPathLazily`/`takesPathSource` (lazy path for `h.id`), `Lazies`, `Running`, `idOf`, `noFields`.

## 3. `UiSchema.ts`

- **`TaggedEnum(casesByTag)`** (:183) returns a `Schema.TaggedUnion` plus:
  - an unchecked constructor per case (`{...args, _tag}`, no validation, checks or defaults: fields with constructor defaults are required, and branded fields need branded values);
  - `is(tag)`, which checks `_tag` only;
  - `match` (exhaustive, data-first or data-last), `matchOrElse`, `cases`, `guards`, `isAnyOf`, `tag`.
- `annotate`/`check`/`rebuild` keep the constructors (`Rebuild`).
- A case declaring its own `_tag` is a type error and throws at build time.
- `ReservedTag` (`ast`, `annotate`, `cases`, `is`, `match`, `make`, `pipe`, `name`, `Type`, Function and Object members, …) is a type error.
- Numeric keys become string tags.
- Use `cases[tag].make` for validated construction.
- Types: `TaggedEnum<Cases>`, `TaggedEnum.Base`, `.Constructors`, `.ReservedTag` (:46-129).

## 4. `UiStruct.ts`

- **`evolve`**, dual (`evolve(self, fields)` or `evolve<S>(fields)(self)`) (:156)
  - Each field takes a value, or an updater `(old) => new`; a function is _always_ treated as an updater.
  - No type change per field. No deep merge.
  - Returns the _same object_ when every field is `Object.is`-equal; otherwise a shallow plain-object copy.
  - Class instances lose their prototype, so use `$.set` for class Models.
  - Unknown keys are only caught in literal fields; use `satisfies UiStruct.EvolveFields<M>` for fields declared elsewhere.
- **`EvolveFields<S>`** (:47) yields readable error strings for: unknown `S` ("write evolve<Model>"), unions including nullable ("match the union first"), arrays, primitives and functions, empty structs. A field that may hold a function is `never`.

## 5. `html/Html.ts`

### 5.1 Host and refs

- **`Html.Host`** service (:134): `focus`, `blur`, `scrollIntoView`, `measure => Rect`, `select`, `requestSubmit => boolean`, `showPicker => boolean`.
  - Registered as a `FrameworkService` (never appears in `R`).
  - `mount` requires it for an HTML root.
  - Fake it in TestHost with `Layer.succeed`.
- Models: `Rect`, `FocusOptions { preventScroll? }`, `ScrollOptions { behavior, block, inline }` (:160-195).
- **`ref(name, tag)`** returns a `Renderer.Ref<HTMLElementTagNameMap[tag]>` (:1586). Attaching it to another tag doesn't compile. For list rows use `Row.at(id)`.

### 5.2 Events and payloads (plain data)

- `PointerPayload` (:225): `click`, `dblclick`, `contextmenu`, `mousedown`, `mouseup`, `pointerdown`.
  - `pointerType` is `""` for keyboard or script clicks; otherwise read from the preceding `pointerdown`.
- `HoverPayload` (:251): `mouseenter`/`mouseleave`. Occlusion gives a leave and enter at the same position.
- `KeyPayload` (:282): `key`, modifiers, `composing` (true including the key that ends the composition), `repeat`, `editable` (innermost target through open shadow roots), `selectionStart`/`selectionEnd` (`null` for email and number inputs).
- `ValuePayload`: textarea/select `input`/`change`, with `value`, `composing`, `inputType` (`""` for `change`).
- `InputPayload`: `checked`, `files`.
  - A `File` isn't plain data: pass it to a Command and keep only facts about it in the Model.
  - With a file input plus `.value("")`, the host empties the input after `change`, so the same file can be chosen again.
- `PastePayload { text }`
  - `""` if unreadable.
  - With `preventDefault: true`, a handler that returns a message cancels the paste, so the Model decides.
- `CompositionPayload { value }` (`compositionend`)
- `SubmitPayload { fields (first value per name), entries }`: files are excluded; the browser submission is **always** prevented.
- `TogglePayload`, and `PopoverTogglePayload { open, newState, oldState }`. Browsers coalesce toggles, so follow `open`/`newState`.
- `ScrollPayload`, `DropPayload { data, files, x, y, width, height }`, `DragOverPayload`, `DragEndPayload { dropped }`
- `FocusWithinPayload { within }`, `FocusPayload { focusVisible }`, `BlurPayload { disabled }`, `FocusOutPayload`
- `Events` (:654): the shared set.
  - `focus`, `blur`, `mouseenter`, `mouseleave` and `scroll` don't bubble.
  - Drag-target events go only to the active drop target.
  - `pointerdown` starts every press; a `mousedown` may not follow.
- `EventsOf<K>` (:698) adds:
  - `input`/`change` on `input`, `textarea`, `select`;
  - `compositionend` on `input`, `textarea`;
  - `submit`/`reset` on `form`;
  - `toggle` on `details`;
  - on `dialog`: `toggle`, `close { returnValue }`, `cancel { cancelable }`;
  - `load`/`error` on `img`, `iframe`, `video`, `audio`.
- Drag types: `PopoverMode`, `DropEffect`, `EffectAllowed`, `DragSourceOptions`, `DropTargetOptions` (:442-570).

### 5.3 Builders: `VoidElement` (:755) and `Element` (:1128)

Both re-type `onMount` and `forward` to keep the HTML methods; `Element` adds `children`.

| Method | Semantics |
| --- | --- |
| `id(id)` | Sets the `id` attribute. |
| `style(Style)` | camelCase or `--custom` keys; vendor prefixes become `-webkit-…`. Falsy values are skipped. Each call **replaces** the style; an empty result removes the attribute. Not parsed, so don't pass untrusted values. Needs CSP `style-src-attr 'unsafe-inline'`. Declarations written via `element.style` (e.g. by `onMount`) survive view style changes and win, except shorthands set to `var()`. |
| `class(...tokens)` | Falsy tokens skipped; `true` and numbers are type errors. Replaces the earlier class. Empty removes the attribute. |
| `disabled(b)` | Boolean attribute. |
| `value(s)` | **Controlled** (`input`, `textarea`, `select`). A file input only accepts `""`. |
| `checked(b)`, `selected(b)` | Controlled. |
| `open(b)` | Controlled (`details`, `dialog`); non-modal on a dialog. |
| `modal(b)` | Writes `prop("open", "modal" \| false)`; `open`/`modal` share state and the last call wins. |
| `popover(mode, open)` | Writes `attr("popover", mode)` plus `prop("popoverOpen", open)`. |
| `draggable(data, { effectAllowed }?)` | Stores `dragstart` options and sets `draggable="true"`. |
| `on(event, handler, options?)` | Without options, keeps existing `draggable`/`dropTarget` options for `dragstart`/`drop`. |
| `dropTarget({ accepts, dropEffect })` | `drop` gets `preventDefault: "always"`. |

Controlled-property rules (module doc :28; TestHost/play via `controlled.ts`):

- The host puts the Model's value back after every patch and after every event that could change it.
- An IME composition is left alone until `compositionend`.
- When writing a focused field's value, the selection is preserved: a rejected edit restores it, and a normalized value keeps it relative to the surrounding text.

Modal dialog:

- The host cancels close requests (Escape, and backdrop clicks via `closedby`) and sends `cancel`; without a `cancel` handler they're ignored.
- Browsers may force-close after repeated cancels (Chromium 153). The host re-shows on the next frame if the Model still says `true`, which moves focus.
- `method="dialog"` neither closes nor sets `returnValue`; read the choice in `submit`.
- `close` fires on every close except the host's own modal↔non-modal switches.
- The server renders modals and popovers **closed**; they're shown once the page is live.

Popover:

- `"manual"` is controlled at every commit, whether or not the component rendered; changes from elsewhere are reverted on the next frame.
- `"auto"` is followed: the browser closes it and reports `toggle`, and the Model must follow. The host acts only when the Model's value _changes_, and never reverts the browser.
- Removing a showing popover closes it without a `toggle`.

Drag and drop:

- The active target is the innermost accepting target on the pointer path.
- `dragenter`/`dragleave` go only to the active target. Exactly one `dragleave` follows a `dragenter`.
- `dragover` is rate-limited to one per animation frame, only when the position changed, and dropped when the target stops being active.
- Accept or handler changes take effect at the next `dragenter`/`dragover` or drag end.
- Nothing is sent once the `dragleave` handler is removed or the component is gone.

### 5.4 Vocabulary

- `ClassToken`, `StyleValue`, `Style` (:1196-1230)
- `classNames(...tokens)` (:1263): no dedup, no splitting.
- `containerTags` (:1282): includes `textarea`, `select`, `option`, `dialog`, `details`, `canvas`, `iframe`, `video`, `search`, `menu`.
- `voidTags`: `br`, `col`, `hr`, `img`, `input`, `source`, `track`, `wbr` (:1380).
- `ContainerTag`, `VoidTag`
- `Tags<Msg>` (:1419): document-level tags (`html`, `head`, `body`, `title`, `meta`, `link`, `base`, `script`, `style`) are excluded; use `head` and `HtmlHead` instead.
- `Elements` (:1442)
- `H<Msg>` (:1487): a reusable view-function helper; props are `unknown` and there are no queries (use `Component.Helper<D>` for those).
- `Elements` phantom value, `name = "html"`, `tags`, `vocabulary` (:1497-1544). Prefer `Html.vocabulary` over passing the module, for tree-shaking.
- `component` (:1571): `define({ ...options, elements: vocabulary })`.

### 5.5 Custom elements

`customElement({ tag, properties?: { name: Schema }, events?: { name: Schema } })` (:1888) returns a `CustomElementBinding`, called as `Binding(h)` to get a shorthand root.

- **Tag name:** a non-custom-element name throws.
- **Properties:** one method per declared property (except reserved names, `CustomElementReserved`, :1603).
  - Written as a JS property, unencoded.
  - Rewritten when not `===` to the last value written.
  - Reset to `""`, `false` or `null` when a render omits it.
  - Not rendered on the server; set at adoption.
  - `value`, `checked`, `selected` and `open` are plain (not controlled) on custom elements.
- **Events:** `on(event)` decodes `detail` with the event's Schema.
  - Invalid detail: `console.error`, no message.
  - A `null` or missing detail is retried as `{}`.
- **Builder types:** `CustomElementBuilder` (`prop` restricted to declared names, :1642), `CustomElement`, `CustomElementConfig`, `CustomElementBinding` (:1719-1810).

## 6. Internals with observable behavior

### 6.1 `child.ts`

- Builds the `Child` record. Defaults: `key ""`, frozen `{}` props, and ignore for `onEmit`.
- A per-tag `onEmit` record dispatches by `_tag`.
- `compose` refuses `view`, `slots` and `fallback`.
- `expand` threads composed parts and routes a throw to `failed(owner)`, which fails the owner later and renders blank.
- `replace` exists for HMR.

### 6.2 `paths.ts`

- Segment escaping (§1.8).
- `checkChildPaths` throws `"<path> renders two children at Name[key]"` with a key hint. It skips subtrees unchanged since the last render (`h.lazy` reuse).
- Fallback children share the parent's paths; only the failed child's path is freed.
- Slot double-placement throws, including across author trees.

### 6.3 `keptRun.ts`

- Kept children are parked into `host.createContainer()`; a host without it fails the author.
- Mounts are detached while kept.
- Log entries `Kept` / `Drawn`; `tree.drawn` notifies shared-state reporting.
- A component written with both `h` and `s` at one key in one render fails the author: "writes X twice in one render".
- Switching `h` → `s` keeps the instance, which is kept from then on.
- A kept child that failed is shown with its fallback when redrawn.
- A predicate returning false, or throwing (which fails the author), ends the child (`tree.ended`).

### 6.4 `partsRun.ts`

- Event-layer merge and ordering (§1.9).
- `Mounts` tracks part mounts per (owner, name), so a re-render keeps the same running mount.

### 6.5 `sharedRun.ts` / `shared.ts`

See §1.10. Dispatch sources are logged: `Shared` (with name, path, seq), `Collected`, `Send`, `SendDropped`.

### 6.6 `slotStatus.ts`

`serverFailure()`: a stack-less "A provided Layer failed on the server" defect. Server and client both pass it to fallbacks, so the fallback DOM matches.

### 6.7 `controlled.ts`

Test-only. TestHost records the Model's wanted value for controlled props (`setProp`), and Play restores it after simulated edits (play.ts:144), mirroring the browser host's put-back.

### 6.8 `lazy.ts`

State machine `Idle → Loading → Loaded | Failed`. Listeners settle the waiting placeholders. Not started on inert hosts.

### 6.9 `layerRun.ts`

See §1.13. Also:

- A Layer build interrupted by a prior teardown is retried once closing fibers drain.
- Server deferral via `server.defer(inst)`.
- `tree.served(inst)` (`"Ready"` / `"Failed"`) lets a client adopt the server's Layer status (`~status` in the state). A failed status settles the Env with `serverFailure` and logs `LayerFailed { redacted: true }`.

### 6.10 `stateCodec.ts` / `schemaRedact.ts`

- State = `Schema.toCodecJson(model)`, or `Struct({ model, queries })` when queries are bound.
- If the Model or query schema holds `Redacted` anywhere (`holdsRedacted` walks fields, index signatures, arrays, unions, suspends, declaration type params and encodings), encode and decode fail with `Forbidden("the Schema holds a Schema.Redacted")`, so the instance is not serialised.
- An owner's last `collects` message is saved under `~reported` (also refused if the message schema holds `Redacted`).
- `redactAST` replaces Redacted encodings with `{ "~redacted": true }` placeholders that can't be decoded; used by the log.

### 6.11 `stateRestore.ts` (history)

- On save:
  - `restore === false` skips the instance; its children are still visited.
  - A `restore` function is applied, and a throw skips the instance (warned once per component).
  - Encoding may be async.
- Kept children are saved under `~kept<rootPath>` / `~kept`, keyed by author path.
- On init: the decoded Model and query results are adopted. Patched (optimistic) query snapshots are dropped and the cache is re-seeded.
- **`init`'s Commands, lists and sends still run; `init`'s emits are dropped** (:385).
- Decode failure falls back to `init` (`onDecodeFailure`).
- An async decode holds the child's placement until it settles.

### 6.12 `hydrateRun.ts`

- Server state is keyed by instance path. Special keys: `~deferred` (paths the client builds fresh), `~status` (Layer status), `~kept`, `~reported`, `~query` (shipped cache), `~static`.
- On adoption: Model and results come from the server; **`init`'s Commands, lists and sends still run, and emits are dropped** (:330/:360).
- Owners get the reported baseline and `restored()` re-collects after settle.
- Event listeners on adopted nodes stay **inert until the instance's Layer Env settles**, then attach (`adoption.live`). Logged `Waiting`, then `Mounted { adopted: true }`.
- An async decode, or a child behind a pending Layer, holds the subtree and resumes adoption on a placeholder.
- A kept child re-drawn before its Layer is ready is rebuilt fresh.
- `adopted` resolves when everything is settled and parked; the query-cache "fetch-free window" closes then or at the first navigation.

### 6.13 Dev-mode checks (`#dev` → devOn/devOff)

Compiled out in production:

- duplicate sibling element keys;
- slot placed twice across a headless closure;
- layer option conflicts and parts applied outside the owner's view;
- a feature child without `fallback`;
- a root placing a slot;
- fallback path collisions.

### 6.14 Failure semantics (`kernel.fail`, :470)

- Sources (`FailedIn`): `init`, `update`, `view`, `event`, `onEmit`, `onFailure`, `fallback`, `layer`, `command`, `subscription`, `mount`, `head`, `send`, `shares`, `shared`.
- On failure:
  - logs `Failed { in, name?, cause, update?, issued? }`;
  - closes the instance's Scope;
  - swaps in the parent's `fallback(AsyncResult.failure)`, or blank;
  - **schedules** `onFailure` to the parent, or to the `p.child` owner;
  - reports through the tree's problems sink.
- A root uses the mount-level `tree.fallback`. A throwing fallback is logged `in: "fallback"` and renders empty text.
- A failed child stays failed until its key changes.

## Notable concepts not in LLMS.md

These terms were checked with grep against `/tmp/effect-ui/LLMS.md`.

- **`$.combine`**: a left fold of update functions; Commands, emits, lists and sends concatenate; `props`/`queries`/`reads` stay frozen at the update's start.
- **`Def.fragment((h, ...args))`**; `Component.Helper<typeof Def>`; the per-tag record `update` having no default key.
- **`$.loadMore` / `$.reset`** for infinite queries (reset keeps `history.state` small). `InfiniteData.items/pages/more`; `KeyedResults.get`; **`h.previous` / `h.patched`**; query `onChange` for `queryMany` with `changes`.
- **`h.lazy(fn, ...args)`**: memoization rules, controlled props re-applied, skipped patches.
- **`h.isRunning` / `p.isRunning` exact lifetime** (queued → stopping including cleanup; ends at message delivery); `h.id` / `p.id` escaping scheme.
- **`$.viewTransition` timing details**: flush deferred about a frame, type merging and drop rules, roots conflicting in one frame, reduced-motion skip.
- **Send/onChange loop guard (100 per flush)**; owner lookup by exact definition plus the "different component with the same name" error; reader values refresh at render time for owners that read others; `collects.onChange([])` baseline and dedup; hidden or kept readers don't report.
- **Keyed `provide({ key, layer })`**, `local: true`, `server: false`, shared-per-Env Layer refcounting and MemoMap; failure-to-parent-services fallback; query cache not cleared on key change; `RuntimeService` never removed; curried form can't take `onFailure`.
- **Hydration and restore re-run `init`'s Commands, lists and sends but drop its emits.** Adopted listeners stay inert until the Layer Env settles. `~deferred`/`~status`/`~kept`/`~reported` state keys. Server Layer failures are redacted to a fixed defect so fallbacks match.
- **`Redacted` detection walks the entire Schema AST**, including query args/success/error and declaration type params; `~redacted` placeholder in the log.
- **Part application algebra**: blank builder, token-list attributes additive, attribute removals, no key or nested parts, `forward` hook ordering (last set is outermost), deepest-owner-first event layers, `"always"` dominance, option conflicts fail in dev; `View.wrapPart`; `PartTarget` structural typing.
- **`forward` key semantics** (the key goes on the outer element; ref, mount and handlers stay inner).
- **Text normalization**: adjacent text merges and empty text is dropped (no hydration separators). `textParents` and `withNoTextContent` for native vocabularies; `Outlet.noText`.
- **Child path escaping** (`%5B`, `%2F`, `%25`); branch-swap instance sharing; a list of one unkeyed row keeps its instance; HMR identity mapping (`child.replace`).
- **keepAlive predicate must read from its argument**, or it throws; host `createContainer` requirement; `h`→`s` switching rules.
- **`Component.lazy` retry semantics**: `preload` reloads after a failure; inert hosts don't load; non-headless requirement.
- **Html specifics**:
  - `customElement` (properties, events, reserved names, detail decoding);
  - `draggable` / `dropTarget` (active-target model, `dragover` frame throttling);
  - payload fields (`editable`, `selectionStart`/`End`, `inputType`, `focusVisible`, `within`, `disabled`);
  - file input `.value("")` reselect trick;
  - `style()` CSP and `element.style` survival;
  - `class` / `classNames` falsy tokens;
  - server renders modals and popovers closed;
  - modal re-show after forced close;
  - `Html.Host` operations (`measure`, `showPicker`, `requestSubmit`).
- **`UiSchema.TaggedEnum` gotchas** (unchecked constructors, reserved tags, numeric keys) and **`UiStruct.evolve`** returning the same reference when nothing changed.
- **Dev-only checks** (`#dev` import condition) and the complete `FailedIn` source list.
