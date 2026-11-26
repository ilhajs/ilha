# `@ilha/model` 0.2 (+ `ilha` 0.16.4) — target spec

This is the whole deliverable in one release, with no phases. `@ilha/model` becomes Effect UI's component runtime running inside Ilha islands.

**Versions.** `@ilha/model` 0.2.0. `ilha` 0.16.4, `@ilha/void` 0.1.8, `@ilha/astro` 0.4.4, `@ilha/devtools` 0.1.4.

**Core prerequisite: typed `h()`.** `HFn` in `packages/ilha/src/vnode.ts` gains the element types JSX already has, with no new strictness rules:

```ts
<K extends keyof JSX.IntrinsicElements>(type: K, props: JSX.IntrinsicElements[K] | null, ...rest: View[]): VNode;
(type: `${string}-${string}`, props: PropBag | null, ...rest: View[]): VNode; // custom elements stay open
```

- The typed-props component overload and the `Fragment` / untyped-component overload stay.
- An unknown non-custom tag, a misspelt attribute or a wrongly typed handler becomes a compile error, exactly as in JSX.
- Migrate every call site to the new types: core tests, and `@ilha/void`'s `form.ts` and `link.ts`.
- Add a type anchor and a `MIGRATIONS.json` entry.
- Model views get this typing for free, because the model `h` is core `h` with extras.

**Core prerequisite: requirements typed through the view tree.** Components get their own requirement channel, and where a component runs (server or client) is checked by the compiler.

_Core (`packages/ilha`):_

- `VNode<out R = never>` gains an optional phantom `readonly "~requires"?: R`. `View<R = unknown>` is the existing union with `VNode<R>` and arrays of `View<R>`, so a bare `View` accepts everything, as today.
- `Requires<V>` extracts `R` from a view type: `never` for text, atoms and other non-vnode parts, and the union across arrays and unions.
- A component can carry a phantom `readonly "~requires"?: R`. `ComponentRequires<C>` reads it and defaults to `never`.
- `h()` returns `VNode<ComponentRequires<type> | Requires<children…>>`. Infer the children as a `const` tuple and union their `Requires`, so mixed children don't fail inference. Elements with only plain children are `VNode<never>`.
- A JSX expression is `JSX.Element = View` (`R = unknown`), so JSX can't carry requirements.
- `class Client extends Context.Service<Client, { readonly window: Window; readonly document: Document }>()("ilha/Client")`, exported from `ilha`. The browser `mount` provides it to the effects it runs; the server never does.
- `mount(host, C)` accepts a component whose `ComponentRequires` is `never` or `Client`. `renderToString(C)` accepts only `never`. Anything else is a compile error that names the missing services.
- Add type anchors for every rule, and a `MIGRATIONS.json` entry.

_Model (`@ilha/model`):_

- A component's `R` is the union of:
  - the requirements of its `init`, `update`, Commands, Subscriptions, mounts, queries and reads;
  - the requirements of its view's return type, but only when they are known. A view returning `View<unknown>` (JSX) contributes `never`, and its children's services are checked at run time instead.
- Model components expose `R` as the core phantom.
- `Component.provide` removes what it supplies.
- `Component.root(App, props)` keeps any `Client` requirement in the root's phantom. So `mount` accepts it, and `renderToString` rejects it unless the `Client` users sit behind `Component.clientOnly`.
- `Component.clientOnly(C, { fallback })` removes `Client` from `R`. On the server it renders `fallback`. On the client it renders `C`, after hydration in the hydrate case. Its log and failure semantics are those of a lazy child.
- When a requirement isn't tracked (a JSX view) and turns out missing at run time, the instance fails. The message names the service and the path. If the missing service is `Client` during server rendering, the message also says "wrap it in Component.clientOnly".
- Docs: a "Client-only apps" page (`mount(host, Component.root(App, props))` with no server), and a section recommending `h()` views where compile-time requirement checks matter.

**Source of truth.** Effect UI, `Effect-TS/ui@117277a` (2026-11-26).

- The API inventories are in `spec/effect-ui/`:
  - `component.md`
  - `effects.md`
  - `testing.md`
  - `platform.md`
- For every feature marked **In**, the semantics are the ones those files record, including their edge-case rules and error messages, unless this spec says otherwise.
- Section references below, such as `component §1.10`, point into those files.

## 1. Scope

| Effect UI area | Verdict | Ilha form |
| --- | --- | --- |
| Components: `define`/`make`, Schemas, `$` steps, update forms, `noop` | **In** | `defineComponent` (§3) |
| `UiSchema.TaggedEnum`, `UiStruct.evolve` | **In** | `TaggedEnum`, `evolve` |
| Children: keys, paths, `events`/`onEmit`, `onFailure`, `fallback`, failure boundaries | **In** | JSX / `h()` children (§4) |
| `h.keepAlive` | **In, adapted** | Model, Commands and Subscriptions are kept. The DOM is rebuilt when the child is drawn again (§4.4). |
| Slots | **In** | §4.5 |
| Headless: `parts`, `p.part`, `p.child`, `p.id`, part algebra | **In** | Applied to Ilha VNodes (§5) |
| Shared state: `shares`/`reads`/`$.send`/`collects`/`report`/`onChange`/`"self"` | **In, adapted** | A missing owner is a runtime error, not a type error (§6) |
| `Component.provide` (Env scoping, memoised, keyed, `local`, `onFailure`) | **In, adapted** | Missing services are a runtime instance failure (§7) |
| `Feature.Service` | **In** | §7 |
| `Component.lazy` | **In** | Built on Ilha async components (§4.6) |
| `Command` (`make`, `Service`, modes, `group`, `interrupt`, `map`/`as`/`asNoop`/`match`, stream Commands, scheduler) | **In** | §8 |
| Query-coupled Command options (`invalidates`, `optimistic`, `writes`, `afterRefetch`) | **In** | With Query (§10) |
| `Subscription` (`make` with and without deps, `keyOf`, `direct`) | **In** | §9 |
| Document/window/custom/animation-frame subscriptions, `shortcuts`, keyboard matcher | **In** | `DomSubscription`, `Keyboard` (§9) |
| `Mount` (`make`, `makeStream`, `map`, `changes`) | **In** | Attached through Ilha `ref` (§11) |
| Ref Commands: focus, blur, scrollIntoView, measure, select, requestSubmit, showPicker | **In** | `DomCommand` + `Dom.ref` (§11) |
| `HtmlFiles`, `HtmlImages` | **In** | `DomFiles`, `DomImages` |
| `Query` (`Service`, `InfiniteService`, `Tag`, component `queries`, cache, host signals, SSR shipping) | **In** | §10 |
| `Validation` | **In** | `@ilha/model/validation` |
| `$.viewTransition` | **In** | The commit runs inside `document.startViewTransition` (Ilha renders synchronously on an atom write) |
| `Redacted` handling (snapshot exclusion, log redaction) | **In** | §12, §14 |
| `MessageLog` (entries, causality, Wire, sinks) | **In** | Replaces `attachModelRecorder` (§14) |
| Story / Scene / Play / Locators / fakes / `ssr()` / `fromLog` | **In** | `@ilha/model/test` (§13) |
| DevTools: timeline, causal chain, tabs, time travel, MCP tools, dispatch | **In** | `@ilha/devtools` (§15) |
| Html element builder, controlled props, plain-data payloads, drag/drop, custom-element binding, `h.lazy` | **Out** | Ilha core owns DOM rendering and events; views use JSX or `h()`. |
| Router, Route, Head, history `restore`, BrowserHost, HtmlServer, hydration host, Markdown, scheduler | **Out** | Ilha core and Void own these. |
| Canvas, OpenTUI, `@effect/ui-kit` | **Out** | Separate packages, not this deliverable. |

## 2. Package surface

**`@ilha/model`**

- Core: `defineComponent`, `Component` (`provide`, `lazy`, `root`, `noop`, `isNoop`, types), `TaggedEnum`, `evolve`.
- Effects: `Command`, `Subscription`, `Mount`, `Feature`.
- Data: `Query`.
- DOM: `Dom` (`ref`, `Ref`), `DomCommand`, `DomSubscription`, `Keyboard`, `DomFiles`, `DomImages`.
- Logging: `MessageLog`.

**`@ilha/model/validation`**: `Validation`.

**`@ilha/model/test`**:

- Test kinds: `Story`, `Scene`, `Play`, `ssr`.
- Locators: `Locator`, `DomLocator` (the role and name engine from `testing §8`).
- Fakes: `TestHost`, `TestQuery`, `TestGlobalEvents`, `TestAnimationFrames`, `TestFiles`, `TestImages`.

Every public export carries a JSDoc line. Today's whole surface is removed (§16).

## 3. Components

```ts
const CounterMessage = TaggedEnum({ ClickedAdd: { amount: Schema.Number }, ClickedReset: {}, CompletedReset: {} });

const CounterDef = defineComponent({
  name: "Counter",
  props: Schema.Struct({ label: Schema.String }),
  model: Schema.Struct({ count: Schema.Number }),
  message: CounterMessage,
  events: TaggedEnum({ Reached: { count: Schema.Number } }),
});

export const Counter = CounterDef.make({
  init: () => ({ count: 0 }),
  update: {
    ClickedAdd: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
    ClickedReset: ($) => $.run(DelayReset({})),
    CompletedReset: ($) => $.evolve({ count: 0 }).emit(CounterEvents.Reached({ count: 0 })),
  },
  view: (h, model) => (
    <div>
      <span>{h.props.label}</span>
      <output>{model.count}</output>
      <button onclick={h.send(CounterMessage.ClickedAdd({ amount: 1 }))}>+1</button>
      <button disabled={h.isRunning(DelayReset)} onclick={h.send(CounterMessage.ClickedReset())}>Reset</button>
    </div>
  ),
});
```

- `defineComponent` takes the options in `component §1.4`: `name`, `props`, `model`, `message`, `events`, `queries`, `slots`, `reads`, `shares`. There is no `restore`, `head` or `elements`.
- The `Definition` helpers from `component §1.5` exist, including `Def.update(tag, f)` slices and `Def.fragment`.
- `make` has the three overloads from `component §1.6`: view, headless with parts, and headless owner. Their `finish` checks match the inventory.
- **`$`.** `init` and `update` get `$` with the API in `component §1.3`:
  - `set`, `evolve`, `run`, `emit`;
  - `send(Owner)` and `send("self")`;
  - `combine`;
  - `loadMore`, `reset`;
  - `viewTransition`.
- **`update` forms.** `update` is a whole-message function, a record with one handler per tag (no default key), or `Def.update` slices. A handler may return a bare Model.
- **`h` in `view`.** `view: (h, model) => View`, where `h` is Ilha's `HFn` (so JSX and `h()` both work) plus:
  - `props`, `children`, `reads`;
  - `queries`, `previous`, `patched`;
  - `slots`, `keepAlive`;
  - `isRunning(Cmd, ...group)`, `id(name, key?)`;
  - `send`.
  - `h.send(msg | (event) => msg | undefined, { preventDefault?: boolean | "always" })` returns an Ilha event handler. Its `preventDefault` rules are those of `component §2.1`.
- **Purity.** `view`, `parts`, `init`, `update`, `subscriptions`, `shares.value` and query `args` must be pure. Calling an Ilha primitive (`atom`, `watch`, `when`) inside them is a dev-mode `IlhaError`.
- `noop`, `isNoop` and the `TaggedEnum` / `evolve` behaviour follow `component §1.2`, `§3` and `§4`.

## 4. Children, keys and failures

### 4.1 Calling a child

```tsx
<Counter
  key="likes"
  props={{ label: "Likes" }}
  onEmit={{ Reached: ({ count }) => PageMessage.ReachedCounter({ count }) }}
  onFailure={() => PageMessage.FailedCounter()}
  fallback={(result) => <p>Counter unavailable</p>}
/>
// or h(Counter, { key: "likes", props: { label: "Likes" }, onEmit: … })
```

- **Call options** are the ones in `component §1.8`: `key`, `props`, `onEmit`, `onFailure`, `fallback`, `slots`, and `view` for headless children. Component props stay nested under `props`, so they never collide with these names.
- **Root.** `Component.root(App, props)` returns a plain Ilha component for `mount`, `renderToString` and island adapters. A root's failure goes to the island's `onError`.
- **Authorship.** The instance whose `view` (or `view` closure) wrote a child vnode is that child's **author**.
  - `onEmit`, `onFailure` and `fallback` resolve against the author's messages and update, wherever the vnode ends up: in `children`, slot content or a headless closure.
  - The runtime walks each view's returned VNodes to record the author, the path and duplicates, without expanding child components.

### 4.2 Paths and keys

- A path segment is `Name[key]`, and the escaping and duplicate rules are those of `component §1.8` and `§6.2`.
- A second unkeyed child of the same component, or two children at one path, fails the author with the inventory's error text.
- Branch swaps at one path keep the instance.

### 4.3 Failures (`component §6.14`)

- **What fails an instance:**
  - a throw in `init`, `update`, `view`, `parts`, `shares`, `subscriptions` or a query's `args`;
  - a Command, Subscription or Mount defect;
  - an unhandled Layer failure;
  - a missing required owner or service.
- **What failure does:**
  1. logs `Failed`;
  2. closes the instance's scope;
  3. renders the author's `fallback(AsyncResult.failure(cause))`, or nothing if there is none;
  4. schedules `onFailure` to the author.
- The failure stays until the key changes. The rest of the island keeps running.
- Plain Ilha components inside a view that throw fail the enclosing model instance.

### 4.4 Keep-alive

`h.keepAlive((s) => …)` and `h.keepAlive(alive, (s) => …)` follow the rules in LLMS "Keep-alive children" and `component §6.3`, including the predicate guard, literal keys and `h`/`s` switching. One difference from Effect UI:

- A kept child keeps its Model, query results, running Commands, Subscriptions and Layer.
- Its DOM is removed. When it is drawn again, Ilha rebuilds the DOM from the kept Model.
- Uncontrolled DOM state, scroll and focus are not preserved. Document this as a known limit.

### 4.5 Slots

Slots work as LLMS "Slots" and `component §1.8` describe:

- `slots: [...]` in the definition, `h.slots.name` in the view, `slots={{ name: content }}` at the call site.
- The content belongs to the author, a slot is placed at most once per render, and the slot's path segment is `[name]`.

### 4.6 Lazy

`Component.lazy(name, load)` follows `component §1.14`:

- `preload()`;
- the first child rendered starts the load;
- the `fallback` gets `Initial` while loading and `Failure` if the load fails;
- a failed load retries on the next mount.

On the server the render awaits the load, because Ilha supports async components. On the client, the fallback is drawn until the module arrives.

## 5. Headless components

Everything in `component §1.9` and `§6.4` applies:

- `parts(p, model)` with `p.props`, `p.reads`, `p.queries`, `p.isRunning`, `p.id`, `p.part` and `p.child`;
- the consumer `view` closure, owned by the consumer.

Ilha adaptations:

- **Decorating a part.** A part decorates an Ilha VNode: `listbox.trigger(<button>Open</button>)` or `listbox.trigger(h("button", null, "Open"))`. `decorate` receives a blank VNode of that tag and returns the props to merge.
- **Merging.** The merge algebra follows `component §1.9`:
  - part attributes win;
  - token-list attributes (`class`, `rel`, the `aria-*` id lists) are added and deduplicated;
  - `attr: undefined` removes an attribute;
  - a part can't set `key` and can't apply another part.
- **Events.** Handlers become layers, deepest owner first and the consumer last. Each layer's `preventDefault` applies only to its own message.
- **Dev-mode failures:** applying a part outside its owner's view, or two layers setting a conflicting event option.

## 6. Shared state

Everything in `component §1.10` and LLMS "Shared state" / "Who owns the state" applies:

- `shares` with `value(model, props, reads)`, `schema`, `receives` and `collects`;
- `reads` entries `{ owner, optional, report, onChange }` and `"self"`;
- `$.send`;
- the 100-round loop guards and the owner-lookup errors.

Ilha adaptation:

- Owners are found through one hidden Ilha context per owner definition.
- JSX can't carry tree-position requirements in its types, so a missing required owner is a runtime failure of the reader. It uses the inventory's message ("…and no X is above it" / "…a different component with the same name is above it").
- `Component.Shared.Of<typeof X>` still exists as a type for documentation and tests.

## 7. Services and features

- `Component.provide` follows `component §1.13`:
  - curried, array, props-function and keyed forms;
  - `local`;
  - `onFailure` is required when the Layer can fail;
  - Layers are built once per Env × Layer, reference-counted and shared through `Layer.CurrentMemoMap`;
  - the inner provide wins;
  - rendering doesn't wait for the build, but Commands and Subscriptions wait for the Layer.
- **Ilha adaptations:**
  - The Env travels down a hidden Ilha context.
  - Layers never build on the server, because Commands and Subscriptions never run there, so there is no `server` option.
  - The component type still tracks `R`. A service still missing at run time fails the instance and names the service and the path.
- `Feature.Service` follows `effects §4`:
  - `toLayer(component)` checks the contract;
  - `render(h, { key, props, onEmit, fallback })` requires `fallback`;
  - "nothing provides feature/X" is an error;
  - the path segment is the feature's name.

## 8. Commands

`effects §1` in full:

- **Defining:**
  - `Command.make(name, { args, mode, group, stream }, body)`;
  - `Command.Service<Self>()(key, { args, success, error, mode, group, stream, invalidates, optimistic, writes })` with `toLayer`.
- **Combinators:** `map`, `as`, `asNoop`, `match`, `afterRefetch`, `interrupt`.
- **Scheduler and rules:**
  - the exact scheduler from `effects §1.3`: statuses `running`, `queued`, `awaiting` and `stopping`; group holding; `switch` cuts awaiting runs; `queue` keeps issue order;
  - the issue order, the per-run Scope and the Effect span;
  - async start after `yieldNow`;
  - interrupt reasons, `silent` results and the `CleanupFailed` problem.
- **Failures:** a defect, or an unmatched typed failure, **fails the instance**.
- **Server:** no Command runs on the server. `init` Commands run on the client after hydration or adoption. `update` Commands issued during the server render log `CommandDropped` and report `ServerCommandIssued`.
- **`h.isRunning(Cmd, ...group)`** has the lifetime in `effects §1.4`.

## 9. Subscriptions

- **`effects §2`:**
  - `Subscription.make(name, stream)` and `make(name, deps, build)`;
  - `keyOf` encoding;
  - `direct`;
  - keys are compared on each pass: removed keys stop before new keys start, and an existing key never restarts;
  - an ended Stream stays stopped until its key leaves the list and comes back;
  - duplicate keys fail the instance.
- **`effects §6–7`:**
  - `DomSubscription.onDocument`, `onWindow`, `onCustomEvent`, `onAnimationFrame` and `shortcuts`;
  - the `GlobalEvents` and `AnimationFrames` services, whose defaults never fire. The island mount provides the browser versions;
  - `Keyboard.shortcuts` with the full matching rules;
  - one listener per target, event and phase.
- Nothing listens on the server.

## 10. Query

`platform §1` in full:

- **Definitions:**
  - `Query.Service` / `InfiniteService` / `Tag`;
  - `staleTime`, `idleTimeToLive`, `refetchInterval`, `tags`;
  - `get`, `prefetch`, `invalidate`, `changes`, `peek`, `entry`.
- **Behaviour:**
  - the key-encoding rules;
  - no retries;
  - host signals: Visibility and Connectivity, from `document.visibilityState` and `online`/`offline`;
  - Problems.
- **Component `queries`:**
  - `query` and `queryMany` entries, `debounce`, `onChange`;
  - in the view: `h.queries`, `h.previous`, `h.patched`;
  - in `update`: `$.queries`, `$.loadMore`, `$.reset`.
- **Command integration:** `invalidates` (applied on every exit of a started run), `optimistic` patches, `writes` and `afterRefetch`.
- **SSR:**
  - `renderToString` uses a per-request cache;
  - settled entries ship in the island's snapshot;
  - the client has a fetch-free window until adoption completes;
  - `Redacted` entries are never shipped.
- **The cache lives once per island registry.** Islands don't share a cache, which follows Ilha's island isolation.

## 11. Mounts and refs

- **Mounts** (`effects §3`): `Mount.make`, `makeStream`, `map` and `changes`.
  - Attach one with `h.mount(issued)`, which returns an Ilha `ref` prop: `<canvas ref={h.mount(DrawChart({ points }).pipe(Mount.map(toMessage)))} />`.
  - Same name: the new args are published to `changes`. A different name restarts the mount. A render without the mount stops it.
  - An element takes one mount.
  - The body starts after commit.
  - The Scope lives as long as the element.
  - A defect fails the instance.
  - Never on the server.
- **Refs:** `Dom.ref(name, tag)` creates a typed ref, and `h.ref(ref)` returns an Ilha `ref` prop. Refs resolve within the issuing instance after the commit of the update that issued the Command.
- **`DomCommand`:** `focus`, `blur`, `scrollIntoView`, `measure`, `select`, `requestSubmit` and `showPicker`, with the results in `effects §5`.
- **`DomFiles`** (readers, `pick`) and **`DomImages`** (`load`) follow `effects §8` and `§10`.

## 12. Lifecycle, SSR and hydration

- **Snapshot.** Instance state (Model plus query results) is encoded with `Schema.toCodecJson`, keyed by instance path, inside the island's Ilha snapshot.
- **Hydration.** The client adopts that state. As `component §6.12` describes, `init`'s Commands, lists and sends run again on the client, and its emits are dropped.
- **Redacted.** A Model or query Schema holding `Schema.Redacted` anywhere (the walk in `component §6.10`) is never snapshotted. Its instance renders on the server from `init` and rebuilds on the client, with a one-time warning per component.
- **Unmount.** Unmounting closes the scope: runs stop with reason `unmount`, Subscriptions and mounts stop, and Layers are released.

## 13. Testing (`@ilha/model/test`)

`testing §1–12`, adapted to Ilha:

- **`Steps`.** The shared steps and the full **acknowledgement rule**, including the end check, `keepPending`, the `given` rules and the errors with hints.
- **`Story`.** `make`, `start`, `parts`, `fromLog` (with `Replay` / `Divergence`), and Story steps including `send`.
- **`Scene`.** Pure. It renders the component's view VNodes without running children's `update`, and `Locator` runs over the VNode tree.
  - Steps: `click`, `fire`, `childEmit`, `childFailure`, `childPending`, `givenChild`, `collected`, `mounted`, `expectMount`, `expect*`, `expectIgnored`, `expectDefaultPrevented`, `parts`.
  - DOM-flavoured steps from `HtmlScene`: `type`, `change`, `keydown`, `submit`, `focus`, `blur`, `fireDocument`, `fireWindow`, `fireCustomEvent`, `frame`.
  - The click sequence and the disabled-control rules follow `testing §9`.
- **`Play`.** It mounts with the Ilha renderer in happy-dom and runs the real runtime under `TestHost.layer`.
  - Each step settles before and after it acts.
  - `TestClock` drives Commands, Subscriptions and queries.
  - It provides HtmlPlay's DOM steps and differences (`testing §10`).
  - `DomLocator` (roles, names, labels, hidden rules) works on the real DOM.
- **`TestHost`.** `settle`, `pending`, `RootCrashed`, `SettleError`, `formatLog`, `formatTimeline`, `stub(feature)`, visibility and online signals, and problems.
- **Fakes.** `TestQuery`, `TestGlobalEvents`, `TestAnimationFrames`, `TestFiles`, `TestImages`.
- **`ssr(component, props, options)`.**
  - Runs `renderToString`, then `mount(..., { hydrate: true })` in a fresh document.
  - Fails with `SsrError` for the `testing §11` catalogue that applies to Ilha:
    - a Model that wasn't adopted or drifted;
    - a node that was rebuilt instead of adopted;
    - a shipped query that doesn't round-trip;
    - a fetch inside the fetch-free window;
    - a Layer still waiting;
    - any problem reported.
  - Head checks are dropped, since Head is out of scope.

## 14. MessageLog

`testing §13` in full:

- the `MessageLog` service, off by default and costing nothing when off;
- every entry type and field, `causedBy` causality, instance numbering and `boundary`;
- `Source` tags;
- Wire v1 encoding with placeholders, `maxEntryBytes` and `Redacted` redaction;
- the sinks `memory`, `fanout`, `fanoutAll`, `makeEncoded` and `socket`.

The entry types that belong to Out features don't exist: Head, Router, history `Kept`-restore keys. The `Kept`/`Drawn` entries for keep-alive do exist.

## 15. DevTools (`@ilha/devtools`)

- **Overlay.** The existing Ilha panel gains the `testing §14` features:
  - a timeline with the Messages / Commands / Everything filters;
  - the instance tree;
  - per-entry tabs: Model diff, Message, Props, Commands, Events, Lifecycle, Raw;
  - the causal chain, Follow latest, Clear, and the `exclude` option.
- **Time travel.**
  - Pausing hides the island's live container and renders an inert copy through `renderToString`, with each instance's state at the chosen entry injected by path.
  - The live island keeps running hidden until Resume.
  - While paused, the copy runs nothing.
- **`Inspector`.** The headless core from `testing §15`: sessions, records, links, `previous`, `diff`.
- **Tools.** The tool set from `testing §17` is exposed through the existing WebMCP channel as `ilha_model_*`:
  - `list_sessions`, `list_instances`, `list_entries`, `count_entries`, `get_entry`, `get_chain`, `get_state`, `diff_state`, `show_entry`, `resume`, `get_message_schema`, `wait`;
  - `dispatch`, which is off unless the page passes `dispatch: true`.
- **Out:** the node DevTools server, the Vite plugin and HMR state preservation.

## 16. Removed APIs

- **From `@ilha/model`:**
  - `defineApp`, `ModelApp`, `AppOptions`
  - `UpdateResult`, `Cmd`, `Dispatch`
  - `keyed`
  - `subscription` and the old `Subscription` shape
  - `combine`, `foldChild`, `Step`, `FoldChildOptions`
  - `attachModelRecorder`, `DispatchRecord`, `ModelRecorder`
  - the `schema` option
- **From `@ilha/model/test`:** `runCommands`, `simulate`.

The version becomes `0.2.0`. The README carries a migration table.

## 17. Repo deliverables

- Source and tests in `packages/model`. Type anchors go in `src/types.test.tsx` for every compile-time rule, with `@ts-expect-error` for the negatives.
- **Runtime tests.** Each inventory rule marked In gets a test on both the reactivity path and the SSR→hydration path (AGENTS.md).
- **Port Effect UI's own tests** for these areas wherever they apply: the scheduler, subscriptions, shared state, parts merge, keyed provide, query cache, Validation, Story/Scene acknowledgement, Wire encoding.
- **`packages/devtools`:** the features in §15 with tests.
- **Docs:**
  - Rewrite `guide/ui/model.mdx`, splitting it into pages if it gets long.
  - Add `choose-an-api.mdx` rows for every task this spec covers, and add the removed APIs to "Never do".
  - Update `devtools.mdx` and `README.md`.
- **Examples.** Port Effect UI's `counter`, `counters`, `file-preview`, `interrupting-commands` and `snake` examples as tests, written as Story, Scene or Play.

## 18. Acceptance

1. `bun run check`, `bun run test` and `cd apps/website && bun run build` pass.
2. Every row marked **In** in §1 has passing tests. They cover each edge-case rule the referenced inventory section lists.
3. The launch-article examples run as tests: Counter, Page/Counter, CartProvider/Shop, Posts with `SearchPosts`, Disclosure/Details, and the Story/Scene/Play counter tests.
4. `ssr()` passes for an island that nests a provider, a headless child, a query and a keep-alive child.
5. `Story.fromLog` replays a devtools export without divergence, and reports the first divergence after a deliberate change to `update`.
6. The devtools time-travel test pauses on an earlier entry, shows that state, resumes, and the live island has kept running.
