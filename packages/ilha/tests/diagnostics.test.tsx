// @jsxImportSource ../src
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";

import * as Effect from "effect/Effect";

import { ilhaError, resetIlhaWarnings } from "../src/diagnostics.ts";
import { IlhaError, atom, mount, renderToString } from "../src/index.ts";
import type { IlhaCode } from "../src/index.ts";
import { interpret } from "../src/interpret.ts";
import { makeFiber, makeRuntime } from "../src/runtime.ts";
import type { GeneratorFn } from "../src/types.ts";

beforeEach(resetIlhaWarnings);
afterEach(resetIlhaWarnings);

const catchError = (fn: () => void): IlhaError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof IlhaError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected IlhaError");
};

test("every code formats message, fix and docs", () => {
  const codes: IlhaCode[] = [
    "ILHA001",
    "ILHA002",
    "ILHA003",
    "ILHA004",
    "ILHA005",
    "ILHA006",
    "ILHA007",
  ];
  for (const code of codes) {
    const err = ilhaError(code, "detail");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(code);
    expect(err.docs).toBe(`https://ilha.build/errors/${code}`);
    expect(err.message).toContain(`[${code}]`);
    expect(err.message).toContain("(detail)");
    expect(err.message).toContain(`Fix: ${err.fix}`);
    expect(err.message.endsWith(`See ${err.docs}`)).toBe(true);
  }
});

const Drifting = () => {
  const flag = atom(true);
  const n = atom(0);
  if (flag()) {
    atom(1);
  }
  return (
    <button
      type="button"
      onclick={() => {
        flag.set(false);
        n.update((x: number) => x + 1);
      }}
    >
      {n()}
    </button>
  );
};

const neverGen = function* neverGen() {
  yield Effect.never;
};

const Row = () => <b>row</b>;
const List = () => (
  <div>
    <Row key="dup-diag" />
    <Row key="dup-diag" />
  </div>
);

const MismatchApp = () => <section>ok</section>;

const ScriptApp = () => <script>{"x</script><img src=x>"}</script>;

test("ILHA001: primitive with no active component", () => {
  const err = catchError(() => {
    void atom(0);
  });
  expect(err.code).toBe("ILHA001");
});

test("ILHA002: slot count change warns once", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.append(host);
  mount(host, Drifting);
  await Bun.sleep(5);
  host.querySelector("button")?.click();
  await Bun.sleep(10);
  host.querySelector("button")?.click();
  await Bun.sleep(10);
  host.querySelector("button")?.click();
  await Bun.sleep(10);
  const texts = warn.mock.calls.map((c) => String(c[0]));
  warn.mockRestore();
  host.remove();
  const hits = texts.filter((t) => t.includes("[ILHA002]"));
  expect(hits).toHaveLength(1);
  expect(hits[0]).toContain("https://ilha.build/errors/ILHA002");
});

test("ILHA003: atom handle from a different island", async () => {
  let foreign: (() => number) | undefined;
  let caught: IlhaError | undefined;
  const A = () => {
    const n = atom(0);
    foreign = n;
    return <span>{n()}</span>;
  };
  const B = () => {
    atom(1);
    if (foreign) {
      caught = catchError(() => {
        foreign?.();
      });
    }
    return <span>b</span>;
  };
  const a = document.createElement("div");
  const b = document.createElement("div");
  document.body.append(a, b);
  mount(a, A);
  mount(b, B);
  await Bun.sleep(10);
  a.remove();
  b.remove();
  expect(caught?.code).toBe("ILHA003");
});

test("ILHA004: generator resumed with an instruction in flight", () => {
  const runtime = makeRuntime();
  const fiber = makeFiber(runtime, document.createElement("div"), () => {});
  // SAFETY: neverGen is a GeneratorFn that yields Effect.never.
  interpret(neverGen as GeneratorFn, fiber);
  const err = catchError(() => {
    // SAFETY: neverGen is a GeneratorFn that yields Effect.never.
    interpret(neverGen as GeneratorFn, fiber);
  });
  expect(err.code).toBe("ILHA004");
  runtime.close();
});

test("ILHA005: duplicate sibling keys warn once", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.append(host);
  mount(host, List);
  await Bun.sleep(10);
  const texts = warn.mock.calls.map((c) => String(c[0]));
  warn.mockRestore();
  host.remove();
  const hits = texts.filter((t) => t.includes("[ILHA005]"));
  expect(hits).toHaveLength(1);
  expect(hits[0]).toContain('key "dup-diag"');
});

test("ILHA006: hydration mismatch warns and full mounts", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const host = document.createElement("div");
  host.innerHTML = "<article>old</article>";
  document.body.append(host);
  mount(host, MismatchApp, { hydrate: true });
  await Bun.sleep(15);
  const texts = warn.mock.calls.map((c) => String(c[0]));
  warn.mockRestore();
  expect(texts.some((t) => t.includes("[ILHA006]"))).toBe(true);
  expect(host.querySelector("section")?.textContent).toBe("ok");
  host.remove();
});

test("ILHA007: unsafe raw text in <script>", async () => {
  let code: string | undefined;
  try {
    await renderToString(ScriptApp, { markers: false, snapshot: false });
  } catch (error) {
    code = error instanceof IlhaError ? error.code : undefined;
  }
  expect(code).toBe("ILHA007");
});
