# `@ilha/model`

Effect UI-style components running inside Ilha islands. Each component owns a Model, a message loop, and a pure view; side effects run as Commands, ongoing work as Subscriptions, remote data as Queries.

---

## Installation

```bash
bun add @ilha/model
```

`ilha` and `effect` are peer dependencies.

---

```tsx
import { Command, defineComponent, TaggedEnum } from "@ilha/model";
import { Effect, Schema } from "effect";

const CounterMessage = TaggedEnum({
  ClickedAdd: { amount: Schema.Number },
  ClickedReset: {},
  CompletedReset: {},
});

const DelayReset = Command.make("delay-reset", { args: {} }, () =>
  Effect.succeed(CounterMessage.CompletedReset())
);

const CounterDef = defineComponent({
  name: "Counter",
  props: Schema.Struct({ label: Schema.String }),
  model: Schema.Struct({ count: Schema.Number }),
  message: CounterMessage,
});

export const Counter = CounterDef.make({
  init: () => ({ count: 0 }),
  update: {
    ClickedAdd: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
    ClickedReset: ($) => $.run(DelayReset()),
    CompletedReset: ($) => $.evolve({ count: 0 }),
  },
  view: (h, model) => (
    <div>
      <span>{h.props.label}</span>
      <output>{model.count}</output>
      <button onclick={h.send(CounterMessage.ClickedAdd({ amount: 1 }))}>
        +1
      </button>
      <button
        disabled={h.isRunning(DelayReset)}
        onclick={h.send(CounterMessage.ClickedReset())}
      >
        Reset
      </button>
    </div>
  ),
});
```

Mount it through a root: `mount(host, Component.root(Counter, { label: "Likes" }))`, or `await renderToString(Component.root(Counter, { label: "Likes" }))`.

`h` is Ilha's `h` plus model extras: `props`, `children`, `reads`, `queries`, `previous`, `patched`, `slots`, `keepAlive`, `isRunning`, `id`, `send`, `mount`, `ref`. The same view works in JSX or as typed `h()` calls; prefer typed `h()` when compile-time requirement checks matter (JSX views carry no requirement channel, so a missing service fails at run time instead of compile time).

Children, services, queries, DOM effects, tests, and devtools are covered in [Elm components](https://ilha.build/guide/ui/model). Client-only rendering (`Component.clientOnly`) and `mount(host, Component.root(App, props))` with no server step are covered there too.

`@ilha/model/validation` holds field validation. `@ilha/model/test` holds `Story` (pure update tests), `Scene` (pure view tests), `Play` (real-runtime tests), locators, fakes, and `ssr()`.

### Keep-alive limit

`h.keepAlive` keeps a hidden child's Model, query results, running Commands, Subscriptions, and Layer. Its DOM is rebuilt when it is drawn again: uncontrolled DOM state, scroll, and focus are not preserved.

---

## Migration from 0.1

| 0.1 | 0.2 |
| --- | --- |
| `defineApp({ init, update, view })` | `defineComponent({ name, props, model, message, events? }).make({ init, update, view })` |
| `UpdateResult`, `cmd` in the result | `$.set` / `$.evolve` / `$.run(...)`, or return a bare Model |
| `Cmd`, `Dispatch` | `Command`, `h.send(...)` |
| `keyed` | `Command.make` with `mode: "switch"` / `"queue"` and `group` |
| `subscription()` | `Subscription.make(name, deps, build)` |
| `foldChild`, `combine` | child components with `key`/`props`/`onEmit`, plus `$.combine` / `$.send` |
| `FoldChildOptions` | removed |
| `attachModelRecorder`, `DispatchRecord`, `ModelRecorder` | `MessageLog.attach`, `MessageLog` entries |
| `schema` option | Schemas on `props` / `model` / `message` |
| `runCommands`, `simulate` | `Story`, `Scene`, `Play` from `@ilha/model/test` |
