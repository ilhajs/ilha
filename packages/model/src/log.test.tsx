// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Data, Effect, Option } from "effect";
import type { Component } from "ilha";
import { atomsOf, inspect } from "ilha/debug";
import { render } from "ilha/test";

import type { Dispatch } from "./index";
import {
  attachModelRecorder,
  defineApp,
  MODEL_LOG_CAP,
  readModelLog,
} from "./index";

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

interface Model {
  readonly count: number;
}

const app = defineApp({
  init: () => ({ model: { count: 0 } }),
  name: "LoggedCounter",
  update: (model: Model, message: Msg) =>
    Msg.$match(message, {
      AddBonus: ({ amount }) => ({ model: { count: model.count + amount } }),
      FetchBonus: () => ({
        cmd: Effect.succeed(Msg.AddBonus({ amount: 10 })),
        model,
      }),
      Increment: () => ({ model: { count: model.count + 1 } }),
    }),
  view: (model: Model, dispatch: Dispatch<Msg>) => (
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

const mountForLog = (component: Component) => {
  const host = document.createElement("div");
  document.body.append(host);
  const ui = render(component, { container: host });
  return { host, ui };
};

/** The island's log through the same join devtools uses: id to atoms. */
const readLog = (host: Element) => {
  const [node] = inspect(host);
  expect(node).toBeDefined();
  return readModelLog(atomsOf(node?.id ?? "") ?? []);
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

describe("message log", () => {
  it("records ordered entries with diffs and command counts", async () => {
    const detach = attachModelRecorder();
    try {
      const { host, ui } = mountForLog(app.component);
      try {
        await ui.click("button");
        await ui.click("button:nth-of-type(2)");
        await poll(() => ui.text() === "11incbonus");
        const entries = readLog(host);
        expect(entries?.map((entry) => entry.message)).toEqual([
          { _tag: "Increment" },
          { _tag: "FetchBonus" },
          { _tag: "AddBonus", amount: 10 },
        ]);
        expect(entries?.map((entry) => entry.commands)).toEqual([0, 1, 0]);
        expect(entries?.[0]?.diff).toEqual({
          _tag: "fields",
          changed: { count: { after: 1, before: 0 } },
        });
        expect(entries?.[1]?.diff).toEqual({ _tag: "fields", changed: {} });
        expect(entries?.[2]?.diff).toEqual({
          _tag: "fields",
          changed: { count: { after: 11, before: 1 } },
        });
        const stamps = entries?.map((entry) => entry.at) ?? [];
        expect(stamps.every((at) => Number.isFinite(at))).toBe(true);
        expect(
          stamps.every((at, i) => i === 0 || at >= (stamps[i - 1] ?? 0))
        ).toBe(true);
        expect(ui.errors).toEqual([]);
      } finally {
        ui.unmount();
        host.remove();
      }
    } finally {
      detach();
    }
  });

  it("records nothing and touches nothing when detached", async () => {
    let reads = 0;
    const poison = {
      get tag(): string {
        reads += 1;
        throw new Error("touched");
      },
    };
    const untouched = defineApp({
      init: () => ({ model: { n: 0 } }),
      update: (model: { n: number }) => ({ model }),
      view: (
        _model: { n: number },
        dispatch: Dispatch<{ readonly tag: string }>
      ) => (
        <button type="button" onclick={() => dispatch(poison)}>
          go
        </button>
      ),
    });
    const { host, ui } = mountForLog(untouched.component);
    try {
      await ui.click("button");
      expect(reads).toBe(0);
      expect(readLog(host)).toBeUndefined();
      expect(ui.errors).toEqual([]);
    } finally {
      ui.unmount();
      host.remove();
    }
  });

  it("drops the oldest entries past the cap", async () => {
    const detach = attachModelRecorder();
    try {
      const flood = defineApp({
        init: () => ({ model: { n: 0 } }),
        update: (model: { n: number }) => ({ model: { n: model.n + 1 } }),
        view: (model: { n: number }, dispatch: Dispatch<NoArgs>) => (
          <button
            type="button"
            onclick={() => {
              for (let i = 0; i < MODEL_LOG_CAP + 5; i += 1) {
                dispatch({});
              }
            }}
          >
            {model.n}
          </button>
        ),
      });
      const { host, ui } = mountForLog(flood.component);
      try {
        await ui.click("button");
        await ui.settled();
        expect(ui.text()).toBe(String(MODEL_LOG_CAP + 5));
        const entries = readLog(host);
        expect(entries?.length).toBe(MODEL_LOG_CAP);
        expect(entries?.[0]?.diff).toEqual({
          _tag: "fields",
          changed: { n: { after: 6, before: 5 } },
        });
        expect(entries?.at(-1)?.diff).toEqual({
          _tag: "fields",
          changed: {
            n: { after: MODEL_LOG_CAP + 5, before: MODEL_LOG_CAP + 4 },
          },
        });
        expect(ui.errors).toEqual([]);
      } finally {
        ui.unmount();
        host.remove();
      }
    } finally {
      detach();
    }
  });

  it("stops entries after unmount and after detach", async () => {
    const detach = attachModelRecorder();
    try {
      const { host, ui } = mountForLog(app.component);
      const [node] = inspect(host);
      const atoms = atomsOf(node?.id ?? "") ?? [];
      try {
        await ui.click("button");
        expect(readModelLog(atoms)?.length).toBe(1);
        ui.unmount();
        expect(readModelLog(atoms)).toBeUndefined();
      } finally {
        host.remove();
      }
      const remounted = mountForLog(app.component);
      try {
        await remounted.ui.click("button");
        expect(readLog(remounted.host)?.length).toBe(1);
        detach();
        await remounted.ui.click("button");
        expect(readLog(remounted.host)).toBeUndefined();
        expect(remounted.ui.errors).toEqual([]);
      } finally {
        remounted.ui.unmount();
        remounted.host.remove();
      }
    } finally {
      detach();
    }
  });

  it("snapshots non-record models whole", async () => {
    const detach = attachModelRecorder();
    try {
      const scalar = defineApp({
        init: () => ({ model: 0 }),
        update: (model: number) => ({ model: model + 1 }),
        view: (model: number, dispatch: Dispatch<NoArgs>) => (
          <button type="button" onclick={() => dispatch({})}>
            {model}
          </button>
        ),
      });
      const { host, ui } = mountForLog(scalar.component);
      try {
        await ui.click("button");
        expect(readLog(host)?.[0]?.diff).toEqual({
          _tag: "snapshot",
          after: 1,
          before: 0,
        });
        expect(ui.errors).toEqual([]);
      } finally {
        ui.unmount();
        host.remove();
      }
    } finally {
      detach();
    }
  });

  it("counts every command a message starts", async () => {
    const detach = attachModelRecorder();
    try {
      const two = defineApp({
        init: () => ({ model: { n: 0 } }),
        update: (model: { n: number }) => ({
          cmd: [Effect.void, Effect.void],
          model: { n: model.n + 1 },
        }),
        view: (model: { n: number }, dispatch: Dispatch<NoArgs>) => (
          <button type="button" onclick={() => dispatch({})}>
            {model.n}
          </button>
        ),
      });
      const { host, ui } = mountForLog(two.component);
      try {
        await ui.click("button");
        await ui.settled();
        const entries = readLog(host);
        expect(entries?.length).toBe(1);
        expect(entries?.[0]?.commands).toBe(2);
        expect(ui.errors).toEqual([]);
      } finally {
        ui.unmount();
        host.remove();
      }
    } finally {
      detach();
    }
  });

  it("summarizes errors, options, and cycles without throwing", async () => {
    const detach = attachModelRecorder();
    try {
      interface Rich {
        readonly err: Error;
        readonly opt: Option.Option<number>;
        self: unknown;
      }
      const message: Rich = {
        err: new Error("boom"),
        opt: Option.some(3),
        self: undefined,
      };
      message.self = message;
      const rich = defineApp({
        init: () => ({ model: { n: 0 } }),
        update: (model: { n: number }, _message: Rich) => ({
          model: { n: model.n + 1 },
        }),
        view: (model: { n: number }, dispatch: Dispatch<Rich>) => (
          <button type="button" onclick={() => dispatch(message)}>
            {model.n}
          </button>
        ),
      });
      const { host, ui } = mountForLog(rich.component);
      try {
        await ui.click("button");
        expect(readLog(host)?.[0]?.message).toEqual({
          err: "<Error: boom>",
          opt: { _tag: "Some", value: 3 },
          self: "<circular>",
        });
        expect(ui.errors).toEqual([]);
      } finally {
        ui.unmount();
        host.remove();
      }
    } finally {
      detach();
    }
  });

  it("keeps dispatch working when a message cannot serialize", async () => {
    const detach = attachModelRecorder();
    try {
      const poison = {
        get tag(): string {
          throw new Error("touched");
        },
      };
      const fragile = defineApp({
        init: () => ({ model: { n: 0 } }),
        update: (model: { n: number }) => ({ model: { n: model.n + 1 } }),
        view: (
          model: { n: number },
          dispatch: Dispatch<{ readonly tag: string }>
        ) => (
          <div>
            <p>{model.n}</p>
            <button type="button" onclick={() => dispatch(poison)}>
              bad
            </button>
            <button type="button" onclick={() => dispatch({ tag: "ok" })}>
              good
            </button>
          </div>
        ),
      });
      const { host, ui } = mountForLog(fragile.component);
      try {
        await ui.click("button");
        await ui.click("button:nth-of-type(2)");
        expect(ui.text()).toBe("2badgood");
        expect(readLog(host)?.map((entry) => entry.message)).toEqual([
          "<unserializable>",
          { tag: "ok" },
        ]);
        expect(ui.errors).toEqual([]);
      } finally {
        ui.unmount();
        host.remove();
      }
    } finally {
      detach();
    }
  });
});
