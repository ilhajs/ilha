# ilha

The setup function is the island.

```bash
bun test
bun run play
```

```tsx
import { atom, mount } from "ilha";

const Counter = async () => {
  const count = atom(0);
  return <button onclick={() => count.update((n) => n + 1)}>Count: {count}</button>;
};

mount(document.getElementById("app")!, Counter);
```

```tsx
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import { atom, when } from "ilha";

const Search = function* () {
  const q = atom("");
  yield (
    <input value={q} oninput={(e: Event) => q.set((e.currentTarget as HTMLInputElement).value)} />
  );
  yield* when(Atom.toStream(q.atom).pipe(Stream.debounce("200 millis")), function* (q) {
    if (!q) return;
    const hits = yield search(q);
    yield (
      <ul>
        {hits.map((h) => (
          <li>{h.title}</li>
        ))}
      </ul>
    );
  });
};
```

`wait(function* (done) { … })` for sequential frames. JSX: `"jsxImportSource": "ilha"`.
