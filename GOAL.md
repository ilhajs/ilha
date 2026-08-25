Refactor Ilha’s core API to remove the fluent builder completely and replace it with React-style
function components backed by persistent, order-based reactive primitives.

This is an intentional breaking redesign. Do not preserve the fluent builder as a compatibility
layer.

## Project constraints

Read and follow `AGENTS.md`, but treat its fluent-builder requirements as superseded by this task.
Update `AGENTS.md` to describe the new API.

Keep these architectural properties:

- Bun monorepo and existing package structure
- Core implementation in `packages/ilha/src/index.ts`
- JSX runtime in `packages/ilha/src/jsx-runtime.ts`
- No virtual DOM
- No compiler requirement
- Signal-based reactivity through `alien-signals`
- SSR, async SSR, hydration, nested islands, keyed children, morphing, bindings, custom elements,
  and router integration
- Both JSX and `html`` ` authoring modes
- Plain function components remain transparent; `ilha()` creates an island boundary
- Existing security protections, snapshot limits, prototype-pollution protection, cancellation,
  focus preservation, and morph behavior

Do not add dependencies.

## Target API

An island is a function component that returns JSX or `RawHtml` directly:

```tsx
import { ilha, state, derived, action, effect, onError } from "ilha";

const Counter = ilha<{ start?: number }>(({ start = 0 }) => {
  const count = state(start);
  const double = derived(() => count() * 2);

  effect(() => {
    console.log(count());
  });

  effect.once(({ host, signal, hydrated }) => {
    host.classList.add("ready");

    return () => {
      host.classList.remove("ready");
    };
  });

  return <button onclick={() => count((value) => value + 1)}>{double()}</button>;
});
```

Ilha reruns the component when tracked reactive dependencies change. Each primitive retrieves a
persistent slot based on call order and primitive kind.

Remove the fluent builder

Delete the fluent root and IlhaBuilder, including these methods:

```ts
ilha.input();
ilha.as();
ilha.state();
ilha.derived();
ilha.action();
ilha.on();
ilha.effect();
ilha.onMount();
ilha.onError();
ilha.css();
ilha.render();
```

Do not leave deprecated aliases or a hidden compatibility builder.

Remove builder-specific accumulated generic types, configuration records, collision checks, keyed
name maps, and callback contexts that become unnecessary.

The only island constructor is:

```ts
ilha(component);
ilha<Props>(component);
ilha(schema, component);
```

Exact overloads should be minimal and type-safe.

Component execution semantics

The component function runs:

- Once during each synchronous SSR render
- Once during each async SSR render
- During initial client mount
- Again when a signal read during rendering changes
- Again when parent-provided props change

Primitive slots persist across client rerenders.

Props are ordinary current values passed to the component:

```tsx
const Greeting = ilha<{ name: string }>(({ name }) => {
  const uppercase = derived(() => name.toUpperCase());
  return <p>Hello, {uppercase()}</p>;
});
```

A state initializer applies only when the instance is created:

```tsx
const Counter = ilha<{ start: number }>(({ start }) => {
  const count = state(start);
  return <p>{count()}</p>;
});
```

Later start changes rerender the component but do not reset count.

Primitive rules

These calls are order-based hooks:

```ts
state();
derived();
action();
effect();
effect.once();
onError();
```

Rules:

1.  Call primitives at the component’s top level.
2.  Call them in the same order and with the same primitive kind on every render.
3.  Call them only while an island or a plain component owned by an island is rendering.
4.  Put conditional and asynchronous logic inside primitives, not around primitive registration.

Invalid:

```ts
if (enabled) {
  const value = state(0);
}
```

Valid:

```ts
const value = derived(async ({ signal }) => {
  if (!enabled) return undefined;
  return loadValue({ signal });
});
```

In development, detect and report:

- Primitive calls outside an island render
- Hook count changes
- Hook kind changes at a slot
- Conditional registration that changes order

Errors should identify the primitive kind and slot index without exposing user data or callback
source.

Production should avoid development-only tracking overhead.

state()

Add a named state() export for island-local state:

```ts
const count = state(0);

count();
count(1);
count((previous) => previous + 1);
```

Support lazy initializers:

```ts
const count = state(() => expensiveInitialValue());
```

A function value must still use the updater-wrapper convention already used by signals.

Preserve both writable nested-selection forms:

```ts
const nameA = user.select((value) => value.profile.name);
const nameB = user.select("profile", "name");
```

Both forms must remain writable and precisely typed where practical.

state() must throw in development when called outside an active island primitive frame.

Keep standalone signal() for shared/module-level signals. state() and signal() are intentionally
different:

- state() is instance-local and slot-managed.
- signal() is standalone and can be created anywhere.

derived()

Add an island primitive:

```ts
const doubled = derived(() => count() * 2);
```

Preserve current support for:

### Synchronous values

```ts
const doubled = derived(() => count() * 2);
```

### Promises

```ts
const user = derived(async ({ signal }) => {
  const response = await fetch(`/users/${id}`, { signal });
  return response.json();
});
```

### Async iterables

```ts
const messages = derived(async function* ({ signal }) {
  for await (const message of connect(signal)) {
    yield message;
  }
});
```

Preserve current behavior:

- Dependency tracking
- Loading, value, and error envelope
- Previous value while reloading
- Latest-run-wins publication
- Abort stale work when dependencies change
- Abort work on unmount
- Wrap non-Error failures
- Async SSR waits for Promise values
- Async SSR consumes the first async-generator value
- Client mounting continuously consumes async generators
- Hydration may restore derived snapshots

Keep the current accessor contract unless simplifying it is required by the hook redesign:

```ts
user();
user.loading;
user.value;
user.error;
```

Do not introduce a second derived abstraction.

effect()

Replace .effect() with:

```ts
effect(() => {
  document.title = String(count());

  return () => {
    // cleanup before rerun or unmount
  };
});
```

Preserve:

- Dependency tracking
- Cleanup before rerun
- Cleanup on unmount
- AbortSignal support
- Cancellation of stale async effects
- Error routing
- Client-only execution
- Declaration-order execution

Define a minimal context only for values that cannot be ordinary closures:

```ts
effect(({ signal }) => {
  // ...
});
```

Do not pass state, derived values, actions, or props through a context object. Users already hold
them in lexical scope.

effect.once()

Replace .onMount() with:

```ts
effect.once(({ host, signal, hydrated }) => {
  // runs once after client mount

  return () => {
    // runs on unmount
  };
});
```

Preserve current .onMount() behavior:

- Client-only
- Runs once per mounted instance
- Receives the mounted host
- Receives an AbortSignal
- Indicates whether hydration restored existing markup/state
- Supports cleanup
- Errors route through the island error sink
- skipOnMount hydration behavior now applies to effect.once()

effect.once should be a property on the exported effect function, not a separate onMount export.

Delete .onMount() and its public types.

action()

Ordinary operations should be plain functions:

```ts
const increment = (amount: number) => {
  count((value) => value + amount);
};
```

Keep action() only for operations needing reactive execution state and lifecycle cancellation:

```ts
const save = action(async (form: FormData, { signal }) => {
  const response = await fetch("/save", {
    method: "POST",
    body: form,
    signal,
  });

  return response.json();
});
```

Preserve current behavior:

```ts
save(payload);
save.pending;
save.data;
save.error;
```

Also preserve:

- Sync and async callbacks
- Concurrent invocation tracking
- Latest-started invocation owns data and error
- Previous successful data remains while pending
- Cancellation on unmount
- Ignore settlements after unmount
- AbortError filtering
- Error routing
- Direct native event use when the payload type matches
- Direct action handlers remain identifiable for hydration manifests

Do not execute event closures during SSR to inspect action calls.

Delete named action maps and string action keys. Local variable identity replaces action names.

If hydration/server-action manifests require a stable identifier, assign an internal deterministic
action slot ID based on primitive order.

onError()

Replace .onError() with:

```ts
onError(({ error, source, host }) => {
  report(error, source);
});
```

Preserve:

- Multiple handlers in declaration order
- Per-island error handling
- Global onUncaughtError()
- Error sources for actions, effects, effect.once(), and advanced listeners
- AbortError filtering
- Cleanup errors
- Fallback to console.error

State, derived values, actions, and props should be accessed through lexical closure rather than
being copied into the error context.

Keep onUncaughtError() as a standalone global helper.

Remove .on()

Delete .on() and its selector/event mini-language.

Use lowercase native event props for element-owned events:

```tsx
<button onclick={handler}>Save</button>
```

For host or delegated listeners, use effect.once() and native DOM APIs:

```ts
effect.once(({ host, signal }) => {
  host.addEventListener("click", handler, { signal });
});
```

Remove:

- .on() parser
- delegated selector configuration
- HandlerContext
- HandlerContextFor
- .on() modifiers and associated builder types
- .on() documentation

Do not remove native JSX/html`` event modifiers such as :once, :capture, :passive, and :abortable.

Remove scoped CSS

Delete scoped CSS support completely:

```ts
  .css()
  css``
```

Remove:

- .css() builder behavior
- Standalone css helper
- CSS scoping implementation
- data-ilha-css
- scoped-style preservation during morphing/hydration
- CSS-specific public types
- CSS tests and documentation

Users will use ordinary CSS, CSS Modules, native @scope, or Shadow DOM.

Do not replace scoped CSS with another styling abstraction.

Static island metadata

The former .as(tag) behavior still matters for nested island slot wrappers.

Support it through a minimal constructor option:

```tsx
const Badge = ilha(() => <span>New</span>, { as: "span" });
```

Do not add options for hypothetical future features.

If possible, support the same option with schema overloads without ambiguous signatures.

Input schemas

Replace .input(schema) with an ilha() overload:

```tsx
const Greeting = ilha(
  z.object({
    name: z.string().default("World"),
  }),
  ({ name }) => <p>Hello, {name}!</p>,
);
```

Preserve:

- Standard Schema support
- Runtime validation and coercion
- Default values
- Type inference
- Validation during SSR, hydration, mount, and prop updates
- Development-safe error messages that do not expose input contents

Typed-only props remain:

```tsx
const Greeting = ilha<{ name: string }>(({ name }) => <p>Hello, {name}!</p>);
```

Plain function components

Plain function components remain transparent:

```tsx
function Label() {
  const value = state("ready");
  return <span>{value()}</span>;
}

const App = ilha(() => <Label />);
```

Their primitive calls belong to the containing island’s primitive frame and lifecycle.

An independently mounted boundary still requires ilha():

```tsx
const Label = ilha(() => {
  const value = state("ready");
  return <span>{value()}</span>;
});
```

Document that transparent components must also preserve stable primitive ordering. Do not introduce
a virtual-DOM component instance tree merely to emulate React fibers.

Rendering and DOM updates

The component returns JSX or RawHtml directly:

```tsx
const Counter = ilha(() => {
  const count = state(0);
  return <button>{count()}</button>;
});
```

Signal reads performed while rendering subscribe the island render.

When a subscribed value changes:

1.  Invoke the component again with current props.
2.  Reuse existing primitive slots.
3.  Produce new HTML.
4.  Morph the existing host DOM.
5.  Reconcile effects and lifecycle registrations.
6.  Verify primitive slot count and kind in development.

Preserve current:

- Morph identity
- Focus and selection restoration
- Form-control live state behavior
- Child-island slot ownership
- Keyed nested islands
- Event listener replacement and cleanup
- Binding behavior
- Nested island hydration
- Cross-bundle symbol branding

Do not introduce a virtual DOM.

SSR

Keep explicit island methods:

```ts
Island.toString(props);
await Island.toStringAsync(props);
await Island.hydratable(props, options);
Island.mount(host, props);
Island.key(key);
Island.define(tagName, options);
```

Do not restore callable SSR. Island(props) remains child composition only.

During SSR:

- Create a fresh primitive frame.
- Invoke the component once.
- Do not run effects or effect.once().
- Resolve synchronous derived values immediately.
- toString() leaves async derived values loading.
- toStringAsync() awaits Promises and the first async-generator value.
- Actions remain idle.
- Per-instance state must never leak between requests.

Hydration snapshots

The builder previously used string keys for state and derived entries. The new API must snapshot
primitive slots deterministically.

Use a versioned positional format, for example:

```json
{
  "v": 2,
  "state": [0, { "name": "Ilha" }],
  "derived": [{ "loading": false, "value": 0 }]
}
```

Requirements:

- State and derived slots restore by deterministic primitive order.
- Validate snapshot version, size, depth, and shape.
- Strip unsafe prototype keys.
- Ignore malformed or incompatible snapshots safely.
- Development warnings identify slot indexes, not user values.
- Never restore action/effect/error-handler slots as data.
- skipOnMount applies to effect.once().
- Current server and client setup must register the same primitive sequence.

Old builder snapshot formats do not need compatibility unless a router integration requires a short
migration window. Prefer deletion over permanent dual-format parsing.

Nested and keyed islands

Preserve:

```tsx
<Child value={value} />;
Child({ value });
Child.key("stable")({ value });
```

Primitive state belongs to the child island instance, not its parent.

Preserve keyed identity across reorder, insertion, and removal.

Bindings

Keep the narrowed binding API:

```tsx
bind: value;
bind: checked;
bind: group;
bind: this;
```

Also preserve any currently retained bind:files and bind:open behavior unless tests prove they are
dead.

Do not restore bind:valueAsNumber or bind:valueAsDate. Use native event properties instead.

Standalone helpers

Keep:

```ts
signal();
computed();
effect(); // outside islands: standalone reactive effect
batch();
untrack();
persist();
context();
html;
raw;
mount();
onUncaughtError();
```

Resolve the naming collision for effect() cleanly:

- During an island render, effect() registers an island effect slot.
- Outside an island render, preserve the current standalone effect behavior.

state(), derived(), action(), effect.once(), and onError() should require an active island frame.

Consider whether standalone computed() and island derived() can share internal machinery without
merging their public semantics.

Router and Astro integration

Update @ilha/router, @ilha/astro, templates, generated route code, server-island handling, and
virtual modules.

Preserve:

- Router loaders and rendering
- Layout and error wrapping
- Server islands
- Astro rendering and client directives
- File-system routes
- Hydratable response generation
- Client references and action manifests where still supported

Do not leave adapters constructing fluent builders internally.

Types

Delete builder-specific types and replace them with minimal primitive/component types.

Expected public concepts include:

```ts
IslandComponent<Props>;
Island<Props>;
StateAccessor<T>;
DerivedAccessor<T>;
ActionAccessor<P, R>;
EffectContext;
EffectOnceContext;
ErrorContext;
HydratableOptions;
```

Avoid recreating the builder’s accumulated generic maps.

Update packages/ilha/src/public-types.ts with compile-time coverage for:

- Typed props
- Standard Schema inference
- State reads, writes, and updater functions
- Both .select() forms
- Sync derived values
- Promise derived values
- Async-generator derived values
- Actions and action state
- effect() and cleanup
- effect.once()
- onError()
- Native event handlers
- Island methods
- Invalid primitive calls and invalid payload types where TypeScript can detect them

Documentation migration

Rewrite the documentation around function components and primitives.

Remove or rewrite dedicated builder pages:

- .input()
- .state()
- .derived()
- .action()
- .effect()
- .onMount()
- .onError()
- .css()
- .render()

Prefer intent-oriented pages:

- Create an island
- Manage local state
- Derive values and load async data
- Run actions
- Synchronize side effects
- Run setup once
- Handle errors
- Render and hydrate
- Compose islands
- Use bindings

Update:

- Getting started
- Tutorials
- References
- Router guides
- Astro guide
- Templates
- README
- AGENTS.md
- Generated llms.txt outputs through the normal docs build

Examples must use direct JSX return:

```tsx
const Counter = ilha(() => {
  const count = state(0);
  return <button>{count()}</button>;
});
```

Never document the setup-returning-render-function form.

Migration approach

This is a major-version rewrite. Prefer a focused replacement over compatibility scaffolding.

Recommended implementation order:

1.  Add the primitive-frame dispatcher and development order checks.
2.  Implement state().
3.  Adapt rendering so direct JSX component returns rerender correctly.
4.  Implement derived() with existing async semantics.
5.  Implement effect() and effect.once().
6.  Implement action().
7.  Implement onError().
8.  Add typed props and schema overloads.
9.  Convert SSR and hydration snapshots to positional slots.
10. Preserve nested/keyed island behavior.
11. Migrate router and Astro integration.
12. Delete IlhaBuilder and all fluent APIs.
13. Remove .on() and scoped CSS.
14. Rewrite tests and documentation.
15. Delete compatibility code made unreachable by the new model.

Keep the suite runnable after each phase. Do not perform the whole rewrite without intermediate
focused tests.

Required tests

Cover at minimum:

### Primitive ordering

- State persists across rerenders.
- Initializers run once per mounted instance.
- Separate instances do not share slots.
- Hook kind/count changes warn or throw in development.
- Primitive calls outside an island fail clearly.
- Conditional primitive registration is detected.

### Props

- Prop updates rerender.
- State initialized from props does not reset.
- Derived values follow current props.
- Schema defaults and validation work.

### Derived

- Sync values.
- Promises.
- Async generators.
- Cancellation.
- Stale-result prevention.
- Errors.
- SSR and async SSR.
- Snapshot restoration.

### Effects

- Reactive reruns.
- Cleanup before rerun.
- Cleanup on unmount.
- effect.once() runs once.
- effect.once() cleanup.
- Hydration and skipOnMount.
- Errors and cancellation.

### Actions

- Sync and async calls.
- Pending/data/error.
- Concurrent calls.
- Latest-call-wins.
- Unmount cancellation.
- Direct event handlers.
- No SSR execution.

### Rendering

- JSX and html`` .
- Native events.
- Bindings.
- Morph focus/form preservation.
- Nested islands.
- Keyed reorder.
- Plain transparent components using primitives.
- Independent child boundaries.

### SSR and hydration

- No request-state leakage.
- Positional snapshots.
- Malformed snapshots.
- Async derived values.
- Nested hydration.
- Router and Astro pipelines.

Validation

Before completion, run:

```sh
  bun run fmt
  bun run lint
  bun run test
  bun run build
  cd apps/website && bunx blume build --isolated
```

Also verify:

- No fluent builder usage remains.
- No .css() or scoped CSS machinery remains.
- No .on() builder API remains.
- No callable SSR examples remain.
- No stale builder pages remain in navigation or generated agent documentation.
- The new API appears in llms.txt.
- No blocking diagnostics remain.

Report:

- Changed files
- Deleted APIs and types
- New public API
- Snapshot format changes
- Router/Astro migration notes
- Test/build results
- Remaining compatibility risks
- Approximate production-line reduction

Non-goals

Do not:

- Add a virtual DOM
- Add a compiler
- Add dependencies
- Split core into speculative abstractions
- Preserve the fluent builder behind aliases
- Preserve scoped CSS
- Reintroduce @ilha/store
- Reintroduce callable SSR
- Reintroduce removed specialized bindings
- Change Bun or replace happy-dom
- Publish or commit

```

```
