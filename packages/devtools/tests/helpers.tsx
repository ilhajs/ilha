import { defineComponent } from "@ilha/model";
import { connectPanelChannel } from "devframe/in-page-channel";
import { Schema } from "effect";
import { atom, mount } from "ilha";
import type { Component } from "ilha";

import { installIlhaDevtools } from "../src/page.ts";
import { ILHA_DEVTOOLS_CHANNEL } from "../src/protocol.ts";
import type { IlhaDevtoolsProtocol } from "../src/protocol.ts";

export const Badge = () => {
  const n = atom(5);

  return (
    <button type="button" onclick={() => n.update((x: number) => x + 1)}>
      {n}
    </button>
  );
};

export const Counter = () => {
  const count = atom(1);
  const label = atom("hello");

  return (
    <div>
      <p>
        {label()} {count()}
      </p>
      <Badge />
    </div>
  );
};

export const settle = (ms = 20) => Bun.sleep(ms);

const ModelMsg = Schema.TaggedUnion({
  Bang: { err: Schema.Unknown, loop: Schema.Unknown },
  Increment: {},
});

/** Cyclic payload for the `Bang` log probe. */
interface BangLoop {
  self?: unknown;
}

/** A model island for log tests: `inc` counts, `bang` logs a rich message. */
export const modelApp = defineComponent({
  message: ModelMsg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "ModelCounter",
}).make({
  init: () => ({ count: 0 }),
  update: {
    Bang: ($) => $.model,
    Increment: ($) => $.evolve({ count: (n) => n + 1 }),
  },
  view: (h, model) => (
    <div>
      <p>{model.count}</p>
      <button type="button" onclick={h.send(ModelMsg.cases.Increment.make({}))}>
        inc
      </button>
      <button
        type="button"
        onclick={() => {
          const loop: BangLoop = {};
          loop.self = loop;
          h.send(ModelMsg.cases.Bang.make({ err: new Error("boom"), loop }))();
        }}
      >
        bang
      </button>
    </div>
  ),
});

let hostCount = 0;

/** The selector `inspect()` reports for a host from `mountHost`. */
export const selectorOf = (host: HTMLElement): string => `div#${host.id}`;

/** Mount `component` into a fresh host and return it with its unmount. */
export const mountHost = async (component: Component = Counter) => {
  const host = document.createElement("div");
  hostCount += 1;
  host.id = `host-${hostCount}`;
  document.body.append(host);
  const unmount = mount(host, component);
  await settle();

  return { host, unmount };
};

/** Install the page script and connect a panel over a MessageChannel. */
export const connectPair = () => {
  const handle = installIlhaDevtools({ webmcp: false, window: false });
  const { port1, port2 } = new MessageChannel();
  handle.channel.addPanelPort(port1);

  const panel = connectPanelChannel<IlhaDevtoolsProtocol>({
    functions: {},
    name: ILHA_DEVTOOLS_CHANNEL,
    transport: port2,
    window: false,
  });

  return { handle, panel };
};
