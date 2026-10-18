import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const plugin = path.join(import.meta.dir, "oxlint.cjs");

const RULES = {
  "oxlint-plugin-ilha/function-in-atom": "error",
  "oxlint-plugin-ilha/no-conditional-primitive": "error",
  "oxlint-plugin-ilha/no-instruction-outside-generator": "error",
  "oxlint-plugin-ilha/no-primitive-outside-component": "error",
  "oxlint-plugin-ilha/no-react-props": "error",
  "oxlint-plugin-ilha/prefer-lowercase-events": "error",
  "oxlint-plugin-ilha/require-key-in-map": "error",
};

const lint = async (source: string, { fix = false } = {}) => {
  const dir = await mkdtemp(path.join(tmpdir(), "ilha-oxlint-"));
  const file = path.join(dir, "case.tsx");
  const config = path.join(dir, ".oxlintrc.json");
  await writeFile(file, source);
  await writeFile(
    config,
    JSON.stringify({ jsPlugins: [plugin], rules: RULES })
  );
  const proc = Bun.spawnSync(
    [
      "bunx",
      "oxlint",
      "-c",
      config,
      "--format",
      "json",
      ...(fix ? ["--fix"] : []),
      file,
    ],
    {
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const out = proc.stdout.toString() || proc.stderr.toString();
  let messages: { ruleId?: string; message?: string }[] = [];
  try {
    const parsed = JSON.parse(out);
    messages = Array.isArray(parsed) ? parsed : (parsed.diagnostics ?? parsed);
  } catch {
    messages = [{ message: out }];
  }
  return { fixed: fix ? await Bun.file(file).text() : "", messages, raw: out };
};

test("flags atom() at module top level", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    const count = atom(0);
    export default () => <p>{count}</p>;
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("no-primitive-outside-component");
});

test("flags conditional primitives", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    export default function Counter({ open }: { open: boolean }) {
      if (open) atom(1);
      return <p>hi</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("no-conditional-primitive");
});

test("flags when() outside a generator", async () => {
  const { messages, raw } = await lint(`
    import * as Stream from "effect/Stream";
    import { when } from "ilha";
    export default function App() {
      when(Stream.fromIterable([1]), function* (n) {
        yield n;
      });
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("no-instruction-outside-generator");
});

test("flags when() called without yield* inside a generator", async () => {
  const { messages, raw } = await lint(`
    import * as Stream from "effect/Stream";
    import { when } from "ilha";
    export default function* Status() {
      when(Stream.fromIterable([1]), function* (n) {
        yield <p>{n}</p>;
      });
      yield <p>done</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("no-instruction-outside-generator");
});

test("accepts yield* when() in a generator", async () => {
  const { messages, raw } = await lint(`
    import * as Stream from "effect/Stream";
    import { when } from "ilha";
    export default function* Status() {
      yield* when(Stream.fromIterable([1]), function* (n) {
        yield <p>{n}</p>;
      });
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("no-instruction-outside-generator");
});

test("flags camelCase event props", async () => {
  const { messages, raw } = await lint(`
    export default () => <button onClick={() => {}}>Go</button>;
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("prefer-lowercase-events");
});

test("accepts lowercase event props", async () => {
  const { messages, raw } = await lint(`
    export default () => <button onclick={() => {}}>Go</button>;
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("prefer-lowercase-events");
});

test("flags storing a function value in atom()", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    export default function Box() {
      const save = () => 1;
      const cb = atom(save);
      return <p>{cb()()}</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("function-in-atom");
});

test("accepts Atom.transform for derived values", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    import * as Atom from "effect/reactivity/Atom";
    export default function Cart() {
      const items = atom([{ n: 1 }]);
      const total = atom(Atom.transform(items.atom, (get, source) => get(source).reduce((sum, item) => sum + item.n, 0)));
      return <p>{total}</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("function-in-atom");
});

test("accepts Atom.map for derived values", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    import * as Atom from "effect/reactivity/Atom";
    export default function Board() {
      const items = atom([{ done: false }]);
      const pending = atom(Atom.map(items.atom, (list) => list.filter((item) => !item.done).length));
      return <span>{pending}</span>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("function-in-atom");
});

test("flags atom(() => ...) derived initializer", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    export default function Cart() {
      const items = atom([{ n: 1 }]);
      const total = atom(() => items().reduce((sum, item) => sum + item.n, 0));
      return <p>{total}</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("function-in-atom");
});

test("ignores shadowed non-function bindings passed to atom()", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    function save() { return 1; }
    export default function Box() {
      const save = "email";
      return <p>{atom(save)}</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("function-in-atom");
});

test("flags a primitive inside a nested callback", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    export default function List({ rows }: { rows: number[] }) {
      return <ul>{rows.map((row) => { const n = atom(row); return <li>{n}</li>; })}</ul>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("no-conditional-primitive");
  expect(blob).toContain("nested callback");
});

test("flags atom.lazy and watch.once in a loop", async () => {
  const { messages, raw } = await lint(`
    import { atom, watch } from "ilha";
    export default function App() {
      for (let i = 0; i < 2; i += 1) {
        atom.lazy(() => i);
        watch.once(() => {});
      }
      return <p>hi</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("atom.lazy() inside a condition");
  expect(blob).toContain("watch.once() inside a condition");
});

test("flags context() inside a condition", async () => {
  const { messages, raw } = await lint(`
    import { context } from "ilha";
    import { Theme } from "./theme";
    export default function App({ on }: { on: boolean }) {
      const theme = on ? context(Theme) : null;
      return <p>{theme}</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("no-conditional-primitive");
});

test("flags a primitive after await", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    export default async function App() {
      const first = atom(0);
      await Promise.resolve();
      const second = atom(1);
      return <p>{first}{second}</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("after an await");
  expect(JSON.stringify(messages).match(/after an await/gu)?.length).toBe(1);
});

test("accepts primitives before await and in generator callbacks", async () => {
  const { messages, raw } = await lint(`
    import * as Stream from "effect/Stream";
    import { atom, when } from "ilha";
    export default async function* App() {
      const count = atom(0);
      yield* when(Stream.fromIterable([1]), function* (n) {
        yield <p>{n}{count}</p>;
      });
      await Promise.resolve();
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("no-conditional-primitive");
});

test("flags and fixes React-style props on intrinsic elements", async () => {
  const { messages, raw, fixed } = await lint(
    `
    export default () => (
      <label className="x" htmlFor="a" onDoubleClick={() => {}}>
        <input id="a" onChange={() => {}} />
      </label>
    );
  `,
    { fix: true }
  );
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("className");
  expect(fixed).toContain('class="x"');
  expect(fixed).toContain('for="a"');
  expect(fixed).toContain("ondblclick=");
  expect(fixed).toContain("onchange=");
});

test("reports React-style props with a fix hint", async () => {
  const { messages, raw } = await lint(`
    export default () => <div className="x" />;
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("no-react-props");
  expect(blob).toContain('Fix: use \\"class\\"');
});

test("accepts React-style props on component elements", async () => {
  const { messages, raw } = await lint(`
    import { Card } from "./card";
    export default () => <Card className="x" onClick={() => {}} />;
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("no-react-props");
  expect(blob).not.toContain("prefer-lowercase-events");
});

test("flags components returned from map() without a key", async () => {
  const { messages, raw } = await lint(`
    import { Row } from "./row";
    export default ({ items }: { items: { id: number }[] }) => (
      <ul>{items.map((item) => <Row item={item} />)}</ul>
    );
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("require-key-in-map");
});

test("flags components returned from a map() block body without a key", async () => {
  const { messages, raw } = await lint(`
    import { Row } from "./row";
    export default ({ items }: { items: { id: number }[] }) => (
      <ul>{items.map((item) => { return <Row item={item} />; })}</ul>
    );
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("require-key-in-map");
});

test("accepts keyed components and intrinsic elements in map()", async () => {
  const { messages, raw } = await lint(`
    import { Row } from "./row";
    export default ({ items }: { items: { id: number }[] }) => (
      <ul>
        {items.map((item) => <Row key={item.id} item={item} />)}
        {items.map((item) => <li>{item.id}</li>)}
      </ul>
    );
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("require-key-in-map");
});

test("flags an inline function passed to atom() with a lazy hint", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    export default function App() {
      return <p>{atom(() => 1)}</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("function-in-atom");
  expect(blob).toContain("atom.lazy");
});

test("accepts atom.lazy(() => ...)", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    export default function App() {
      const n = atom.lazy(() => 1);
      return <p>{n}</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("function-in-atom");
  expect(blob).not.toContain("no-conditional-primitive");
});

test("accepts a primitive in the always-evaluated side of ?? and ||", async () => {
  const { messages, raw } = await lint(`
    import { context } from "ilha";
    import { Theme } from "./theme";
    export default function App() {
      const theme = context(Theme)()?.name ?? "light";
      return <p>{theme}</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("no-conditional-primitive");
});
