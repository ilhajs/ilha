import { afterEach, describe, expect, it } from "bun:test";

import { attachModelRecorder, defineApp } from "@ilha/model";
import type { Dispatch } from "@ilha/model";
import { Data, Effect, Option } from "effect";
import type { Component } from "ilha";
import { atomsOf, inspect } from "ilha/debug";

import { createModelLog, MODEL_LOG_CAP } from "../src/model-log.ts";
import { mountHost, settle } from "./helpers.tsx";

// oxlint-disable-next-line typescript/no-empty-object-type, typescript/ban-types, typescript/consistent-type-definitions -- Data.taggedEnum spells payload-free variants as `{}`.
type NoArgs = {};

// oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
type Msg = Data.TaggedEnum<{
  AddBonus: { readonly amount: number };
  FetchBonus: NoArgs;
  Increment: NoArgs;
}>;
// oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
const Msg = Data.taggedEnum<Msg>();

const counter = defineApp({
  init: () => ({ model: { count: 0 } }),
  update: (model: { count: number }, message: Msg) =>
    Msg.$match(message, {
      AddBonus: ({ amount }) => ({ model: { count: model.count + amount } }),
      FetchBonus: () => ({
        cmd: Effect.succeed(Msg.AddBonus({ amount: 10 })),
        model,
      }),
      Increment: () => ({ model: { count: model.count + 1 } }),
    }),
  view: (model: { count: number }, dispatch: Dispatch<Msg>) => (
    <div>
      <p>{model.count}</p>
      <button type="button" onclick={() => dispatch(Msg.Increment())}>
        inc
      </button>
      <button type="button" onclick={() => dispatch(Msg.FetchBonus())}>
        bonus
      </button>
    </div>
  ),
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    cleanup();
  }
});

/** Mount `component` with a fresh log attached; read it the way the page script does. */
const mountLogged = async (component: Component) => {
  const log = createModelLog();
  cleanups.push(attachModelRecorder(log.record));
  const { host, unmount } = await mountHost(component);
  cleanups.push(() => {
    unmount();
    host.remove();
  });
  const click = async (index = 0): Promise<void> => {
    host.querySelectorAll("button")[index]?.click();
    await settle(5);
  };
  const read = () => {
    const [node] = inspect(host);
    return log.read(atomsOf(node?.id ?? "") ?? []);
  };
  return { click, host, read };
};

const poll = async (
  done: () => boolean,
  deadline = Date.now() + 2000
): Promise<void> => {
  if (done()) {
    return;
  }
  if (Date.now() > deadline) {
    expect(done()).toBe(true);
    return;
  }
  await Bun.sleep(5);
  await poll(done, deadline);
};

describe("model message log", () => {
  it("records ordered entries with field diffs and command counts", async () => {
    const { click, host, read } = await mountLogged(counter.component);
    await click();
    await click(1);
    await poll(() => host.textContent === "11incbonus");
    const entries = read();
    expect(entries?.map((entry) => entry.message)).toEqual([
      { _tag: "Increment" },
      { _tag: "FetchBonus" },
      { _tag: "AddBonus", amount: 10 },
    ]);
    expect(entries?.map((entry) => entry.commands)).toEqual([0, 1, 0]);
    expect(entries?.map((entry) => entry.diff)).toEqual([
      { _tag: "fields", changed: { count: { after: 1, before: 0 } } },
      { _tag: "fields", changed: {} },
      { _tag: "fields", changed: { count: { after: 11, before: 1 } } },
    ]);
  });

  it("keeps only the newest entries past the cap", async () => {
    const flood = defineApp({
      init: () => ({ model: { n: 0 } }),
      update: (model: { n: number }, _message: "tick") => ({
        model: { n: model.n + 1 },
      }),
      view: (model: { n: number }, dispatch: Dispatch<"tick">) => (
        <button
          type="button"
          onclick={() => {
            for (let i = 0; i < MODEL_LOG_CAP + 5; i += 1) {
              dispatch("tick");
            }
          }}
        >
          {model.n}
        </button>
      ),
    });
    const { click, read } = await mountLogged(flood.component);
    await click();
    const entries = read();
    expect(entries?.length).toBe(MODEL_LOG_CAP);
    expect(entries?.[0]?.diff).toEqual({
      _tag: "fields",
      changed: { n: { after: 6, before: 5 } },
    });
    expect(entries?.at(-1)?.diff).toEqual({
      _tag: "fields",
      changed: { n: { after: MODEL_LOG_CAP + 5, before: MODEL_LOG_CAP + 4 } },
    });
  });

  it("snapshots non-record models whole", async () => {
    const scalar = defineApp({
      init: () => ({ model: 0 }),
      update: (model: number, _message: "tick") => ({ model: model + 1 }),
      view: (model: number, dispatch: Dispatch<"tick">) => (
        <button type="button" onclick={() => dispatch("tick")}>
          {model}
        </button>
      ),
    });
    const { click, read } = await mountLogged(scalar.component);
    await click();
    expect(read()?.[0]?.diff).toEqual({
      _tag: "snapshot",
      after: 1,
      before: 0,
    });
  });

  it("summarizes errors, options, and cycles, and survives unserializable messages", async () => {
    interface Rich {
      readonly err?: Error;
      readonly opt?: Option.Option<number>;
      self?: unknown;
      readonly tag?: string;
    }
    const cyclic: Rich = { err: new Error("boom"), opt: Option.some(3) };
    cyclic.self = cyclic;
    const poison: Rich = {
      get tag(): string {
        throw new Error("touched");
      },
    };
    const rich = defineApp({
      init: () => ({ model: { n: 0 } }),
      update: (model: { n: number }, _message: Rich) => ({
        model: { n: model.n + 1 },
      }),
      view: (model: { n: number }, dispatch: Dispatch<Rich>) => (
        <div>
          <p>{model.n}</p>
          <button type="button" onclick={() => dispatch(cyclic)}>
            rich
          </button>
          <button type="button" onclick={() => dispatch(poison)}>
            bad
          </button>
        </div>
      ),
    });
    const { click, host, read } = await mountLogged(rich.component);
    await click();
    await click(1);
    expect(host.textContent).toBe("2richbad");
    expect(read()?.map((entry) => entry.message)).toEqual([
      {
        err: "<Error: boom>",
        opt: { _tag: "Some", value: 3 },
        self: "<circular>",
      },
      "<unserializable>",
    ]);
  });

  it("keeps islands apart and reads nothing for islands that never dispatched", async () => {
    const first = await mountLogged(counter.component);
    const second = await mountLogged(counter.component);
    await first.click();
    expect(first.read()?.length).toBe(1);
    expect(second.read()).toBeUndefined();
  });
});
