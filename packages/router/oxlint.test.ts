import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plugin = join(import.meta.dir, "oxlint.cjs");

const RULES = {
  "oxlint-plugin-ilha/no-conditional-primitive": "error",
  "oxlint-plugin-ilha/no-primitive-outside-component": "error",
  "oxlint-plugin-ilha/no-instruction-outside-generator": "error",
  "oxlint-plugin-ilha/prefer-lowercase-events": "error",
  "oxlint-plugin-ilha/function-in-atom": "error",
};

async function lint(source: string) {
  const dir = await mkdtemp(join(tmpdir(), "ilha-oxlint-"));
  const file = join(dir, "case.tsx");
  const config = join(dir, ".oxlintrc.json");
  await writeFile(file, source);
  await writeFile(config, JSON.stringify({ jsPlugins: [plugin], rules: RULES }));
  const proc = Bun.spawnSync(["bunx", "oxlint", "-c", config, "--format", "json", file], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = proc.stdout.toString() || proc.stderr.toString();
  let messages: { ruleId?: string; message?: string }[] = [];
  try {
    const parsed = JSON.parse(out);
    messages = Array.isArray(parsed) ? parsed : (parsed.diagnostics ?? parsed);
  } catch {
    messages = [{ message: out }];
  }
  return { raw: out, messages };
}

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

test("flags when/watch/wait outside a generator", async () => {
  const { messages, raw } = await lint(`
    import { atom, watch } from "ilha";
    export default function Logger() {
      const n = atom(0);
      watch(n, (value) => console.log(value));
      return <p>{n}</p>;
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

test("accepts a computed atom initializer", async () => {
  const { messages, raw } = await lint(`
    import { atom } from "ilha";
    export default function Cart() {
      const items = atom([{ n: 1 }]);
      const total = atom(() => items().reduce((sum, item) => sum + item.n, 0));
      return <p>{total}</p>;
    }
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).not.toContain("function-in-atom");
});
