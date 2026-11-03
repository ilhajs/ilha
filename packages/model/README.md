# `@ilha/model`

Elm-style Model, `update`, commands, and subscriptions for [Ilha](https://github.com/ilhajs/ilha) islands. One state tree per island, every change through a single `update` function.

---

## Installation

```bash
bun add @ilha/model
```

---

## Usage

```tsx
import { defineApp } from "@ilha/model";
import { Data, Match } from "effect";

type Message = Data.TaggedEnum<{
  Decrement: {};
  Increment: {};
}>;
const Message = Data.taggedEnum<Message>();

const app = defineApp({
  init: () => ({ count: 0 }),
  update: (model, message) =>
    Match.value(message).pipe(
      Match.tag("Decrement", ({ count }) => ({ model: { count: count - 1 } })),
      Match.tag("Increment", ({ count }) => ({ model: { count: count + 1 } })),
      Match.exhaustive
    ),
  view: (model, dispatch) => (
    <div>
      <p>{model.count}</p>
      <button type="button" onclick={() => dispatch(Message.Decrement())}>
        -
      </button>
      <button type="button" onclick={() => dispatch(Message.Increment())}>
        +
      </button>
    </div>
  ),
});

export const Counter = app.component;
```

Mount it like any Ilha component: `mount(host, Counter)` or `await renderToString(Counter)`.

See [Model](https://ilha.build/guide/model) for commands, subscriptions, submodels, and testing.
