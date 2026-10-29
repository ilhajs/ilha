/**
 * Generates `AGENTS.md`, `llms.txt`, and `MIGRATIONS.md` (from `MIGRATIONS.json`) for the published `ilha` package.
 *
 * Run by `bun run build` before tsdown. The output is a pure function of
 * `package.json`, `src/index.ts`, and the JSDoc beside each export, so two
 * runs produce byte-identical files. Markdown outputs pass through oxfmt with
 * the repo config so `bun run check` accepts them as generated. Pass `--check`
 * to fail when the files on disk are stale instead of rewriting them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { format } from "oxfmt";

import formatConfig from "../../../oxfmt.config.ts";

const ROOT = path.join(import.meta.dirname, "..");
const SITE = "https://ilha.build";

const EXPORT_BLOCK =
  /export\s+(?<typeKeyword>type\s+)?\{(?<names>[^}]*)\}\s+from\s+"(?<from>[^"]+)";/gu;
const LEADING_TYPE = /^type\s+/u;
const COMMENT_STAR = /^\s*\* ?/u;
const WHITESPACE = /\s+/gu;
const JSDOC_BREAK = /\n\s*\n/u;
const SENTENCE_END = /^(?<sentence>.+?[.!?])(?:\s|$)/u;

interface ExportEntry {
  name: string;
  from: string;
  isType: boolean;
}

/**
 * One-line summaries for exports whose source carries no JSDoc. The generator
 * prefers JSDoc and fails when an export has neither, so a new export forces
 * its author to document it.
 */
const SUMMARIES = {
  ErrorBoundary:
    "Catch subtree failures and paint a `fallback`; `reset()` retries. Props: `fallback`, `onError`.",
  Fragment: "Group children without a wrapper element (`<>...</>`).",
  IlhaError:
    "Error thrown for misuse, with `code` (ILHA001..), `fix`, and `docs` fields.",
  atom: "Declare reactive state in a component: `atom(0)`, `atom(effect | stream)` (handle holds an `AsyncResult`), `atom(Atom.map(...))` (derived), `atom.lazy(() => init)` (one-time init). Read `count()`, write `count.set(v)` / `count.update(fn)`.",
  batch:
    "Group several atom writes into one rerender (re-export of Effect `Atom.batch`).",
  createContext:
    "`createContext(default)` returns a context whose `Provider` (`<Ctx.Provider value={v}>`) shares a value down the tree; read it with `context(ctx)`.",
  h: "Build a vnode by hand; JSX compiles to this.",
  mount:
    "`mount(host, Component, { hydrate?, onError?, onIdle? })` renders in the browser and returns a dispose function. With `{ hydrate: true }` it adopts server HTML.",
  renderToString:
    "`await renderToString(Component, { timeout?, snapshot?, markers? })` renders HTML on the server, awaiting async components and streams (first emission).",
  watch:
    "`watch(source, ({ signal }) => ...)` reacts to an atom, Effect atom, or Stream; `watch.once(fn)` runs once on mount and may return a cleanup. Both return `Instruction<void>` — call at the top level of the component, in the same order every render.",
} satisfies Record<string, string>;

const SUMMARY_BY_NAME = new Map<string, string>(Object.entries(SUMMARIES));

/** The canonical way to do each task. Mirrors `/guide/getting-started/choose-an-api`. */
const CANONICAL: readonly (readonly [string, string])[] = [
  ["Local state", "`const n = atom(0)`"],
  [
    "Derived value",
    "`atom(Atom.map(source.atom, fn))` or `atom(Atom.transform(...))`",
  ],
  ["One-time init", "`atom.lazy(() => expensive())`"],
  ["React to a change", "`watch(source, fn)`"],
  ["Mount-only side effect", "`watch.once(fn)` (return a cleanup)"],
  [
    "Async data",
    "`atom(Effect)`, read as `AsyncResult` — see /guide/recipes/data-fetching",
  ],
  ["Live data", "`yield` an Effect `Stream` from a generator component"],
  [
    "Per-emission interruptible flow",
    "`yield* when(stream, function* (v) {...})`",
  ],
  ["Share values down the tree", "`createContext()` + `context(ctx)`"],
  ["Handle failures", "`<ErrorBoundary fallback={...}>`"],
  ["Server render", "`await renderToString(Component)`"],
  [
    "Client render",
    "`mount(host, Component)`, or `mount(host, Component, { hydrate: true })` over server HTML",
  ],
  ["Raw trusted HTML", "`unsafe(html)`"],
];

const NEVER: readonly string[] = [
  "Never call `atom()`, `watch()`, or `when()` conditionally, in loops, or after an early return: slots are order-based.",
  "Never read an atom with `.value` or `.get()`: call `count()`, or pass `{count}` in JSX.",
  "Never wrap Effect Atom APIs (`Atom.map`, `Atom.transform`, `Atom.fn`): pass `handle.atom` to them and wrap the result in `atom()`.",
  "Never use `useState`, `useEffect`, or other React hooks: there is no hook layer.",
  "Never pass untrusted input to `unsafe()`.",
  "Never import removed APIs (`resource`, `invalidate`, `fromEventSource`, `ilha/define`, `structuralEqual`): see MIGRATIONS.md.",
  "Never use an atom handle from another island: it throws ILHA003.",
];

interface Subpath {
  name: string;
  summary: string;
}

const SUBPATHS: readonly Subpath[] = [
  {
    name: "ilha/jsx-runtime",
    summary:
      'JSX factory. Set `jsxImportSource: "ilha"` in tsconfig; also `ilha/jsx-dev-runtime`.',
  },
  {
    name: "ilha/renderer",
    summary:
      "`createRenderer`/`PaintOps` seam for hosts that are not a DOM (native, test harness).",
  },
  {
    name: "ilha/test",
    summary:
      "`render(component)` harness for unit tests — see /guide/recipes/testing.",
  },
  {
    name: "ilha/debug",
    summary:
      "`inspect()` returns JSON-serializable trees of live islands; `roots()`, `onChange()` — see /guide/devtools.",
  },
  {
    name: "ilha/oxlint",
    summary:
      "Oxlint JS plugin enforcing ilha rules — see /guide/recipes/oxlint.",
  },
  {
    name: "@ilha/devtools",
    summary:
      "Separate package: in-browser inspector built on `ilha/debug` — see /guide/devtools.",
  },
];

const ERROR_CODES: readonly (readonly [string, string])[] = [
  ["ILHA001", "Primitive called with no active component"],
  ["ILHA002", "Atom/watch slot count changed between renders (warning)"],
  ["ILHA003", "Atom handle used from a different island"],
  ["ILHA004", "Generator resumed while an instruction is in flight"],
  ["ILHA005", "Duplicate key among sibling components (warning)"],
  ["ILHA006", "Hydration mismatch (warning)"],
  ["ILHA007", "Unsafe raw text in <script>/<style> during renderToString"],
];

const read = (file: string): string =>
  readFileSync(path.join(ROOT, file), "utf-8");

const parseExports = (source: string): ExportEntry[] => {
  const entries: ExportEntry[] = [];
  for (const match of source.matchAll(EXPORT_BLOCK)) {
    const { typeKeyword, names = "", from = "" } = match.groups ?? {};
    for (const raw of names.split(",")) {
      const name = raw.trim().replace(LEADING_TYPE, "");
      if (name) {
        entries.push({
          from,
          isType: typeKeyword !== undefined || raw.trim().startsWith("type "),
          name,
        });
      }
    }
  }
  return entries;
};

const cleanDoc = (body: string): string => {
  const text = body
    .split("\n")
    .map((line) => line.replace(COMMENT_STAR, ""))
    .join("\n")
    .trim();
  const [paragraph = ""] = text.split(JSDOC_BREAK);
  const flat = paragraph.replaceAll(WHITESPACE, " ").trim();
  return SENTENCE_END.exec(flat)?.groups?.sentence ?? flat;
};

const jsdocFor = (name: string, from: string): string | undefined => {
  const source = read(path.join("src", from));
  const pattern = new RegExp(
    `/\\*\\*(?<body>(?:(?!\\*/)[\\s\\S])*?)\\*/\\s*export\\s+(?:const|interface|type|function)\\s+${name}\\b`,
    "u"
  );
  const body = pattern.exec(source)?.groups?.body;
  return body === undefined ? undefined : cleanDoc(body);
};

const describe = ({ name, from }: ExportEntry): string => {
  const summary = jsdocFor(name, from) ?? SUMMARY_BY_NAME.get(name);
  if (summary === undefined) {
    throw new Error(
      `agent-docs: export "${name}" (${from}) has no JSDoc and no entry in SUMMARIES.`
    );
  }
  return summary;
};

const byName = (a: ExportEntry, b: ExportEntry): number =>
  a.name.localeCompare(b.name, "en");

const pkg: { version: string } = JSON.parse(read("package.json"));
const entries = parseExports(read("src/index.ts"));
const values = entries.filter((e) => !e.isType).toSorted(byName);
const types = entries.filter((e) => e.isType).toSorted(byName);
// Contract exports that live outside the `export ... from` blocks.
for (const extra of ["IlhaError"]) {
  if (!values.some((e) => e.name === extra)) {
    values.push({ from: "diagnostics.ts", isType: false, name: extra });
    values.sort(byName);
  }
}

const apiLines = values.map((e) => `- \`${e.name}\` — ${describe(e)}`);
const typeLine = types.map((e) => `\`${e.name}\``).join(", ");
const canonicalRows = CANONICAL.map(([task, api]) => `| ${task} | ${api} |`);
const subpathLines = SUBPATHS.map((s) => `- \`${s.name}\` — ${s.summary}`);
const errorRows = ERROR_CODES.map(
  ([code, text]) => `| [${code}](${SITE}/errors/${code}) | ${text} |`
);

const agents = `# ilha ${pkg.version} — agent guide

Generated from \`src/index.ts\` by \`scripts/agent-docs.ts\`. Do not edit by hand.

ilha is a tiny, isomorphic islands UI library on Effect 4 (\`effect\` is the only peer dependency). A component is a function (sync, async, or generator) that returns JSX. State lives in order-based \`atom()\` slots. There is no virtual DOM and no compiler.

\`\`\`tsx
import { atom, mount } from "ilha";

const Counter = () => {
  const count = atom(0);
  return (
    <button type="button" onclick={() => count.update((n) => n + 1)}>
      Count: {count}
    </button>
  );
};

mount(document.getElementById("app")!, Counter);
\`\`\`

## Pick exactly one API per task

| Task | Use |
| --- | --- |
${canonicalRows.join("\n")}

Full table: ${SITE}/guide/getting-started/choose-an-api

## Never do

${NEVER.map((line) => `- ${line}`).join("\n")}

## Public API (\`ilha\`)

${apiLines.join("\n")}

Types: ${typeLine}.

## Subpaths

${subpathLines.join("\n")}

## Errors

Every diagnostic is an \`IlhaError\` (or a console warning) with a stable code, a \`fix\` line, and a docs link.

| Code | Meaning |
| --- | --- |
${errorRows.join("\n")}

Details and fixes: ${SITE}/errors

## Where to read more

- Docs index for LLMs: ${SITE}/llms.txt
- Removed or changed APIs: \`MIGRATIONS.md\` / \`MIGRATIONS.json\` in this package
- Testing: ${SITE}/guide/recipes/testing
- Devtools and \`ilha/debug\`: ${SITE}/guide/devtools
- Lint rules: ${SITE}/guide/recipes/oxlint
`;

const llmsLink = (title: string, url: string, note: string): string =>
  `- [${title}](${url}): ${note}`;

const llms = `# ilha

> Tiny, isomorphic islands UI library on Effect 4. Function components, order-based \`atom()\` slots, JSX, SSR via \`renderToString\`, hydration via \`mount(host, C, { hydrate: true })\`. Version ${pkg.version}.

Start with the canonical-usage table: exactly one API per task, plus a never-do list.

## Docs

${llmsLink("Choose an API", `${SITE}/guide/getting-started/choose-an-api`, "task to API table and never-do list")}
${llmsLink("Core concepts", `${SITE}/guide/getting-started/core-concepts`, "components, atoms, mount, renderToString")}
${llmsLink("Full docs for LLMs", `${SITE}/llms-full.txt`, "every page as one Markdown file")}
${llmsLink("Reference", `${SITE}/reference/ilha`, "API reference for ilha")}

## Diagnostics

${llmsLink("Error codes", `${SITE}/errors`, "ILHA001..ILHA007: cause and fix for each IlhaError")}

## Tooling

${llmsLink("Testing", `${SITE}/guide/recipes/testing`, "ilha/test render harness")}
${llmsLink("Devtools", `${SITE}/guide/devtools`, "ilha/debug inspect() and @ilha/devtools")}
${llmsLink("Oxlint plugin", `${SITE}/guide/recipes/oxlint`, "ilha/oxlint rules")}

## Recipes

${llmsLink("Data fetching", `${SITE}/guide/recipes/data-fetching`, "Effect Cache + atom(Effect)")}
${llmsLink("Server-sent events", `${SITE}/guide/recipes/server-sent-events`, "Stream.callback + retry")}
${llmsLink("Custom elements", `${SITE}/guide/recipes/custom-elements`, "wrap a component as a custom element")}

## Optional

${llmsLink("Migrations", "https://github.com/ilhajs/ilha/blob/main/packages/ilha/MIGRATIONS.md", "removed or changed APIs with replacements")}

## Package files

- AGENTS.md: agent guide shipped in the npm tarball (public API from source JSDoc)
- MIGRATIONS.md, MIGRATIONS.json: removed or changed APIs with replacements
`;

interface Migration {
  id: string;
  kind: "removed" | "changed";
  api: string;
  import: string;
  replacement: string;
  docs: string;
  before: string;
  after: string;
}

const migrations: { changes: Migration[] } = JSON.parse(
  read("MIGRATIONS.json")
);

const fence = (code: string): string => `\`\`\`ts\n${code}\n\`\`\``;

const migrationSection = (m: Migration): string =>
  [
    `## ${m.api}`,
    "",
    `- Status: ${m.kind}`,
    `- Import: \`${m.import}\``,
    `- Replacement: ${m.replacement}`,
    `- Docs: ${m.docs}`,
    ...(m.before ? ["", "Before:", "", fence(m.before)] : []),
    "",
    "After:",
    "",
    fence(m.after),
  ].join("\n");

const migrationsMd = `# ilha migrations

Generated from \`MIGRATIONS.json\` by \`scripts/agent-docs.ts\`. Do not edit by hand.

Removed and changed APIs, each with its replacement. Machine-readable form: \`MIGRATIONS.json\`. Index for LLMs: ${SITE}/llms.txt

${migrations.changes.map(migrationSection).join("\n\n")}
`;

const formatMarkdown = async (
  file: string,
  content: string
): Promise<string> => {
  const { code, errors } = await format(file, content, formatConfig);
  if (errors.length > 0) {
    throw new Error(`agent-docs: oxfmt failed on ${file}.`);
  }
  return code;
};

const targets: readonly (readonly [string, string])[] = [
  ["AGENTS.md", await formatMarkdown("AGENTS.md", agents)],
  ["llms.txt", llms],
  ["MIGRATIONS.md", await formatMarkdown("MIGRATIONS.md", migrationsMd)],
];

const check = process.argv.includes("--check");
let stale = false;
for (const [file, content] of targets) {
  const target = path.join(ROOT, file);
  if (check) {
    let current = "";
    try {
      current = readFileSync(target, "utf-8");
    } catch {
      current = "";
    }
    stale ||= current !== content;
  } else {
    writeFileSync(target, content);
  }
}
if (stale) {
  throw new Error(
    "agent-docs: a generated file is stale. Run `bun run build`."
  );
}
