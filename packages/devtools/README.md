# `@ilha/devtools`

Inspect live [Ilha](https://github.com/ilhajs/ilha) islands from a panel, a browser agent, or a test. Built on [Devframe](https://devfra.me).

---

## Installation

```bash
bun add -d @ilha/devtools
```

`ilha` and `effect` are peer dependencies. `@ilha/model` is an optional peer; install it to record model islands' message logs.

---

## Usage

Start the page script in development. It answers panels and agents for this page.

```ts
// entry.client.ts
import { installIlhaDevtools } from "@ilha/devtools/page";

if (import.meta.env.DEV) {
  const devtools = installIlhaDevtools({ exclude: ["PointerMoved"] });
  // Open the panel in a popup that can find this page.
  // devtools.openPanel();
}
```

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `window` | global `window` | Window that receives panel handshakes; `false` skips it |
| `webmcp` | `true` | Register the tools on the browser's WebMCP model context |
| `panelUrl` | `/__ilha-devtools/` | Where `openPanel()` opens the panel |
| `size` | `1000` | Wire entries kept per session |
| `exclude` | `[]` | Message `_tag`s hidden from the timeline |
| `maxEntryBytes` | none | Truncates entry payloads over this many bytes |

Serve the panel with any Devframe adapter. With Vite:

```ts
// vite.config.ts
import { devframeVitePlugin } from "@devframes/vite/single";
import { ilhaDevtools } from "@ilha/devtools";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [devframeVitePlugin(ilhaDevtools)],
});
```

The panel lives at `/__ilha-devtools/`.

---

## What the page exposes

| Function | Arguments | Returns |
| --- | --- | --- |
| `inspect` | none | Trees of every live island (JSON) |
| `highlight` | `id` or `null` | Whether the component has a box to outline |
| `setAtom` | `id`, `index`, JSON `value` | `{ ok: true }` or `{ ok: false, reason }` |
| `modelSessions` | none | The `@ilha/model` sessions the page holds |
| `modelFrames` | `session`, `since` | Wire frames with `seq` above `since` |
| `modelMessageSchema` | `component`, optional `tag` | The JSON Schema of a component's messages |
| `modelShowEntry` | `session`, `entry` | Paints an entry's state (pause) |
| `modelResume` | `session` | Resumes the live island |
| `modelDispatch` | `session`, `instance`, message | Dispatches a message; off unless `dispatch: true` |

Each function carries Devframe `agent` metadata. When the browser provides WebMCP, `installIlhaDevtools()` also registers the island tools (`ilha_inspect`, `ilha_highlight`, `ilha_set_atom`) plus the model tools below as `ilha_model_*`. Pass `{ webmcp: false }` to skip that.

The `tree` shared state mirrors `inspect()` as panels connect and as islands change.

---

## The model pipeline

With `@ilha/model` installed, the page script attaches a `MessageLog` sink through `MessageLog.attach` and encodes every live entry to Wire frames with the encoder in `MessageLog`. The frames feed a page-side backend (an `Inspector` plus a `History` per session, see `src/inspector.ts`), which answers `modelFrames` for the panel and the agent tools. Recording costs nothing when the package is missing: the functions stay and explain why.

The panel polls `modelSessions`/`modelFrames` and renders:

- a timeline with Messages / Commands / Everything filters, newest first;
- the instance tree with find, and a per-instance filter;
- per-entry tabs: Model (with diff), Message, Props, Commands, Events, Lifecycle, Raw (with Copy frame);
- the causal chain with back/forward links, Follow latest, Back, Clear (keeps baselines for diffs), the `exclude` option, and a failure count.

Pausing on an entry hides the live island's container and renders an inert copy through `renderToString`, with each instance's state at the chosen entry injected by path. The live island keeps running hidden until Resume. While paused, the copy runs nothing.

---

## Agent tools (`ilha_model_*`)

`list_sessions`, `list_instances`, `list_entries` (filter/tag/after/limit 1–500, newest-first by default without `after`), `count_entries`, `get_entry`, `get_chain`, `get_state` (from `History`), `diff_state`, `get_message_schema` (JSON Schema of the instance's message Schema, read off the live entry's component), and `wait` (timeout 0–60000 ms, default 5000). Results over 24 KB come back as an outline; pass `path` to read a subtree.

`show_entry`, `resume`, and `dispatch` drive pause/paint/dispatch: `dispatch` is off unless the page passes `dispatch: true`. The panel folds frames through the same `Inspector`/`History` a pause control paints from, and the tools share the `ModelBackend` a dispatch control writes through.

See the [devtools guide](https://ilha.build/guide/devtools) for details.
