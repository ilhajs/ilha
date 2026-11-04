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
import type { Dispatch } from "@ilha/model";
import { Data } from "effect";

type Message = Data.TaggedEnum<{
  Decrement: {};
  Increment: {};
}>;
const Message = Data.taggedEnum<Message>();

interface Model {
  readonly count: number;
}

const app = defineApp({
  init: () => ({ model: { count: 0 } }),
  update: (model: Model, message: Message) =>
    Message.$match(message, {
      Decrement: () => ({ model: { count: model.count - 1 } }),
      Increment: () => ({ model: { count: model.count + 1 } }),
    }),
  view: (model: Model, dispatch: Dispatch<Message>) => (
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

See [Elm architecture](https://ilha.build/guide/ui/model) for commands, subscriptions, submodels, and testing.
