// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Effect, Schema } from "effect";
import { atomsOf, inspect } from "ilha/debug";
import type { IlhaInspectNode } from "ilha/debug";
import { render } from "ilha/test";

import { attachModelRecorder, Command, defineComponent } from "./index";
import type { DispatchRecord } from "./index";

const Msg = Schema.TaggedUnion({
  Add: {},
  Reset: {},
  Resetted: {},
});

const DelayReset = Command.make("DelayReset", () =>
  Effect.succeed(Msg.cases.Resetted.make({}))
);

const Counter = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "Counter",
}).make({
  init: () => ({ count: 0 }),
  update: {
    Add: ($) => $.evolve({ count: (c) => c + 1 }),
    Reset: ($) => $.run(DelayReset()),
    Resetted: ($) => $.set({ count: 0 }),
  },
  view: (h, model) => (
    <div>
      <output>{model.count}</output>
      <button data-testid="add" onclick={h.send(Msg.cases.Add.make({}))}>
        add
      </button>
      <button data-testid="reset" onclick={h.send(Msg.cases.Reset.make({}))}>
        reset
      </button>
    </div>
  ),
});

const findNode = (
  nodes: readonly IlhaInspectNode[],
  component: string
): string | undefined => {
  for (const node of nodes) {
    if (node.component === component) {
      return node.id;
    }

    const child = findNode(node.children, component);

    if (child !== undefined) {
      return child;
    }
  }

  return undefined;
};

const poll = async (
  done: () => boolean,
  deadline = Date.now() + 3000
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

describe("recorder", () => {
  it("records dispatches with the model atom as instance", async () => {
    const records: DispatchRecord[] = [];
    const detach = attachModelRecorder((record) => records.push(record));
    const ui = render(() => <Counter />);
    await ui.settled();
    await ui.click('[data-testid="add"]');
    await ui.click('[data-testid="reset"]');
    await poll(() => records.length === 3);
    detach();

    // SAFETY: the two clicks above record exactly three dispatches in order.
    const [added, reset, resetted] = records as [
      DispatchRecord,
      DispatchRecord,
      DispatchRecord,
    ];

    expect(added?.message).toEqual(Msg.cases.Add.make({}));
    expect(added?.before).toEqual({ count: 0 });
    expect(added?.after).toEqual({ count: 1 });
    expect(added?.commands).toBe(0);
    expect(reset?.commands).toBe(1);
    expect(resetted?.message).toEqual(Msg.cases.Resetted.make({}));
    expect(resetted?.after).toEqual({ count: 0 });
    const id = findNode(inspect(), "Counter");
    expect(id).toBeDefined();
    // SAFETY: expect(id).toBeDefined() above guarantees a node id.
    const atoms = atomsOf(id as string);
    expect(atoms).toBeDefined();
    expect(added?.instance).toBeDefined();
    // SAFETY: debug atoms are exposed as an unknown list for this harness.
    const atomList = atoms as readonly unknown[];
    expect(atomList.includes(added?.instance)).toBe(true);
    await ui.click('[data-testid="add"]');
    await ui.settled();
    expect(records.length).toBe(3);
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });
});
