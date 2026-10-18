import { afterEach, describe, expect, it } from "bun:test";

import { connectPanelChannel } from "devframe/in-page-channel";
import { mount } from "ilha";

import { installIlhaDevtools } from "../src/page.ts";
import { ILHA_DEVTOOLS_CHANNEL } from "../src/protocol.ts";
import type { IlhaDevtoolsProtocol } from "../src/protocol.ts";
import { createApp } from "../src/spa/app.tsx";
import { Counter, mountHost, selectorOf, settle } from "./helpers.tsx";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  document.body.innerHTML = "";
});

const openPanel = async () => {
  const mounted = await mountHost(Counter);
  const handle = installIlhaDevtools({ webmcp: false, window: false });
  const panelHost = document.createElement("div");
  document.body.append(panelHost);
  const unmountPanel = mount(
    panelHost,
    createApp(() => {
      const { port1, port2 } = new MessageChannel();
      handle.channel.addPanelPort(port1);
      return connectPanelChannel<IlhaDevtoolsProtocol>({
        functions: {},
        name: ILHA_DEVTOOLS_CHANNEL,
        transport: port2,
        window: false,
      });
    })
  );
  cleanups.push(unmountPanel, handle.dispose, mounted.unmount);
  await settle(50);
  return { ...mounted, panelHost };
};

const rowFor = (panelHost: HTMLElement, name: string) =>
  [...panelHost.querySelectorAll<HTMLButtonElement>("button.node")].find(
    (button) => button.textContent?.trim() === name
  );

describe("panel", () => {
  it("lists islands and their children", async () => {
    const { panelHost } = await openPanel();
    expect(rowFor(panelHost, "Counter")).toBeDefined();
    expect(rowFor(panelHost, "Badge")).toBeDefined();
  });

  it("shows the atoms of the selected component", async () => {
    const { panelHost } = await openPanel();
    rowFor(panelHost, "Counter")?.click();
    await settle();
    const inputs = [...panelHost.querySelectorAll("input")];
    expect(inputs.map((input) => input.value)).toEqual(["1", '"hello"']);
  });

  it("writes an edited atom back to the page", async () => {
    const { panelHost, host } = await openPanel();
    rowFor(panelHost, "Counter")?.click();
    await settle();
    const [, input] = panelHost.querySelectorAll("input");
    if (!input) {
      throw new Error("atom input missing");
    }
    input.value = '"edited"';
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(50);
    expect(host.querySelector("p")?.textContent).toContain("edited");
    expect(selectorOf(host)).toStartWith("div#host-");
  });

  it("reports invalid JSON without calling the page", async () => {
    const { panelHost } = await openPanel();
    rowFor(panelHost, "Counter")?.click();
    await settle();
    const input = panelHost.querySelector("input");
    if (!input) {
      throw new Error("atom input missing");
    }
    input.value = "{nope";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(panelHost.querySelector(".error")?.textContent).toContain(
      "not valid JSON"
    );
  });

  it("says when no page script answers", async () => {
    const panelHost = document.createElement("div");
    document.body.append(panelHost);
    const unmount = mount(
      panelHost,
      createApp(() =>
        connectPanelChannel<IlhaDevtoolsProtocol>({
          functions: {},
          name: ILHA_DEVTOOLS_CHANNEL,
          targets: [],
          window: false,
        })
      )
    );
    cleanups.push(unmount);
    await settle(3100);
    expect(panelHost.textContent).toContain("No page found");
  }, 6000);
});
