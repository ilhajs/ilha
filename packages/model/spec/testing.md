# `@ilha/model/test` (wave 2): Story, Scene, Play, TestHost, `ssr()`

Pure cursors (`Story`, `Scene`) run `src/test/engine.ts`: `init`/`update` synchronously, Commands through the shared `internal/schedule.ts`, views through core `h` with model extras. `Play` mounts with the real Ilha renderer under happy-dom (`ilha/test`'s `render`) and the real runtime; its log comes from a page-global `MessageLog.memory` attached per host.

## The acknowledgement rule (SPEC §13, `testing §1`)

- Message steps (`send`, `subscription`, Scene interactions, `childEmit`/ `childFailure`, `resolve`/`fail`/`next`/`end`): throw while a Command is pending (unless exempt: `switch`/`queue` mode, a stream, or `keepPending`), while an enabled query has no result at its args (Query slice), or while a Scene mount isn't acknowledged (mounts slice) — or while an event, send, or ignored interaction is unacknowledged.
- Every acting step (`props`, `given`, `childPending`, `mounted`, …) throws only on unacknowledged outputs.
- Pure assertions (`emitted`, `check`, `expect*`, `expectMount`, `expectIgnored`, `expectDefaultPrevented`) never trigger the checks.
- End check (`make`'s scope close, never `start`): fails on anything pending (kept or exempt included), an unloaded query unless kept, an unacknowledged mount, or an unacknowledged output. Skipped when the scope closes with a failure. `given` after an acting step throws rather than discard pending work, outputs, mounts, or a query entry the new Model would disable.
- Error format: `"<Module>.<step>: earlier work isn't settled or acknowledged:\n  - …"`, each item with a hint. A step error is rethrown with the call site's stack.

## What exists per cursor

- `Story`: `send` (updaters allowed; `undefined`/`noop` are no-ops), `subscription` (throws listing active keys; duplicate keys throw), `layerFailed` (no-op until the provide slice lands), `props` (never reaches `update`), `given` (model or updater; drops init Commands/events/ sends), `resolve`/`fail`/`next`/`end` (raw result, `Command.map` replayed; `fail` needs a `match`ed failure; silent `noop` delivers nothing; interrupts cut runs into `interrupted`), `emitted` (Schema-equivalence order check), `keepPending` (Commands only so far), `check`, `expectExact`/`expectHas`/`expectNone`, `send`-less `Sent` acks, `model`, `results`/`queries` (opaque until the Query slice), `parts` (not wired), `fromLog` (live entries; Wire frames decode where the shape is plain JSON; placeholders fail naming the entry and field; `QueryChanged` fails with `writes "x", which isn't a query` until the Query slice; instance tracking with last-instance-wins; Model/events by Schema equivalence, Commands by name and JSON args).
- `Scene`: pure view VNodes; children are leaves named component-then-key. Steps: `click` (string = `Locator.text`; pointerdown/mousedown/mouseup/ click with the cancellation rules; submit/checkbox/radio/popover defaults read from the fresh view; disabled controls throw), `fire`/`type`/`change`/`keydown` (`editable` derived)/`submit` (form fields + optional submitter)/`focus` (`focusVisible: true`) /`blur`, `childEmit` (missing `onEmit` mapping marks ignored; stub components emit to every mount when keyless), `childFailure`/`childPending` (fallback branch from `AsyncResult.initial(true)`/`failure`; missing `onFailure` marks ignored), `expect*` (+`toHaveValue`, `toBeChecked`, `toBeDisabled`, `toHaveAccessibleName`), `expectHandled` (no-op ack), `expectIgnored` (required after an ignored interaction; throws after any other step), `expectDefaultPrevented` (submit always cancels), `children`/`fallback` over the view tree. Payload shapes: click `{button:0,x:0,y:0,shiftKey,ctrlKey,altKey,metaKey:false, pointerType:"mouse"}`; type `{value,data,inputType,composing,checked?}`; change `{value|…payload,composing:false,inputType:""}`; keydown `{key,modifiers…,composing:false,repeat:false,editable,…details}`; submit `{fields,submitter}`.
- `Play`: real renderer; every step settles before and after. `click` (string = CSS selector, locator = DOM snapshot), `fire` (payload fields assigned onto the event), `type`/`change` (write the DOM prop first), `keydown` (keydown then keyup; `"document"` supported), `submit`, `focus`/`blur`, `expect` (settled DOM), `expectIgnored` (Update-entry growth during the synchronous dispatch window). No `send`, no shared steps: Commands, events and sends need no acknowledgement.
- `TestHost`: `mount` (own container, first-render settle), `settle` (bounded macrotask quiescence; `RootCrashed` on `onError`, `ProblemsError` on unconsumed problems, `SettleError` with the last-20 log lines and pending on exhaustion), `pending` (open `CommandStarted` without end; `awaiting` when a `CommandAwaiting` is open; fetches as running — the Query slice refines this), `problems`/`report`/ `expectProblem` (log `Failed`/`CommandDropped`/`SendDropped` plus reported; consumed problems are suppressed), `setVisible`/`setOnline` (dispatch `visibilitychange`/`online`/`offline`; the Query slice's host signals read these), `formatLog`/`formatTimeline` (orphans show `(after #n)`), `stub(name, {props, events})` (renders `<stub data-stub="name">`, records distinct props, emits via a queue-backed subscription; backlog flushes on first mount).
- `ssr()`: server render → fresh container → hydrate → settle. Fails with `SsrError` on server failure, hydration errors, pre-settle HTML mismatch (rebuilt node), post-settle mismatch (drift), unadopted or non-round-tripping Models, and any log problem. Returns `{html, container, model, adopted, log, unmount}`. No `TestClock`: the harness runs on live clocks; clock-driven work stays pending and visible via `pending()`.

## Unwired steps (wave 3 slices)

| Step | Slice | Owner (guess) |
| --- | --- | --- |
| `loaded`, `loadFailed`, `loadedMany`, `loadedMore`, `loadMoreFailed`, `waitExpired`, `keepPending(name)`, `queries`/`results`, `QueryChanged` replay, fetch-free window, query round-trip in `ssr()` | query | QueryIntegration |
| `shared`, `sent`, `collected`, given's `shared` | shared state | Composition |
| `mounted`, `expectMount`, mount end-check | mounts/refs | ElementEffects |
| `givenChild`, `parts`, headless `make(view)` | parts | Composition |
| `fireDocument`, `fireWindow`, `fireCustomEvent`, `frame` | DOM events | ElementEffects |
| `layerFailed` mapping, `ssr()` Layer wait, `provide` R | provide/Feature | Services |
| queued/stopping/fetched/held `pending` refinements | log-derived | TestHost owner |

Calling one throws `Steps.<step>: … needs the <slice> slice, which isn't registered yet (see spec/testing.md "Unwired steps")`.

## Step-extension API (for wave-3 slices)

```ts
import { registerTestExtension } from "@ilha/model/test";

registerTestExtension({
  name: "query", // used in notWired errors and this doc
  steps: {
    // Extra cursor steps: (ctx, ...args) => void, throwing fails the step.
    loaded: (ctx, name, ...rest) => {
      /* … */ ctx.dispatchMessage(msg);
    },
  },
  helper: (ctx) => ({ queries: openQueries(ctx) }), // merged into view `h`
  inFlight: (state) => ["…"], // blocks message steps
  allPending: (state) => ["…"], // end check + given
  outputs: (state) => ["…"], // unacknowledged outputs
  checkGiven: (state, model) => ["…"], // work the new Model would discard
});
```

`ExtensionContext` gives `dispatchMessage`, `slice(name)`/`setSlice`, `fail(step, what, problems)` (acknowledgement-rule format) and, on `EngineInternals`, `settleRun(entry)` (promote the group's queued run), `deliver(message)`, `refreshChildren()` and `module`. The base engine owns the scheduler, the loop guard, and the record; slices own their state under `state.slices[name]`. `Story`/`Scene` expose every registered step whose name doesn't collide with a base step. Keep steps synchronous and pure: the engine re-renders after every step, so slice state must settle inside the step that changed it.
