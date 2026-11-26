# Effect UI platform inventory (Query, Validation, Routing, Head, Renderer, HTML host/SSR, Markdown, ui-kit, opentui, examples)

Source: `/tmp/effect-ui` (read-only). Every API is `@stability experimental`, `@since 0.1.0`. `Q:` is short for `packages/ui/src/Query.ts`, and other files are named relative to `packages/ui/src/`.

## 1. `Query.ts`: keyed data cache

Module rules (Q:1-50):

- There is one entry per (query, encoded args).
- In-flight fetches are shared.
- Unused entries are garbage-collected.
- All timing uses `Clock`, so `TestClock` drives it. `@effect/ui/testing/TestQuery` is the test harness.
- On the server, an entry whose args, success or error Schema contains a `Schema.Redacted` is **not dehydrated**. The client fetches it instead.

### Defining a query

- **`Query.Service<Self>()(name, options)`** (Q:415) returns a class (a `Context.Service` whose value is the fetcher).
  - `args`: a fields record or any Schema. The entry key comes from the JSON-encoded args, so a query with no args writes `args: {}`.
  - `success` and `error`: both required. Use `Schema.Never` for an error that can't happen. All three Schemas must need no services (`Service.NoServices`, Q:288-313).
  - `staleTime`: **required**. `0` means always stale; `"Infinity"` means never stale by age. A stale entry is still served at once. It refetches when its first watcher arrives, on `get`/`prefetch`, on a host-signal edge, on its interval, or when invalidated.
  - `idleTimeToLive?`: how long an entry stays with no watchers. Overrides the cache default of 5 min.
  - `refetchInterval?: RefetchInterval` (Q:115): a Duration, or `(result, args) => Duration | undefined`, called once per settle. Polls only while the entry is watched.
  - `tags?: Tag[]`: invalidation tags.
  - Definition-time throws:
    - negative `staleTime` or `idleTimeToLive`;
    - a constant `refetchInterval` that is ≤0 or a **bare number under 1000** (write `"500 millis"`).
  - Call-time throws: args that don't encode, or encode to non-JSON.
  - Key semantics:
    - `{id}` and `{id, page: 1}` are different entries, even when a default makes them one request.
    - A top-level optional args field set to `undefined` is the same as a missing one: it's dropped before encoding.
    - Nested values follow the Schema's encoding. For example, `NullOr` inside `optional` makes `undefined` and `null` the same key.
    - The fetcher receives the args of the call that **created** the entry.
  - The cache never retries. Put `Effect.retry` inside the fetcher.
- **Instance statics** (interface `Service`, Q:201-280):
  - `toLayer(fnOrEffect)` (Q:216): builds the fetcher once per Layer build and captures its dependencies. When the Layer's scope closes, in-flight fetches are interrupted and their cleanup is awaited.
  - `get(args)` (Q:239):
    - Returns the stored value if fresh; otherwise fetches, or joins a fetch in flight, and stores the result.
    - If the fetch it waits on reverts (fetcher self-interrupt, or the caller's build scope closes with no one else watching), the call is **interrupted**. It never fails with an error the fetcher didn't raise and never returns a stale value instead.
    - It always returns the **server value**, never a patched one.
    - Inside a Command run whose `invalidates` covers the entry, it calls the fetcher in the caller's fiber and stores nothing.
  - `prefetch(args)` (Q:244): starts a fetch that outlives the caller, unless the entry is fresh.
  - `invalidate(args?)` (Q:250): marks one entry (or the whole query) stale.
    - A watched entry refetches at once.
    - A fetch in flight is **restarted**.
    - Any other entry refetches on its next read.
  - `changes(args): Stream<AsyncResult>` (Q:257):
    - Watches the entry and loads it if cold or stale and no one else watches.
    - Emits the current state first when it is settled.
    - Skips states equal to the previous one (`Equal`).
    - Dies with the fetcher's defect.
  - `peek(args)` (Q:264): reads state without fetching, without creating the entry and without keeping it alive.
  - `entry(args)` (Q:266): returns an `EntryTarget`.
  - `patch(args, f)` (Q:272): an optimistic patch of one entry. Implies invalidating it.
  - `patchAll(f(value, args))` (Q:277): patches every entry that holds a Success when the run is issued. Implies invalidating the whole query.
  - `set(args, value)` (Q:279): a `Write`, usable only in a Command's `writes`.

### Infinite (paginated) queries

- **`Query.InfiniteService<Self>()(name, options)`** (Q:951).
  - Options: `args`, `page` (the Schema of one page), `items(page)`, `key(item)`, `error`, `cursor` (Schema), `next(lastPage, allPages) => Option<cursor>` (must be pure; the cursor is never stored), `staleTime`, `idleTimeToLive?`, `refetchInterval?`, `tags?`.
  - The entry value is the **page array**.
  - Gotcha: write `items` before `key`, or the item type infers as `unknown`.
  - Semantics (Q:880-935):
    - One entry and one load per list.
    - A refetch re-walks pages 1..N **sequentially** (30 pages = 30 requests) and swaps them in at the end; a list that got shorter ends early.
    - An invalidation, a patch or a closing build restarts the walk from page 1, keeping the page count.
    - A visibility, connectivity or interval refetch that arrives during an append waits for the append.
    - `staleTime` counts from the last load that started at page 1; `loadMore` updates no timestamp.
    - Infinite queries with the same args share one page count, which only grows until `reset` or GC.
    - **SSR renders only the first page.**
    - Every held page is saved into `history.state`. `$.reset` is the way to keep that small.
  - Statics (interface, Q:754-860): the same as `Service` except there is no `set`, plus:
    - `loadMore(args): Effect<LoadedMore>` (Q:822): appends from the last held page whatever its age. If a page-1 refetch is running or queued, it extends that refetch by one page instead. Under a live patch it waits for the patch's run to exit. Does nothing at the end of the list.
    - `reset(args)` (Q:827): drops all pages after the first, then invalidates.
    - `items(pages)` (Q:832): flattens pages and deduplicates by `key`, first occurrence wins.
    - `patch(args, f(page, i))` / `patchAll(f(page, args, i))` (Q:839/848): apply per page and cannot change the page count.
- **`More<E>`** (Q:721): `End | Available | Loading | Failed{error}`.
  - `Failed` keeps the held pages. It is cleared by the next `loadMore`, by a page-1 refetch, or when the last watcher leaves.
  - A refetch that fails within the held pages becomes a Failure whose `previousSuccess` is the held pages. One that fails on the page past them swaps in what it loaded and sets `Failed`.
- **`LoadedMore<Page>`** (Q:735): `{ pages, hasMore }`.

### Invalidation, optimistic updates and writes

- **`Tag(name)`** (Q:1107): tags compare by name.
- **`EntryTarget`** (Q:1116); **`Target = Query | EntryTarget | Tag`** (Q:1129).
- **`Patch`** (Q:1146):
  - A patch is live while its run is queued or running. During that time nothing fetches the entry and watchers see the patched value.
  - After the run succeeds, the patch is held until the entry settles or a write is stored.
  - A failure, interrupt or defect drops it at once.
- **`Write`** (Q:1170): `{_tag:"Set", query, args, value}`.
- **`applyPatches(patches, query, args, value)`** (Q:1208): a pure helper for testing a Command's `optimistic` without a cache.
- **`invalidatesEntry({invalidates, optimistic?}, query, args)`** (Q:1263): the predicate the cache uses. It doesn't know about writes; entries a run's own writes stored fresh are subtracted later.
- Command-side options (`Command.ts:830-836`, `Command.Service` options):
  - `invalidates?: (args) => Target[]`: known at issue time, and applied on **every exit** of a started run.
  - `optimistic?: (args) => Patch[]`: registered at issue time.
  - `writes?: (success, args) => Write[]`: Effect Commands only.
- **`Command.afterRefetch(budget)`** (`Command.ts:1620`): holds a Command's success message until the entries the run invalidated have refetched, or until the budget runs out.
  - It waits only for entries that had a watcher when the invalidation applied.
  - A typed failure is delivered at once.
  - `h.isRunning` stays true during the wait.
  - Not allowed on `Command.make` or Stream Commands (type error).

### Diagnostics

- **`Trigger`** (Q:1302): why a fetch started. One of `watch | get | prefetch | visibility | connectivity | interval | invalidation | loadMore | reset`. Logged, never shown to the fetcher.
- **Host signals**: `Signal { get, subscribe }` (Q:1321).
  - **`Visibility`** (Q:1343) and **`Connectivity`** (Q:1361) are `Context.Reference`s that default to always true.
  - **Refetch on focus/reconnect**: when a signal goes false→true while the other is true, the cache refetches every watched entry that is stale or whose interval elapsed meanwhile.
  - While either signal is false, intervals don't fire. Being offline never blocks a fetch.
  - The cache reads the signals once, when it is built. `BrowserHost.layer` provides the document's signals.
- **Problems** (`Data.TaggedClass`, reported and never thrown; Q:1372-1607):

  | Problem | When it's reported |
  | :-- | :-- |
  | `DuplicateName` | Two queries share a name; the first definition wins. |
  | `IntervalThrew` | A function-form `refetchInterval` threw. |
  | `IntervalInvalid` | A function-form `refetchInterval` returned an invalid duration. |
  | `FetchRestarted` | One fetch restarted 10 times in a row without settling. |
  | `PageRepeated` | A cursor repeated within one walk. |
  | `DuplicateKeyInPage` | Two items in one page share a `key`. |
  | `PatchInvalid` | A patched value fails the `success` Schema. |
  | `PatchMutated` | A patch mutated its input, detected by comparing snapshots of the Schema encoding taken before and after the patch first applies. |
  | `UncoveredWrite` | A write to an entry not covered by `invalidates` or a patch. |
  | `InvalidateIgnored` | `invalidate` on a per-request server cache. |
  | `EncodeFailed` | An entry failed to encode during dehydration. |
  | `HydrationMalformed` | The dehydrated payload has the wrong shape. |
  | `HydrationDecodeFailed` | One entry's `value` or `args` failed to decode. |
  - A problem carries the query name and a **log key** with Redacted args redacted. It never carries values.
  - `Problem.Any` is open, so other modules report into the same sink.

- **`Problems`** (Q:1640): `Context.Reference<(p) => void>`, default `console.warn(message)`. Read once when the cache is built; anything the sink throws is swallowed. Every check runs in every build (Effect has no dev mode).

### Cache service

- **`Cache`** (Q:1650) and **`layer({ idleTimeToLive? })`** (Q:1673): for plain Effect code.
  - Takes `Visibility`, `Connectivity`, `Problems` and `Clock` from where the Layer is built.
  - Disposed with its scope: fetches are interrupted and their cleanup is awaited.
  - Throws on a negative TTL.
- Mounted apps never provide the cache. They pass `mount(..., { query: { idleTimeToLive } })` (`Renderer.QueryOptions`).
- Internal exports used by the runtime (`@internal`): `makeSignal`, `defOf`, `RunHandle`/`AwaitedEntry`, `internals`, `makeSnapshot`/`snapshotSchema`/`snapshotMapSchema`, `sameMore`, `makeCache`.
  - Snapshot wire format: `[]`, `[argsKey, 0, value, ts, patched]` or `[argsKey, 1, [errs], prev|null]`. The log form adds `[waiting, more]`.
  - Dehydrated payload: `state["~query"]` by query name, as `[argsKey, 0|1, encoded, timestamp]`.
  - `CacheInternals.hold` creates the "fetch-free window" used during hydration and render passes.

### Component-side query entries (`Component.ts`)

- **`queries`** option (Component.ts:3019; doc 3262-3290):
  - Entry shape: `{ query, args, debounce?, onChange? }`, or `{ queryMany, args }`.
  - `args($)` receives the Model, the props and the **other** queries' results. It returns the args, `undefined` to disable the query, or an array for `queryMany` (`ArgsFor`, 2190).
  - An infinite query must use `query`, not `queryMany`; using both keys in one entry is a type error (2013).
  - The query result lives beside the Model as instance state. It is shipped in SSR state and in history snapshots.
- **`debounce`**: a `Duration.Input` on the Clock that delays only a fetch for **changed** args.
  - These go through at once: the first args at mount, the server render, args whose entry is fresh or already fetching, and a change to `undefined`.
  - While waiting, `h.queries` shows `Initial` (waiting) and `h.previous` holds the last value.
  - Args that change again restart the wait. Each new `queryMany` key waits on its own.
- **`onChange`** (`OnChange`, 2202): returns a message when the result changes.
  - A single query receives its opened result; `queryMany` receives `(results, changes)`.
  - The result is written first, so that message's `update` sees it in `$.queries`.
- **View helpers** (`QueryHelpers`, 1843):
  - `h.queries`, `$.queries`, and `queries` in `head`/`subscriptions`.
  - `h.previous[name]`: an Option of the Success held for args other than the current ones; `Some` only while the query is enabled.
  - `h.patched[name]`: true when the value includes an unconfirmed patch. Per entry. Not available for `queryMany`.
- **Opened shapes**:
  - `QueryResultOf` (2086): single → `AsyncResult<A, E>`; infinite → `AsyncResult<InfiniteData>`.
  - `InfiniteData` (2109): `{ items, pages, more }`, where `items` is the patched pages deduplicated by `key`.
  - `KeyedResults` (2128): a `queryMany` result is an array of `{ args, result, patched }` in args order, plus `.get(args)`. Entries carry no key, so write `.key()` by hand.
- **`$.loadMore(name)`** / **`$.reset(name)`** (627/633): issue a page load or reset for an infinite query, using the args computed from the post-update Model. Nothing is issued for a disabled query.
- Type helpers: `QueryOne`, `QueryMany`, `QuerySpec`, `Queries`, `SingleNames`, `InfiniteNames`, `KeyedNames`, `QueryServices` (queries add only their own service to `R`, never their fetchers' deps).

### SSR and hydration of queries

See §7/§9 for the full flow.

- The server uses a per-request cache: each key is fetched at most once, `staleTime` is ignored, and query-watch Subscriptions run.
- Entries that settle (including typed Failures) are shipped in `~query`. Entries still in flight at the budget are not shipped.
- On the client, a hydrated entry doesn't fetch, even if stale, until `adopted` completes or the Router first navigates (the "fetch-free window").
- `static: true` hydrates every entry stale with unknown age: it refetches once unless `staleTime` is `"Infinity"`, and there is no fetch-free window.
- **Data is public**: every settled entry is in the page state, even one no view renders.

## 2. `Validation.ts`: form validation (Foldkit rules, derived state)

- **`make(fields, options?)`** (`Validation.ts:773`) returns a `Validation`.
  - Each field is `FieldOptions` (293):
    - `value?: Schema` (default `Schema.String`);
    - `required?: string | (values) => string | false`;
    - `rules?: Rule[]`, checked in order and only when the value isn't empty;
    - `isEmpty?`: default is an empty string or array, with `Redacted` unwrapped.
  - **`Options`** (259): `mode?: "onChange" | "onBlur" | "onSubmit"` (default `onSubmit`, as in Base UI) and `errors?: "first" | "all"`.
  - Field names go through `Object.fromEntries`, so `__proto__` is safe.
- **`Rule<A, Values>`** (87): a `[predicate(value, values), message]` tuple. **`RuleMessage`** (69) is a string or `(value) => string`.
- **`Rule.*`** built-ins (157), each with an optional message override:
  - `minLength`, `maxLength`;
  - `pattern(regex)`: copies the RegExp so `lastIndex` state can't leak;
  - `email`, `url({ requireProtocol })`;
  - `startsWith`, `endsWith`, `includes`, `equals`, `oneOf`;
  - `minItems`, `maxItems`;
  - `fromSchema(schema, message)`: the value decodes through `schema`. Use it to keep a rule and the submit-time parser on the same Schema.
- **`State<Values>`** (313): `{ values, edited[], touched[], submitted, rejected: { [field]?: NonEmptyArray<string> } }`. No derived errors are stored.
- **`Field<A>`** (393): `NotValidated | Validating | Valid | Invalid{errors}`, each with `value`, `empty` and `required` (the `required` flag is meant for a `*` marker).
- The **`Validation`** object (510):
  - `State`: a Schema codec for the Model.
  - `init(values)`.
  - `change(state, name, value)`: data-first or data-last. Sets the value, marks it edited, drops that field's server errors.
  - `blur(state, name)`: marks it touched.
  - `submit(state)`.
  - `reject(state, { name: errors })`: server errors. They always show and block `value` until the field changes; an empty list clears them.
  - `passes(state, name)`: non-empty and the field's own rules pass, ignoring checks and server errors. Use it to enable a check query.
  - `checklist(state, name): ChecklistItem[]` (431): every rule with `{ message, met }`. Ignores mode, checks and rejections. An empty value meets no rule. Message functions are called on every rule, including with empty values.
  - `validate(state, checks?): Validated` (471).
- **Validation order** (`make` doc 700-770):
  1. `rejected` errors → `Invalid`, always shown.
  2. Empty → `Invalid` with the required message, or acceptable if the field is optional.
  3. Rule failures (first, or all with `errors: "all"`).
  4. Async **`Checks`** (450): `{ field?: AsyncResult<string[], never> }`. Read only when the field is non-empty and passes its rules. `Initial` or waiting → `Validating`; a Success with errors → `Invalid`. A failed check (a defect) stays `Validating`.
  5. Otherwise `Valid`.
  - A field shows its result once submitted, or by mode (edited for `onChange`, touched for `onBlur`). Until then it is `NotValidated`.
- **`Validated`**: `value` is `Some(values)` when every field is acceptable, **whether shown or not** (use it to gate submit); plus `invalid` and `validating`.
- Gotchas:
  - Errors are not in the Model or the MessageLog.
  - `value` Schemas live in the Model, so they reach history and SSR state. Using `Schema.Redacted` keeps the whole component out of both, so keep the form a leaf component.
  - Forms set `novalidate`.

## 3. `Route.ts`: route definitions

- Module rules (`Route.ts:1-60`):
  - **Ranking**: a literal segment beats `:param`, which beats `*`; the first declared wins among equal templates.
  - **Path params fall through**: a param that fails to decode tries the next route.
  - **Required search fields**: one that fails to decode makes the URL a 404, resolving to the `"/*"` catch-all with no fall-through.
  - A trailing slash is stripped, a printed path never has one, and matching is case-sensitive.
  - Redirects are ranked like routes.
  - Search keys:
    - An optional or defaulted field whose value fails to decode, or whose key is repeated, is treated as absent and listed in `invalid`.
    - A lone value decodes into an array field.
    - A defaulted param equal to its default is omitted when printing.
  - **Base path**: printed URLs are absolute. Base `"#"` puts the route in the fragment.
- **`make(path, { params?, search? })`** (434):
  - Every `:name` needs a Schema; this is a compile error and a runtime throw.
  - A trailing `*` captures the rest of the path as the `"*"` param.
  - Values decode through `Schema.toCodecStringTree`.
  - Defaults via `Schema.withDecodingDefaultKey`.
  - Template errors throw: no leading `/`, `*` not last, unnamed param.
- **`redirect(path, (params, search) => routeValue)`** (483).
- **`union(routes, ...redirects)`** (953) returns `Union`, a `Schema.TaggedUnion` of `{ _tag, params, search }`. Members:
  - `routes`;
  - `parse(url): Option`;
  - `resolve(url): Option<Resolved>` (216): `{ route, redirected, notFound, invalid[] }`;
  - `print(route)` and `printPath(route)`: `printPath` omits the search and is the page key for update-in-place;
  - `subset(tags)`: shares the base;
  - `base()` and `setBase(base)`;
  - one constructor per tag, e.g. `AppRoute.Person({ params })`.
  - Without a catch-all, unknown URLs give `Option.none()`.
  - `Union.ReservedTag` (`parse`, `print`, `make`, `match`, `name`, `Type`, `then`, `__proto__`, …) is a type error and a runtime throw.
- Types: `TypeId` (83), `PathParams` (92), `Route` (106), `Any` (124), `ParamFields` (134), `SearchFields` (147), `MakeField` (158), `FieldsSchema` (173), `Redirect` (188), `Union.Cases`/`Base`/`Constructors`, `AnyUnion` (360).

## 4. `Router.ts`: router service, navigation Commands, subscriptions, prefetch, history

### Model

- **Where the route lives** (`Router.ts:1-60`):
  - The root's Model holds the route. Its initial props come from `Router.props(AppRoute)`, and later changes arrive as messages from `Router.subscription`, so every route change is in the log.
  - Pages are chosen by `match` and keyed by `printPath`. A change to the search alone updates a page in place; add a param to the key to force a remount.
  - View state can live **only in search params**, written with `patchSearch` and read through `h.props.route.search`, with a debounced query on top.
- **`Location`** (118): `{ route, url, hash, action, seq }`. **`Action`** (135): `initial | push | replace | pop`.
- **`Outcome`** (144): `navigated | blocked`. **`PatchOutcome`** (163) adds `stale`. **`SearchPatch<R>`** (184): `undefined` removes a param or resets it to its default.

### `Router` service (207, tag 254)

- `routes`, `location()`.
- `changes`: shaped like a SubscriptionRef, so it starts with the current location. A `#hash`-only change is not a route change.
- `navigate(href, { replace? })`:
  - An href the routes don't parse is a full page load.
  - An href to the current route keeps undeclared params, writes only a new hash, doesn't bump `seq`, and **re-emits** the current location, so a link to the current page still reaches the root.
- `push`/`replace` of the current route emit nothing.
- `patchSearch`, `back`, `forward`, `load`.
- `block(key)`: scoped. `blocked()`.
- `intent(href)`: runs the matching prefetch declarations, at most once per route per 30 s per declarer.

### Commands (`Command.Service`, so fakeable in stories and Layers)

- **`Push`/`push(routes, route)`** (290/339) and **`Replace`/`replace`** (310/359).
  - A route equal to the current one does nothing.
  - They return `blocked` while a block is held. `Command.asNoop` hides that.
  - A replace with the same tag and pathname is quiet (no announcement, focus and scroll untouched).
- **`PatchSearch`/`patchSearch(routes, route, patch, { history?: "replace" | "push", scroll? })`** (379/455):
  - Applies the patch to the **current** search, so two patches in one round trip both land.
  - Returns `stale` if the Router's path no longer matches the held route.
  - Replaces by default.
  - Undeclared params (e.g. `utm_*`) are kept after the declared ones, and the hash is kept.
  - A no-op patch doesn't navigate.
  - Always quiet; scrolls to top only with `scroll: true`.
  - A push still runs prefetch.
  - **Not blocked** by `Router.blocked`. Reports `PatchSearchLostBlock` if a held block disappears during it.
  - Gotcha: key pages by `printPath`, or every patch remounts them.
- **`Back`, `Forward`, `Load{href}`** (478/497/516).

### Subscriptions

- **`blocked(key)`** (563): Subscription `@effect/ui/Router/blocked:"key"`, held while listed in `subscriptions`.
  - Blocks `Push`, `Replace`, `Back`, `Forward`, `Load` and link following.
  - Browser back/forward can't be blocked, only **reverted** silently.
  - Same-page writes are not blocked (`PatchSearch`, back/forward that differ only in search).
- **`subscription(routes, heldRoute, f)`** (722): feeds route changes into `update`.
  - The first location is suppressed when it equals the held route.
  - If it differs at `seq 0`, `RouteMismatch` is reported. Exempt: hydrated hash roots, and roots hydrated from a `static: true` render that differ only in search.
  - The key stays stable as the held route changes.
  - A subset sees only its own routes.
  - On the server it is checked once, without running.
  - Delivered **synchronously, inside the flush** of the Command that navigated, via `services.direct`. Typed search fields therefore keep the caret.
  - A navigation issued from `init` runs after mount.
  - Use this rather than `changes` directly: the browser times scroll, announcements and focus from it.

### Initial route

- **`currentRoute(routes)`** (624) and **`props(routes)`** (685): read the initial route. Both die if the union can't parse the location.
- `init` still receives plain props, so stories work without a Router.

### Prefetch

- **`page(Component, props?)`** (905) returns `Page<R>`. The page's own queries join the **declarer's** requirements. Mountables and features are rejected (erased Model).
- **`prefetch(routes, { [Tag]: (route) => Page[] })`** (1028): exhaustive over `routes`.
  - For each page the runtime runs `init` (dropping Commands), prefetches what its queries would watch first, and walks the initial view into child components. Waiting queries and feature children are skipped.
  - Runs on `intent` (hover or focus after 50 ms, touch at once), at most once per 30 s, and on push, link click, or a replace that changes the pathname, before the route changes. Never on back/forward/reload/first mount. Never on the server.
  - One per instance; a second throws.
  - Interacts with `staleTime` (a short staleTime plus the 30 s guard can show stale data that then refetches on mount).
  - Problems:
    - `PrefetchThrew` (1052);
    - `PrefetchQueryNotProvided` (1071), suppressed if a `Component.provide` sits between;
    - `PrefetchPageNotMounted` (1091) and `PrefetchEntryNotWatched` (1109), checked after the push settles.
  - Types: `PrefetchMap` (925), `PrefetchRequirements` (938), `PageRequirements` (868).

### Engine and Layers

- **`History`** (1142): `current`, `push`, `replace`, `go`, `load`, `listen`. The state is opaque; the Router stores `{ "@effect/ui": { index, snapshot } }`.
- **`Settled`** (1174): `{ location, from, index, container, title, quiet, scroll }`.
  - A navigation settles at the first flush in which no Layer build begun since is pending.
  - Quiet: `patchSearch`; a replace to the same page; back/forward within the same page. A push to the same page (`?page=2` link, GET form) is **loud**. A quiet navigation that supersedes a loud unsettled one is settled loud.
- **`Options`** (1201):
  - `routes`, `history`;
  - `onSettled`;
  - `onHash(hash, push|pop, index)`;
  - `onLeave(index)`;
  - `throttle { interval, flushOn }`: throttles same-page replaces.
- **`make(options)`** (1431): **history restore** (doc 1340-1430).
  - Before leaving an entry, it saves the encoded state (Model plus query results) of **every mounted instance**, by path.
  - On back/forward, newly created instances adopt their saved state and replay `init`'s Commands. Instances that stayed mounted keep their own state.
  - Restored query results seed **cold** cache entries as stale data (`waiting: true`, one refetch; on failure the data stays as `previousSuccess`). A result taken under an optimistic patch is never a seed.
  - State that fails to decode under the current Schemas is dropped whole (the instance runs `init` and refetches).
  - Snapshots are kept in memory per entry and written into `history.state` only when a **push** leaves the entry. `SnapshotWriteFailed` falls back to index-only.
  - After a reload, a root's first mount restores its part, and the leftover is dropped once that mount settles.
  - Excluded from snapshots:
    - Redacted state, silently;
    - state that doesn't encode (warns once);
    - async-encoding state (`Schema.File`), which is memory-only and warns.
  - Throttled replaces are flushed before a push, a hash change, back/forward, a load, `flushOn`, or scope close. `HistoryWriteFailed` (1281) is reported when a replace throws.
  - Each navigation closes the cache's post-hydration fetch-free window.
  - Component **`restore`** option (`Component.ts:3133`): `false` saves nothing; or `(model, props) => Model` runs **at save time** (so a cleared field never reaches `history.state`); a throw excludes the instance and warns once. Not used by hydration.
- **`memoryHistory(url?)`** (2143): adds `entries()`, `index()`, `loaded()`. `go` is synchronous and no-ops past either end.
- **`memory({ routes, url?, history? })`** (2200): for tests and TestHost. No DOM; `load` is recorded.
- **`Router.static({ routes, url })`** (2256): for SSR. Every Command returns `blocked`, and the Layer **dies** if the URL doesn't parse. For a hash shell, call `setBase("#")` and render at `"#/"`.
- **`Services`** (582) = `Router | Push | Replace | PatchSearch | Back | Forward | Load`.
- **`RouteMismatch`** (1237).

## 5. `Head.ts`: host-neutral head fold

- **Entries**: `Title` (72), `TitleTemplate` (84), `Reduce` (97).
  - `title(text)` (109).
  - `titleTemplate(f)` (124): never applies to its own instance's title. Templates chain outward, nearest first; the last one on an instance wins.
  - `reduce(f)` (162): maps the folded value of its node. Only `title` from the result is used; the HTML fields are kept.
- **`Head`** (177): `{ title }`.
- **`Tree<E>`** (197): `{ path?, entries, children, onError? }`. Siblings with entries need distinct paths or the merge throws. Without `onError`, a throwing template or reduce rethrows.
- **`merge(tree, { onConflict? })`** (303) and **`resolveTitle`** (265).
- **Fold rules**:
  - A node's own entries come first, then its children's values. Children are ordered **by path, not document order**, so moving a component can't change the head.
  - `reduce` entries run in written order.
  - The root's result is final.
- **Conflict**: siblings that set one slot to different values leave it **unset** unless an ancestor's `reduce` sets it; otherwise `Conflict` (213) is reported (`conflict()` 238, `MergeOptions` 226). The runtime sends it to `Query.Problems`.
- **Component `head` option**: a pure function of `{ model, props, queries }`, folded on every flush that changed a view (including `fallback` content).

## 6. `Renderer.ts`: the Host contract, mount and prerender

- Rendering model (`Renderer.ts:1-20`):
  - A component-bounded virtual DOM.
  - A message re-runs only its own instance's view, and the diff stops at child boundaries.
  - A child re-renders only when its props change (shallow compare).
  - Dirty instances render in one flush, parents first.
  - A message or query result for an instance first renders the dirty ancestors, so `update` reads current props.
- **`Host<Node>`** (178):
  - `createElement`, `createText`, `setText`;
  - `setAttr(node, name, value | undefined, previous?)`;
  - `setProp` (properties are `unknown`; the host decides what they mean);
  - `insertBefore`, `remove`, `parentOf`, `nextOf` (never inserts by index, never relies on comment nodes);
  - `setEvents(node, handlers, dispatch, options)`: handlers are stored as data;
  - `elements` (vocabulary names, or `"any"`);
  - `controlled` (props re-applied after every patch);
  - `runsMounts`;
  - optional `normalizeAttrs`, `commit` (once per flush), `head(folded)` (after the commit once all instances have adopted; not called with `head: false`), `hydration`, `createContainer` (keep-alive container; without it, a kept child fails), `removeChildren` (bulk clear), `events: HostEvents` (lookup instead of `setEvents`), `viewTransition(update, types)`.
  - Event options: `preventDefault: true` is honoured in `dispatch`'s `onMessage`; `"always"` is applied before dispatch.
- **`Dispatch`** (55): runs the handler synchronously. `onMessage` runs before the message is sent, inside the native event. Returns whether a message was produced.
- **`Events`** (70) and **`HostEvents`** (102): `connect(lookup)` takes a composed path, innermost first. During a patch, the events a patch just set win. Detached children are resolved through their container.
- **`Hydration<Node>`** (258):
  - `firstChild`;
  - `inspect` → `Element{tag, textOnly?} | Text | Open{path} | Close{path} | Other`;
  - `getAttr`, `adoptProp?`.
  - Markers are `<!--[path-->` and `<!--]path-->`. They are omitted for a shipped child with no Layer whose view root is an element; that child is matched by position.
- **`State`** (318): `{ [path]: encoded { model, queries }, "~deferred"?, "~query"?, "~reported"?, "~static"? }`.
  - `~deferred`: subtrees the client builds fresh (Layer kept off the server, unshippable or Redacted state).
  - `~reported`: an owner's last `collects` message.
  - The client decodes with its own Schemas, so it must be the **same build**. A path that doesn't decode runs `init` and is built fresh.
  - Only `~query` hydrates the cache.
- **`ServerNode`** (337): `Element | Text | Range{path}`. **`Prerendered`** (360): `{ nodes, state, model, head }`.
- **`Renderer`** service (376/387) and **`layer(host)`** (396).
- **Refs**:
  - `Ref<Node>` (413): `{ name, key, at(row) }`.
  - `ref(name)` (429).
  - `Ref` Schema (462): encodes to its key.
  - `Refs` service (490/501): `lookup(ref)` waits for the commit of the render the issuing `update` caused, and returns `None` if the element isn't rendered. A framework service, never in component requirements.
- **`Root<Model, Msg>`** (510): `{ path, session, model(), send(msg), adopted }`. `adopted` may complete before the head sync and announcement land.
- **`HostOf<V>`** (537): mounting on the wrong host is a type error; nested mismatches fail that child at runtime.
- **`mount(component, props | Effect<props>, container, { fallback?, query?, head? })`** (582):
  - Each instance gets a child scope.
  - **Every child is a failure boundary**: a failed child shows its `fallback` until its key changes. A failed root shows the root `fallback` and logs `Failed` and `Unmounted`.
  - Effect props run once before `init`, so props themselves can't be Effects.
  - Builds fresh (no hydration).
  - `head: false` still computes the head and the Router still reads the title.
- **`QueryOptions`** (620): `{ idleTimeToLive? }`.
- **`prerender(component, props, { budget?, elements?, static? })`** (666): the server run.
  - Synchronous render. Provided Layers are built.
  - A per-request cache fetches each key once, ignores `staleTime`, and dispatches a watch when its entry settles, so a watch message that changes args fetches the next key **in the same render**.
  - **No Commands**: those from `init` are dropped silently; those from `update` are dropped and logged as `CommandDropped{reason: "server"}` and `Command.ServerCommandIssued`.
  - Events apply, so a child can change its parent.
  - Subscriptions other than query watches, and `onMount`, never run.
  - Waits until nothing is in flight or the `budget` (default 500 ms) is spent. Any in-flight fetch, even a prefetch nobody renders, holds the wait.
  - Budget misses: the Layer's instance is deferred; the fetch is interrupted and not shipped.
  - `budget: 0` starts no fetch.
  - Serialised once, in document order.

## 7. `html/BrowserHost.ts`: the DOM host

Host behaviour (module doc 1-110):

- **Events**:
  - Delegated: one capture-phase listener per event name on the document.
  - Handlers receive plain payloads, never the DOM event.
  - **App-rendered forms never submit natively.**
  - The host never calls `stopPropagation`.
  - `wheel`, `touchstart` and `touchmove` aren't in the vocabulary (passive).
- **Dialogs**:
  - `modal(true)` dialogs use `showModal()` at commit, in document order.
  - `cancel` is prevented and sent to the Model.
  - A browser-forced close is re-shown next frame while the Model still wants it open.
  - `close` events are matched to showings, so only the latest showing reaches the handler.
  - Open modals are closed (latest first) before removal, so focus returns.
- **Popovers**:
  - `popoverOpen` uses `showPopover`/`hidePopover`, after modals.
  - `manual` popovers are re-applied every commit.
  - `auto` popovers are applied only when the Model's value or the mode changes.
  - Every `toggle` is sent.
  - Scroll is restored after a `showModal` or `showPopover` that moved focus.
- **Drag and drop**:
  - Sets the drag source's `draggable` data.
  - Computes the active `dropTarget` per `dragenter`/`dragover` and cancels them so drops are allowed.
  - Sends enter/leave only for the target, and handles leaving the window.
  - `dragover` at most once per frame.
  - Drops are always cancelled and their strings and files read.
- **Controlled props** (`value`, `checked`, `selected`, `open`):
  - Set after children exist; no-ops are skipped.
  - Reverted when the Model didn't accept a change.
  - **Selection preservation rules** for focused inputs (rejected edit; transformed value; caret at end).
  - No writes during IME composition.
- **Hydration edits**: a server-rendered control the user changed before adoption keeps its value and gets synthetic `input`/`change` events. Autofill counts. A focused text field gets no `change`.

Exports:

- **`makeHost(document, { warn? })`** (193): host plus `dispose`.
  - Shows the `html` vocabulary plus host-neutral components.
  - **Head sync** owns only tags marked `data-eui`, `<title>`, and `lang`/`dir` on `<html>`. Shell values are restored when no entry sets them.
  - Warns once about shell/head conflicts (static titles, `lang`, classes and `data-*` belong in the root `head`). Silence with `warn: () => {}`.
  - One shell baseline per document.
- **`htmlHost`** (295): the `Html.Host` element operations behind `HtmlCommand`:
  - `focus`, `blur`, `scrollIntoView`, `measure` (rect);
  - `select` (writes the pending value first);
  - `requestSubmit` (returns false if not possible);
  - `showPicker` (falls back to `click()` for a file input).
- **`layer({ document? })`** (362) provides:
  - `Renderer` and `Html.Host`;
  - **`Query.Visibility`/`Connectivity`** from the document;
  - `HtmlSubscription.GlobalEvents` and `AnimationFrames`;
  - `HtmlImages.Images` and `HtmlFiles.Files`.
  - All of these use the given document and its `defaultView`, never globals.
- **`MountOptions`** (397): `{ fallback?, query?, head? }`.
- **`mount(component, props, container, options?)`** (476): a Layer providing nothing; run with `Layer.launch`.
  - Requirements are the root's minus `Html.Host`.
  - Commands and Subscriptions run on **`HtmlScheduler`** unless a Scheduler is provided; render flushes on a microtask.
  - A navigation Command runs in the flush it caused.
  - With two mounts, only the one that owns the head writes it.
- **`mountEffect(...)`** (515) returns the `Root`. `mountRoot` (546) is internal; it also wires the `#hot` HMR session and DevTools auto-attach.
- **`HtmlRoot<V>`** (384): the type guard.
- **DevTools control surface**:
  - `Controllables` reference (800), default no-op.
  - `Controllable` (684):
    - `pause(stateFn)` paints an **inert frozen copy** at a recorded state and hides the live container. The copy runs nothing: no Commands, Subscriptions, fetches, mounts or Layers; lazy components show `fallback`; modals are shown as manual popovers.
    - The live root keeps running hidden, with its modals and auto popovers closed and user input muted.
    - `resume`, `instance(n)`.
  - `ControlledInstance` (715): `dispatch(msg)` logs `Update{source: Dispatch}` and runs after a pending view transition.
  - `Dispatched` (742): `Updated{seq} | Failed{seq} | Ignored{closed|waiting|frozen|unchanged}`.
  - `Painted` (765): `{ fellBack, fallbacks }`.
  - `Recorded` (627): `{ model, queries?, props? }`.
- **View transitions**:
  - `$.viewTransition(types?)` (`Component.ts:719`; doc 655-718) asks; the host decides.
  - `BrowserHost` runs the rest of the flush inside `document.startViewTransition` (`html/internal/dom.ts:661`), passing `types` when `ViewTransition.prototype.types` exists. It skips the animation when the API is missing or `prefers-reduced-motion` is set.
  - The flush waits about a frame. The DOM patch, head, navigation scroll/focus and `afterCommit` land inside the callback.
  - Messages that arrive meanwhile render in the callback. Their types are dropped once the transition has started.
  - Commands start immediately, so the history push has already happened.
  - First mount and hydration never animate.
  - The transition is per document: a second root in the same frame cancels the first's animation, but both updates commit.
  - Give animated elements a `viewTransitionName` that is unique on screen.
  - Logged in `Update.viewTransition` (`MessageLog.ts:290`). TestHost and the server ignore it.

## 8. `html/BrowserRouter.ts`

- **`Options`** (~110):
  - `routes`;
  - `base?: string | (firstSegment) => boolean` (an i18n prefix such as `/en`);
  - `scroll?`, `announce?`, `focus?` (all default true);
  - `window?`.
- **`layer(options)`**: routes in the path.
  - **One per document**: a second build dies, and the claim is released on scope close.
  - Link intent: 50 ms of hover or focus on the Effect Clock, touch at once, and only for links a click would follow.
  - Same-page replaces are throttled to one per **200 ms** (WebKit allows 100 history calls per 10 s). The latest replace is flushed on navigation, click, submit or `pagehide`.
- **`layerHash(options)`**: routes in the fragment (`/#/people/1`), so there are no in-page hash links. Hydrating a prerendered hash shell skips `RouteMismatch`.
- **Interception**:
  - Left click with no modifier, no `target` other than `_self`, no `download`, same origin, and an href the routes parse.
  - `<form method="get">` is intercepted by the same test.
  - A form the host already stopped and that has no app submit handler is navigated, or full-loaded if the routes don't parse it.
  - Works in open and closed shadow roots (listeners are attached per shadow root, ref-counted).
- **On settle**:
  - Scroll: a push goes to the top or to the `#hash` element; a pop restores the saved position (`history.scrollRestoration = "manual"`).
  - Announcement: an `aria-live="assertive"` region gets the head title, else the `h1` text, else the pathname, on the next frame, only if no newer navigation started.
  - Focus: `[autofocus]` in the container, else the hash target (given `tabindex=-1`), else body reset.
  - Quiet navigations skip the announcement and focus, and scroll only on pop or when asked.

## 9. `html/HtmlHead.ts`: HTML head vocabulary

Importing the module registers `merge` as `Html`'s fold and installs document head sync. Without the import, only the title is folded and synced, so the module is tree-shakeable.

- **Entries**:
  - `meta({ name | property, content, key? })` (277). `http-equiv` and charset tags belong to the shell.
  - `link({ rel, href, hreflang?, type?, media?, as?, sizes?, crossorigin?, imagesrcset?, imagesizes?, key? })` (309). No nonce or event attributes.
  - `lang(code)` (323), `dir("ltr" | "rtl")` (332).
  - `jsonLd(object, { key? })` (366): no top-level array (use `@graph`). A runtime deep check throws, with the JSON path, on non-plain objects, `Date`/`Map`/`Option`, or `NaN`/`Infinity`/`undefined` in arrays. **`canonicalJson`** (529): keys sorted, `undefined` dropped, `<` escaped as `\u003c`.
  - `htmlClass(tokens)` (403), `bodyClass` (417): a token becomes framework-owned once any entry contributes it, and is removed when none does, **even if the shell had it**.
  - `htmlData(name, value)` (444), `bodyData` (459): `data-eui` is rejected; the shell value is restored when the last entry goes.
  - `reduce(f(HtmlHead) => HtmlHead)` (614): sees every field, e.g. to derive `og:title`.
- **`HtmlHead`** (551): `{ title, meta[], links[], jsonLd[], html: { lang, dir, class[], data }, body: { class[], data } }`. Also `empty` (626), `marker` (263, `data-eui`), `attributes` (667), `head: View.HeadFold` (850).
- **Identity** (`identity`, 636):
  - meta: `key`, else `name`/`property`;
  - link: `rel=canonical` is a single slot, else `key`, else `rel`+`href`;
  - JSON-LD: `key`, else its canonical form;
  - one entry per `data-*` name;
  - classes are unioned in first-contributed order.
  - Within one node, the later entry wins.
- **`merge(tree, opts)`** (826): Head's rules applied to every slot; conflicts become `Head.Conflict`.

## 10. `html/HtmlHydrate.ts`

- **`hydrate(component, props, container, state, options?)`** (Layer) and **`hydrateEffect`** (670, returns Root):
  - Uses the same props; `Router.props` gives the same props on both sides.
  - Each instance adopts its server Model and **replays `init` only to recover Commands**. Server Commands whose results the Model already has are skipped; those that missed the budget run now.
  - `onMount` fires on adoption.
  - **Mismatch**: nodes before the mismatch stay adopted and the rest is built fresh. Deferred instances are built fresh.
  - An instance whose state decodes asynchronously keeps the server's nodes until decoded.
  - An instance whose Layer was ready on the server but is still building on the client keeps the server's nodes and is **inert** (`LayerPending: Awaiting`): buttons do nothing, links still navigate, forms submit natively, and typed input is kept and replayed.
  - An instance whose Layer was pending or failed on the server adopts at once, and its feature slots keep the server `fallback` nodes.
  - Head sync starts once nothing is waiting.
  - Query entries hydrate from `~query`, and the fetch-free window lasts until `adopted` completes or the first navigation.
- `adopt` (594) is internal: it walks the comment markers and records user edits (the `Edits` class: radio groups, `<select>` default-selection rules, textarea defaults).

## 11. `html/HtmlServer.ts`

- **`renderToHtml(component, props, { budget?, static? })`** returns **`Rendered`**: `{ html, state, model, head, htmlAttributes, bodyAttributes }`, all escaped.
  - Runs in its own scope. `Html.Host` is stubbed (measure returns 0, `requestSubmit` and `showPicker` return false).
  - A MessageLog Layer logs the server run.
  - A Layer that misses the budget, or is marked `Component.provide(..., { server: false })`, renders `fallback` and the instance is deferred.
  - A defect renders the child's `fallback`, and the client rebuilds that child.
  - `static: true`: see §1.
  - Route status is the app's job: 404 for `notFound`, 301 for `redirected`, 302 for `invalid`.
- **`serializeState(state)`**: JSON with `<`, U+2028 and U+2029 escaped, safe inside `<script type="application/json">`.

## 12. `html/HtmlServerHttp.ts` (separate entry, so browser bundles don't pull in `effect/http`)

- **`layerHttp(component, { routes, document(rendered) => string, budget?, static?, status?(route, model) })`**: adds a `GET *` route to `HttpRouter`.
  - Per request: `resolve` the URL. Unresolvable → 404 text. Redirected or normalised → **301**. Invalid search params dropped → **302** to the canonical URL.
  - Otherwise renders under `Router.static` with `Router.props(routes)` as props.
  - Status: 404 for the catch-all, otherwise 200, unless `status` overrides it (`model` is `undefined` if the root failed).
  - Services are captured once at Layer build and **shared across requests**. Use `renderToHtml` directly for per-request services.

## 13. Markdown (`html/Markdown.ts`, `MarkdownParser.ts`, `MarkdownVite.ts`, `MarkdownContent.d.ts`)

- **Vocabulary**: CommonMark **without raw HTML**, plus GFM tables, strikethrough and autolinks, plus island directives (`::Name{attrs}` leaf and `:::Name` container).
  - Rejected with a line number: raw HTML, reference links/images, footnotes, task lists, inline directives, leaf directive labels, disallowed URLs.
  - A bare `:name` in prose, such as `10:30`, is text.
- **URLs**: `isAllowedUrl` (51) accepts relative URLs and `http`, `https`, `mailto`, `tel`. ASCII control characters are ignored, so `java\tscript:` is rejected. `Url` Schema (71).
- **Node types**:
  - Inline: `Text`, `InlineCode`, `HardBreak`, `Emphasis`, `Strong`, `Strikethrough`, `Link{url, title: Option, content}`, `Image{url, alt, title}`.
  - Block: `Heading{level 1-6}`, `Paragraph`, `CodeBlock{language, meta, value}`, `List{isOrdered, startNumber, items}`, `ListItem`, `Blockquote`, `ThematicBreak`, `Table{alignments, headerRow, bodyRows}`, `TableRow`, `TableCell`, `Island{name, attributes, blocks}`.
  - `Document{blocks}`, with `*Encoded` JSON forms (Option becomes value or null).
  - Schemas: `Inline` (422), `Block` (456), `Document` (499).
- **Codec**: `decodeDocument(json, parseOptions?)` (521) is **cached per input object** (passing options skips the cache) and throws outside the vocabulary. `encodeDocument` (544).
- **Islands**:
  - `IslandDefinition` (556) is a struct over string attributes.
  - `islandsFor(definitions, views)` (826) decodes attributes per island. Invalid attributes render nothing and warn once.
  - `IslandView(h, attrs, content, occurrenceIndex)`: the occurrence index is meant for unique child keys.
  - An island with no registered view renders nothing and warns once.
  - `IslandRequirements` collects the views' `R`.
- **Rendering**:
  - `Views<Msg, R>` (592): one override per node. Containers receive their rendered content; `CodeBlock` receives an occurrence index; `TableCell` receives `(content, alignment, isHeader)`.
  - `defaultViews` (750): unstyled semantic elements; table cells get `text-align`.
  - `ViewConfig` (728): `{ views?, islands? }`.
  - `viewBlocks(h, doc, config)` (875) returns an array; `view(h, doc, config)` (980) wraps it in a `div`.
- **MarkdownParser**:
  - `parseMarkdown(src, options?)` (303) and `parseMarkdownWithFrontmatter` (258) return `Parsed{ document, frontmatter: Option }`.
  - `ParseError{line, message}` (36).
  - `Options{ islands?, frontmatter? }` (68): with `islands`, unknown names or attributes fail the parse.
  - Frontmatter is a flat `key: value` block checked against a struct. **A frontmatter block without a `frontmatter` option fails the parse.**
  - A BOM is stripped. Pure, with no dependencies.
- **MarkdownVite**: `markdown(options)` returns a Vite-compatible `Plugin{ name: "effect-ui-markdown", transform }`. Options are validated once. Each `.md` file compiles to `export default <DocumentEncoded>` plus `export const frontmatter`. No parser ships to the browser.
- **MarkdownContent.d.ts**: ambient `*.md` module types; add it to `compilerOptions.types`.

## 14. `@effect/ui-kit` (packages/ui-kit/src)

Unstyled, headless components in the Base UI style. Each is exported under its own name and callable as `X(h, {...})`. `Positioning` and `VirtualKeyboard` are namespaces (`index.ts`).

Common shape:

- Consumer-controlled `value`/`open` props, plus `XEvents` (`Requested…`, `Picked`, `Selected`, …) with `…Reason` literal Schemas.
- An **anatomy** of parts, each taking and returning the consumer's builder.
- CSS variables (`--anchor-width`, `--available-height`, `--transform-origin`, …) and data attributes (`data-open`, `data-starting-style`, `data-side`, …).
- Popups are **manual popovers in the top layer** (no portal).
- Several components set `restore: false` (Dialog, Drawer, DrawerProvider, Tabs, per LLMS.md).

Kinds: `Html.component` means stateful; `fn` means a stateless view function that takes no key.

| Module | Kind | What it is |
| :-- | :-- | :-- |
| Accordion / AccordionItem | component | Panels under headings with show/hide buttons (FAQ); orientation. |
| AlertDialog | fn over Dialog | A modal that requires an answer (e.g. discard draft). |
| Autocomplete | component | Input that suggests completions and keeps free text (combobox engine; filter modes). |
| Avatar | component | Picture with a fallback while loading or on error. |
| Button | fn | Native button that can stay focusable while disabled; `onPress`. |
| Checkbox | component | Controlled checkbox (`checked`, `Toggled`); ARIA and data attributes. |
| CheckboxGroup | component | Shared ticked-values list plus a parent "select all" checkbox; `Updated`. |
| Collapsible | component | One panel toggled by a button; toggle reasons. |
| Combobox | component | Filtering input that picks one or more options. |
| ContextMenu | fn over Menu | Menu at the pointer on right-click or long-press. |
| Dialog / DialogTrigger | component + fn | Popup over the page; modal modes, dismiss reasons, interaction type. |
| DirectionProvider | component | Supplies ltr/rtl to descendants (arrow-key direction). |
| Drawer / DrawerProvider | component | Edge-sliding panel with swipe-to-dismiss, snap points, keyboard inset handling. |
| Field | component | Label, description and error wiring; invalid, touched and focused state; `focusWithin`/`member` helpers. |
| Fieldset | component | Groups fields under a legend; disables them together. |
| Form | component | Focuses the first invalid control after submit. |
| Input | fn | Native text input bound to the caller's Model via `onUpdate`. |
| Menu / MenuTrigger | component + fn | Actions, links, checkbox and radio items, submenus, typeahead, filter. |
| Menubar | component | Row of menus navigated with arrows as one control. |
| Meter | component | Measurement in a known range (needs a label id). |
| NavigationMenu | component | Nav landmark marking the current page's link. |
| NumberField | component | Number input with steppers, drag scrubbing, locale format and parse; change and commit reasons. |
| OTPField | component | One-character inputs for a code; paste and autofill; submits as one value; validation type and input mode. |
| Popover / PopoverTrigger | component + fn | Anchored interactive popup; open and dismiss reasons; side and align. |
| Positioning | namespace | `place()` (pure placement with collision avoidance and boundary), `TrackPosition` mount stream, `positionerStyle`, `arrowStyle`, Side/Align/CollisionBoundary/Padding Schemas. |
| PreviewCard / PreviewCardTrigger | component + fn | Link preview on hover or keyboard focus. |
| Progress | component | Progress bar (needs a label id), stateless. |
| RadioGroup | component | Controlled radios with roving focus; `Picked`. |
| ScrollArea | component | Native scroller with custom scrollbars, overflow state and edge-fade CSS variables. |
| Select | component | Button plus listbox popup (large anatomy, scroll arrows, `field.member` integration). |
| Separator | fn | Horizontal or vertical divider. |
| Slider | component | One or more thumbs; `Moved`. |
| Switch | fn | On/off control. |
| Tabs | component | Tablist and panels; orientation, activation direction; `Selected`. |
| Toast / ToastProvider | component | Notification stack with timeouts. |
| Toggle | fn | Pressed/unpressed button. |
| ToggleGroup | component | Toggles that share a value array. |
| Toolbar | component | Single tab stop with arrow-key focus across controls. |
| Tooltip / TooltipProvider | component | Hover or focus label; provider shares delays. |
| VirtualKeyboard | namespace | `TrackKeyboard` stream plus `Band`: the visible area above the software keyboard. |
| VirtualList | component | Windowed list: scroll targets, align, flow or absolute layout, measuring, `reserveStart`, `firstPosition`/`setSize`, grid lanes, external scroll container, `trackScroll`. |

Shared internals (`src/internal/*`):

| File | What it provides |
| :-- | :-- |
| `attributes` | `flag` data attributes, style and token merging, `visuallyHidden`, id selectors. |
| `blocker` | Backdrop and outside-press blockers, dismiss spans, cut-out paths. |
| `checkboxGroup`, `menubar` | Shared-state Schemas for provider-style coordination. |
| `combobox` | Shared engine for Combobox and Autocomplete: Item/Interaction/Reason/FilterMode Schemas, Model and Message. |
| `detached` | Channel for detached subscriptions. |
| `direction` | RTL detection; `TrackDirection` mount stream. |
| `dom` | Focusable and tabbable detection, `focusVisible`, per-document singletons, radio groups. |
| `drawerKeyboard` | Keyboard-inset tracking. |
| `field` | Field context lookup. |
| `filter` | Text filter. |
| `formInputs` | Hidden native form inputs and autofill matching. |
| `hoverArea`, `safeArea`, `inlineRect` | Pointer safe-triangle and hover-intent geometry. |
| `interaction` | Escape and scrollbar detection, pointer point. |
| `list` | Keyed, valued and grouped items, stepping with loop modes, arrow keys by orientation and RTL. |
| `modal` | `hideOthers` (aria-hidden), scroll lock, layer ordering. |
| `number` | Intl number format and parse, typing and keystroke filters. |
| `outside` | Outside-press detection. |
| `platform` | Android, iOS, WebKit, Gecko and Mac sniffing. |
| `range` | Clamp, percentage, NVDA label. |
| `requirements` | Type helper. |
| `topLayer` | Keep-on-top, raise-above, portal box styles. |
| `transition` | Starting/ending-style data attributes, waiting for animations to finish. |
| `tree` | Rewriting view nodes to decorate parts. |
| `typeahead` | Printable-key typeahead. |
| `viewport` | `TrackViewport` and viewport-change transitions. |

## 15. `@effect/ui-opentui`

A terminal target for Effect UI built on `@opentui/core` (^0.9.9; Node 26.4+ with `--experimental-ffi`, or Bun 1.3.14+).

- **`OpenTui`**:
  - `OpenTui.component`, the `H` builder, and `OpenTui.Host`, the vocabulary marker so mounting on the wrong host is a type error.
  - Element vocabulary: `box`, `scrollbox`, `lineNumber`, `text`, `span`, `b`, `i`, `u`, `a`, `br`, `input`, `textarea`, `select`, `tabSelect`, `slider`, `code`, `diff`, `markdown`, `asciiFont`.
  - Plain-data event payloads and `OpenTui.ref`.
- **`OpenTuiHost`**: `makeHost({ renderables?, onTitle? })` (custom renderable constructors; the folded head's title is forwarded to `onTitle`), `layer`, `layerFromRenderer`, `mount`, `mountEffect`, `run`. It implements `Renderer.Host` over a `CliRenderer`, manages controlled input, select and focus state, bridges global terminal events and owns the renderer's lifecycle. It has no hydration and no document head.
- **`OpenTuiSubscription`**: global `onKeyPress`, `onKeyRelease`, `shortcuts`, `onPaste`, `onResize`.
- **`OpenTuiKeyboard`**: a pure shortcut-table matcher.
- **`OpenTuiCommand`**: ref Commands `focus`, `blur`, `scrollTo`, `scrollBy`, `measure`, plus `quit`.
- **Testing**: `TestOpenTuiEvents` (FFI-free TestHost fakes) and `OpenTuiTest` (a native frame-rendering harness).
- It demonstrates that the core runtime is host-agnostic: `examples/snake-tui` reuses `examples/snake`'s domain.

## 16. `examples/`

| Example | What it demonstrates |
| :-- | :-- |
| `counter` | Minimal `Html.component` with `Head` title and ui-kit `Button`; story test. |
| `counters` | A list of keyed child `Counter` components (`Counter(h, { key })`); play test. |
| `auth` | Router-guarded app. The Model is a TaggedEnum `LoggedOut{route} \| LoggedIn{route, session}` with redirect-on-guard. `appProps` is an **Effect** combining `Router.currentRoute` and a `SessionStore` over `KeyValueStore`. `Command.Service` `SaveSession` returns `AppMessage \| Component.Noop`. `BrowserRouter.layer`. |
| `routing` | `Route.union` with params, rest (`*`) params, a deeply nested route and NotFound. `Component.lazy` page (PeoplePage). `Query.Service` `SearchPeople` with `staleTime: "Infinity"` and a component `queries` entry. `Router.patchSearch` for search text. Per-route `Head` titles. ui-kit `NavigationMenu`. `BrowserHost.mount(App, Router.props(AppRoute))` plus `BrowserRouter.layer`. |
| `file-preview` | `HtmlFiles.readAsText` inside `Command.make(..., { mode: "switch" })`: the newest file read cancels the previous one; a TaggedEnum preview state. |
| `interrupting-commands` | `Command.Service` `UploadFile` with `group: ["uploadId"]` and `mode: "switch"`; cancel, cancel-all and restart per upload. `check-devtools.mjs` checks the DevTools timeline. Story and scene tests. |
| `canvas-art` | `Canvas` element, animation-frame ticks via `HtmlSubscription`, `Random` in Commands, ui-kit `Button`; story test. |
| `snake` | Game loop with `Subscription.make` (tick Stream) and `HtmlSubscription.shortcuts` keyboard; domain modules; story, scene and play tests. |
| `snake-tui` | The same game on OpenTUI (`@effect/ui-opentui`), importing `snake`'s domain and constants. |
| `web-components` | `Html.customElement({ tag, properties, events })` wrapping third-party custom elements (`hex-color-picker`, Shoelace `sl-qr-code`); scene test. |
| `virtual-list` | One page per `VirtualList` feature (header, shell scroll container, paged, fixed size, chat with `reserveStart`, progress with `trackScroll`, table, absolute layout, grid, 100k rows). `check-history.mjs` is a Playwright check that the message under the pointer stays in place as older pages load. |
| `launch` | The launch-article site (Cloudflare `wrangler.json`). Markdown article plus frontmatter via MarkdownVite, with islands. `DevTools.layer({ position })`. Side-by-side Effect-UI vs Foldkit ports (`counter/`, `queries/posts`). A provider/shares demo (`CartProvider`, `Shop`). Headless parts (`Disclosure`, `Details`). The ui-kit gallery (`kit/`). Diagram player. Playtest/trace. Nav scene. Performance chart. Story, scene and play tests throughout. |

## Notable concepts not in LLMS.md

LLMS.md mentions only `Query.Service`/`InfiniteService` declarations, `invalidates` with `Query.Tag`, `debounce`/`queryMany` once, Validation and `checklist`, history restore and the `restore` option, `Router.replace`/`patchSearch`, `Component.lazy`, `$.viewTransition`, and links to SSR and Markdown docs. It does not mention:

- **Query entry options**: `staleTime` semantics (required; 0 or `"Infinity"`), `idleTimeToLive` (5 min default, per query or per mount via `mount({ query })`), `refetchInterval` (function form, the bare-number-under-1000 rule).
- **Query statics**: `get`'s revert, interrupt and in-run rules; `prefetch`, `peek`, `changes`; `invalidate` restarting in-flight fetches.
- **Infinite queries**: `loadMore`, `reset`, `items` deduplication, `More` states, `LoadedMore`, sequential re-walks, shared page count, first-page-only SSR, the `history.state` growth caveat; `$.loadMore`/`$.reset`.
- **Optimistic updates**: `patch`/`patchAll` lifecycle, `set`/`writes`, `UncoveredWrite`, `PatchMutated`/`PatchInvalid`, `applyPatches`/`invalidatesEntry` test helpers, `Command.afterRefetch`.
- **Host signals**: `Visibility`/`Connectivity` (refetch on focus/reconnect; intervals pause while hidden or offline), the `Trigger` taxonomy, the `Problems` sink and all 13 Query problem classes.
- **Key encoding**: top-level `undefined` dropped; `NullOr` collapsing; Redacted args redacted in log keys.
- **View helpers**: `h.previous` and `h.patched`; `KeyedResults.get`; `onChange` delivery ordering.
- **Fetch-free hydration window**; `static: true` CDN semantics; `budget` (500 ms) behaviour; per-request server cache ignoring `staleTime`; `CommandDropped`/`ServerCommandIssued` on the server; query data being public in page state; same-build requirement for state decoding; `~deferred`/`~reported`/`~static` keys.
- **Router surface**: `Location`/`Action`/`seq`; `Outcome`/`PatchOutcome` (`stale`); `Router.blocked` (and what it can't block); `Router.prefetch`/`Router.page`/`intent` (50 ms hover, 30 s guard) plus 4 prefetch problems; `RouteMismatch` exemptions; synchronous in-flush delivery; quiet vs loud `Settled`; `Router.make` with a custom `History`, `onSettled`, `onHash`, `onLeave` and `throttle`; `HistoryWriteFailed`/`SnapshotWriteFailed`/`PatchSearchLostBlock`; `memoryHistory`/`Router.memory`/`Router.static`.
- **Snapshot persistence**: written into `history.state` only on push, memory-only on pop, dropped after the first mount after reload, restored query results seeding cold entries as stale.
- **BrowserRouter**: `base` function (i18n prefix), `layerHash`, one Router per document, the 200 ms replace throttle, GET-form interception, shadow-root support, the announcement and focus algorithm, `scroll`/`announce`/`focus` options.
- **Route**: ranking and fall-through rules, required search field → 404, `resolve` (`redirected`/`notFound`/`invalid`) and server status mapping, `Route.redirect`, `setBase`/`base`, `printPath` vs `print`, reserved tags, decoding defaults omitted on print.
- **Head**: `Head.titleTemplate`, `Head.reduce`, path-ordered fold, unset-on-conflict plus `Head.Conflict`, `head: false` mounts.
- **HtmlHead**: `meta`, `link`, `lang`, `dir`, `jsonLd` (canonical JSON, deep checks), html/body class and data, identity rules, `data-eui` ownership and shell restore, shell conflict warnings.
- **Renderer**: `Host`/`Hydration`/`HostEvents` contract (third-party hosts), `Dispatch` `onMessage` timing, `Refs`/`ref().at()` and the `Ref` Schema, `Root.adopted`, `Renderer.prerender`, `ServerNode`, failure boundaries per child.
- **BrowserHost behaviour**: delegated capture-phase events, never-native form submit, dialog and popover top-layer rules, drag-and-drop engine, controlled-prop selection and IME rules, hydration edit replay, `htmlHost` element ops, `HtmlScheduler` default; DevTools control: `Controllables`/`Controllable.pause` frozen inert copy/`ControlledInstance.dispatch`/`Dispatched`/`Painted`.
- **View transition details**: `types`, reduced motion, flush deferral, one per document, never on first mount or hydration.
- **HtmlHydrate**: mismatch recovery, Layer-pending inert instances, `init` replay, `onMount` on adoption.
- **HtmlServer / HtmlServerHttp**: `serializeState` escaping; 404/301/302 rules, `status` override, shared services across requests.
- **Markdown**: the vocabulary's exclusions, URL allowlist, `decodeDocument` caching, `islandsFor` typed islands, `Views`/`defaultViews` overrides, occurrence indices, frontmatter-requires-option rule, `MarkdownContent` types.
- **Validation**: `Rule.*` defaults list, `fromSchema`, `isEmpty`, function-form `required`, `errors: "all"`, async `Checks` → `Validating`, `passes`, data-last `change`/`blur`/`reject`, `Validated.value` gating.
- **ui-kit**: the inventory and shared infrastructure (top-layer popovers, Positioning engine, mount streams such as `TrackPosition`/`TrackKeyboard`/`TrackViewport`/`TrackDirection`).
- **ui-opentui**: the package as a whole.
