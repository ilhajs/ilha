# ilha migrations

Generated from `MIGRATIONS.json` by `scripts/agent-docs.ts`. Do not edit by hand.

Removed and changed APIs, each with its replacement. Machine-readable form: `MIGRATIONS.json`. Index for LLMs: https://ilha.build/llms.txt

## resource, invalidate

- Status: removed
- Import: `ilha`
- Replacement: An Effect Cache in a module, read through atom(Effect).
- Docs: https://ilha.build/guide/recipes/data-fetching

Before:

```ts
const user = resource("user", (id, { signal }) => fetchUser(id, signal));
user.data();
```

After:

```ts
const users = Effect.runSync(
  Cache.make({ capacity: 100, lookup: loadUser, timeToLive: "1 minute" })
);
const user = atom(Cache.get(users, id)); // AsyncResult
```

## fromEventSource

- Status: removed
- Import: `ilha`
- Replacement: Stream.callback over EventSource with Stream.retry.
- Docs: https://ilha.build/guide/recipes/server-sent-events

Before:

```ts
const feed = fromEventSource("/events");
yield Stream.map(feed.stream, (m) => <p>{m}</p>);
```

After:

```ts
const events = Stream.callback<string>((queue) => { /* see recipe */ });
yield Stream.map(events, (m) => <p>{m}</p>);
```

## define

- Status: removed
- Import: `ilha/define`
- Replacement: Copy the define() helper from the custom-elements recipe; it calls mount() in connectedCallback.
- Docs: https://ilha.build/guide/recipes/custom-elements

Before:

```ts
import { define } from "ilha/define";
define("ilha-counter", Counter);
```

After:

```ts
import { define } from "./define"; // helper from the recipe
define("ilha-counter", Counter);
```

## structuralEqual

- Status: removed
- Import: `ilha`
- Replacement: Equal.equals from effect, or the equals: "structural" atom option.
- Docs: https://ilha.build/guide/ui/state

Before:

```ts
atom(value, { equals: structuralEqual });
```

After:

```ts
atom(value, { equals: "structural" });
// or: import * as Equal from "effect/Equal"; Equal.equals(a, b)
```

## renderToString option captureActions

- Status: removed
- Import: `ilha`
- Replacement: Remove the option. SSR no longer captures actions; hydration restores state from the embedded snapshot.
- Docs: https://ilha.build/guide/ui/render

Before:

```ts
await renderToString(Component, { captureActions: true });
```

After:

```ts
await renderToString(Component);
```

## internal island mount hook (ISLAND_MOUNT_INTERNAL)

- Status: removed
- Import: `ilha`
- Replacement: None. It was internal. Use mount(host, Component) for every root.
- Docs: https://ilha.build/guide/ui/render

After:

```ts
mount(host, Component, { hydrate: true });
```

## watch, watch.once, when

- Status: changed
- Import: `ilha`
- Replacement: They return Instruction<void>. Call them at the top level of the component (yield* is optional in generators); do not read a return value.
- Docs: https://ilha.build/guide/ui/state

Before:

```ts
const result = yield * watch(count, fn); // loosely typed result
```

After:

```ts
watch(count, fn);
```

## atom(effect | stream)

- Status: changed
- Import: `ilha`
- Replacement: The handle is typed AtomHandle<AsyncResult<A, E>>. Branch on Initial, Success, and Failure instead of reading the value directly. Any atom handle is a valid View.
- Docs: https://ilha.build/guide/recipes/data-fetching

Before:

```ts
const user = atom(fetchUser); // typed as the value
user().name;
```

After:

```ts
const user = atom(fetchUser); // AsyncResult<User, Error>
AsyncResult.isSuccess(user()) && user().value.name;
```

## PaintOps

- Status: changed
- Import: `ilha/renderer`
- Replacement: appendRoot, asRoot, asNode, asElement, createSlotHost, and disconnect are removed. reuseNode, committed, setStyle, setFormControl, and bindEvents are optional. morph is added.
- Docs: https://ilha.build/reference/ilha

Before:

```ts
const ops: PaintOps<Node, El> = {
  createElement,
  createText,
  createRaw,
  placeChildren,
  appendRoot,
  asRoot,
  asNode,
  asElement,
  createSlotHost,
  disconnect /* ... */,
};
```

After:

```ts
const ops: PaintOps<Node, El> = {
  createElement,
  createText,
  createRaw,
  placeChildren,
  morph /* optional: reuseNode, committed, setStyle, setFormControl, bindEvents */,
};
```
