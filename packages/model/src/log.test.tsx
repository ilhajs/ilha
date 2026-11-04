// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Effect } from "effect";
import { atomsOf, inspect } from "ilha/debug";
import { render } from "ilha/test";

import type { DispatchRecord, Dispatch } from "./index";
import { attachModelRecorder, defineApp } from "./index";

const app = defineApp({
  init: () => ({ model: { count: 0 } }),
  update: (model: { count: number }, message: "inc" | "fetch") =>
    message === "inc"
      ? { model: { count: model.count + 1 } }
      : { cmd: [Effect.void, Effect.void], model },
  view: (model: { count: number }, dispatch: Dispatch<"inc" | "fetch">) => (
    <div>
      <p>{model.count}</p>
      <button type="button" onclick={() => dispatch("inc")}>
        inc
      </button>
      <button type="button" onclick={() => dispatch("fetch")}>
        fetch
      </button>
    </div>
  ),
});

const mount = () => {
  const host = document.createElement("div");
  document.body.append(host);
  const ui = render(app.component, { container: host });
  return {
    atoms: () => atomsOf(inspect(host)[0]?.id ?? "") ?? [],
    dispose: () => {
      ui.unmount();
      host.remove();
    },
    ui,
  };
};

describe("attachModelRecorder", () => {
  it("hands each dispatch over raw, in order, keyed by the island's model atom", async () => {
    const seen: DispatchRecord[] = [];
    const detach = attachModelRecorder((record) => {
      seen.push(record);
    });
    const { atoms, dispose, ui } = mount();
    try {
      await ui.click("button");
      await ui.click("button:nth-of-type(2)");
      expect(seen.map(({ message }) => message)).toEqual(["inc", "fetch"]);
      expect(seen.map(({ commands }) => commands)).toEqual([0, 2]);
      expect(seen[0]?.before).toEqual({ count: 0 });
      expect(seen[0]?.after).toEqual({ count: 1 });
      // The same object update returned, not a copy.
      expect(seen[1]?.before).toBe(seen[0]?.after);
      expect(atoms().some((atom) => atom === seen[0]?.instance)).toBe(true);
    } finally {
      dispose();
      detach();
    }
  });

  it("stops at detach and touches nothing while detached", async () => {
    let calls = 0;
    const detach = attachModelRecorder(() => {
      calls += 1;
    });
    const { dispose, ui } = mount();
    try {
      await ui.click("button");
      detach();
      await ui.click("button");
      expect(calls).toBe(1);
      expect(ui.text()).toBe("2incfetch");
    } finally {
      dispose();
    }
  });

  it("keeps dispatch working when a recorder throws", async () => {
    const detach = attachModelRecorder(() => {
      throw new Error("recorder broke");
    });
    const { dispose, ui } = mount();
    try {
      await ui.click("button");
      await ui.click("button");
      expect(ui.text()).toBe("2incfetch");
      expect(ui.errors).toEqual([]);
    } finally {
      dispose();
      detach();
    }
  });
});
