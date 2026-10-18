import { connectPanelChannel } from "devframe/in-page-channel";
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
