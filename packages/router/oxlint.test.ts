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
  "oxlint-plugin-ilha/prefer-lowercase-events": "error",
};

const lint = async (source: string) => {
  const dir = await mkdtemp(path.join(tmpdir(), "ilha-oxlint-"));
  const file = path.join(dir, "case.tsx");
  const config = path.join(dir, ".oxlintrc.json");
  await writeFile(file, source);
  await writeFile(
    config,
    JSON.stringify({ jsPlugins: [plugin], rules: RULES })
  );
  const proc = Bun.spawnSync(
    ["bunx", "oxlint", "-c", config, "--format", "json", file],
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
  return { messages, raw: out };
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
    import * as Atom from "effect/unstable/reactivity/Atom";
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
    import * as Atom from "effect/unstable/reactivity/Atom";
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
