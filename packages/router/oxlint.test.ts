import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plugin = join(import.meta.dir, "oxlint.cjs");

async function lint(source: string) {
  const dir = await mkdtemp(join(tmpdir(), "ilha-oxlint-"));
  const file = join(dir, "case.tsx");
  const config = join(dir, ".oxlintrc.json");
  await writeFile(file, source);
  await writeFile(
    config,
    JSON.stringify({
      jsPlugins: [plugin],
      rules: {
        "oxlint-plugin-ilha/pascal-case": "error",
        "oxlint-plugin-ilha/no-conditional-primitive": "error",
        "oxlint-plugin-ilha/no-primitive-outside-island": "error",
        "oxlint-plugin-ilha/prefer-plain-handler": "warn",
        "oxlint-plugin-ilha/prefer-lowercase-events": "error",
        "oxlint-plugin-ilha/no-direct-island-call": "error",
        "oxlint-plugin-ilha/require-ssr-api": "error",
        "oxlint-plugin-ilha/function-in-state": "error",
      },
    }),
  );
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

test("flags first-pass island slop", async () => {
  const { messages, raw } = await lint(`
    import { ilha, state, action } from "ilha";
    const count = state(0);
    const counter = ilha(() => {
      if (true) state(1);
      const save = action(() => 1);
      const fn = () => 0;
      const cb = state(0);
      cb(fn);
      return <button onClick={save}>{count()}</button>;
    });
    await counter();
    counter();
  `);
  const blob = JSON.stringify(messages) + raw;
  expect(blob).toContain("no-primitive-outside-island");
  expect(blob).toContain("no-conditional-primitive");
  expect(blob).toContain("prefer-plain-handler");
  expect(blob).toContain("prefer-lowercase-events");
  expect(blob).toContain("no-direct-island-call");
  expect(blob).toContain("require-ssr-api");
  expect(blob).toContain("function-in-state");
  expect(blob).toContain("pascal-case");
});
