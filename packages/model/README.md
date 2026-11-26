# `@ilha/model`

Elm-style model components for [Ilha](https://github.com/ilhajs/ilha) islands. Each component instance owns one model atom; every change flows through a single `update` function. Side effects run as Commands, ongoing work as Subscriptions.

## Installation

```bash
bun add @ilha/model
```

`ilha` and `effect` are peer dependencies.

## Usage

```tsx
import {
  Command,
  Subscription,
  defineComponent,
  attachModelRecorder,
} from "@ilha/model";
import type {
  DispatchRecord,
  ModelRecorder,
  ModelComponent,
  Step,
  Issued,
} from "@ilha/model";
import { Story } from "@ilha/model/test";
import { Effect, Layer, Schema, Stream } from "effect";
import { mount } from "ilha";

const Msg = Schema.TaggedUnion({
  ClickedAdd: { amount: Schema.Number },
  ClickedReset: {},
  CompletedReset: {},
});

const DelayReset = Command.make("DelayReset", { mode: "switch" }, () =>
  Effect.sleep("1 second").pipe(Effect.as(Msg.cases.CompletedReset.make({})))
);

export const Counter = defineComponent({
  name: "Counter",
  props: Schema.Struct({ label: Schema.String }), // optional
  model: Schema.Struct({ count: Schema.Number }), // also the SSR snapshot codec
  message: Msg,
  events: Schema.TaggedUnion({ Reached: { count: Schema.Number } }), // optional
}).make({
  init: ($, props) => ({ count: 0 }), // Model | Step
  update: {
    // exhaustive record, one handler per tag
    ClickedAdd: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
    ClickedReset: ($) => $.run(DelayReset()),
    CompletedReset: ($) =>
      $.set({ count: 0 }).emit({ _tag: "Reached", count: 0 }),
  },
  view: (h, model) => (
    <div>
      <span>{h.props.label}</span>
      <output>{model.count}</output>
      <button onclick={h.send(Msg.cases.ClickedAdd.make({ amount: 1 }))}>
        +1
      </button>
      <button
        disabled={h.isRunning(DelayReset)}
        onclick={h.send(Msg.cases.ClickedReset.make({}))}
      >
        Reset
      </button>
    </div>
  ),
  subscriptions: (model, props) => [], // optional
  layer: Layer.empty, // optional
});

// parent view:  <Counter key="likes" props={{ label: "Likes" }} onEmit={h.send((e) => PageMsg.cases.Reached.make(e))} />
// root:         mount(host, () => <Counter props={{ label: "Likes" }} />)  — no root helper
```

Notes:

- `$` in `init`/`update` has `props`, `set(model)`, `evolve(patch)` (each field a value or `(prev) => next`), `run(...issued)`, `emit(event)`; `update`'s `$` also has `model`. Handlers return a bare `Model` or a `Step`.
- `h` in `view` is Ilha's `h` plus `props`, `send(message | (arg) => message | undefined)`, and reactive `isRunning(command)`.
- `Command.make(name, body)` issues concurrently; `{ mode: "switch" }` interrupts the instance's running issue of the same command. Nothing runs during SSR; init commands run on the client after mount/hydration.
- `Subscription.make(name, stream)` or `make(name, deps, (deps) => stream)`; deps compared with `Equal.equals`, restarted on change, stopped when removed.
- `layer` is built once per instance on the client and provides commands and subscriptions.
- Throws in `init`/`update`/`view` go through Ilha's normal error path (`ErrorBoundary` / mount `onError`).

## Testing with Story

`Story` runs the loop synchronously with no Effect and no DOM: `init` runs (commands are recorded, never executed), `send` feeds messages through `update`, `emitted` collects events, `commands` lists pending `{ name, args }` issues, and `resolve(command, message?)` drops the oldest pending issue and optionally feeds a message back.

```tsx
const story = Story.make(Counter, { label: "Likes" });
story.send(Msg.cases.ClickedAdd.make({ amount: 2 }));
expect(story.model).toEqual({ count: 2 });
expect(story.commands).toEqual([{ name: "DelayReset", args: undefined }]);
story.resolve(DelayReset, Msg.cases.CompletedReset.make({}));
expect(story.model).toEqual({ count: 0 });
```

## Migration from 0.1

| 0.1 | 0.2.0 |
| --- | --- |
| `defineApp({ init, update, view })` + `app.component` | `defineComponent({ name, model, message, props?, events? }).make({ init, update, view })` |
| `update(model, message)` switch | `update` record, one handler per tag: `ClickedAdd: ($, { amount }) => ...` |
| `{ model, cmd }` returns | `$` steps: `$.set(...)`, `$.evolve(...)`, `$.run(...)`, `$.emit(...)`; or return a bare model |
| `keyed(key, cmd)` | `Command.make(name, { mode: "switch" }, body)` (`"concurrent"` is the default) |
| `subscription({ deps, stream })` | `Subscription.make(name, deps, (deps) => stream)` |
| `runCommands` / `simulate` in `@ilha/model/test` | `Story.make(Component, props?)` with `send` / `resolve` |
| `foldChild` / `combine` submodels | child components with `props` + `onEmit` |
| `Component.root`, typed `View<R>` | gone: mount a closure, `mount(host, () => <Counter props={...} />)` |
| Query, Validation, MessageLog, `./devtools`, shares/reads, slots, keepAlive, lazy, Feature, provide, clientOnly, headless parts, Mount/Dom*/Keyboard/DomFiles/DomImages, TaggedEnum, standalone `evolve`, Scene/Play/TestHost/locators/ssr harness | gone |
