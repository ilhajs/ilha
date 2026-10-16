// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";
import type { AtomHandle } from "../src/index.ts";

let handle: AtomHandle<number> | undefined;

const Counter = () => {
  const n = atom(0);
  handle = n;
  return <p>{n()}</p>;
};

const setCount = (next: number): void => {
  if (!handle) {
    throw new Error("component did not render");
  }
  handle.set(next);
};

test("onIdle fires after the DOM reflects an atom update (mount)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const seen: string[] = [];
  const stop = mount(host, Counter, {
    onIdle: () => {
      seen.push(host.textContent ?? "");
    },
  });
  await Bun.sleep(5);
  seen.length = 0;
  setCount(5);
  // The rerender is queued, not synchronous.
  expect(host.textContent).toBe("0");
  await Bun.sleep(5);
  expect(seen).toEqual(["5"]);
  stop();
  host.remove();
});

test("onIdle fires after a hydrated update", async () => {
  const html = await renderToString(Counter);
  const wrapper = document.createElement("div");
  wrapper.append(
    ...new DOMParser().parseFromString(html, "text/html").body.childNodes
  );
  document.body.append(wrapper);
  const host = wrapper.querySelector("[data-ilha]");
  if (!host) {
    throw new Error("host missing");
  }
  const seen: string[] = [];
  mount(host, Counter, {
    hydrate: true,
    onIdle: () => {
      seen.push(host.textContent ?? "");
    },
  });
  await Bun.sleep(5);
  seen.length = 0;
  setCount(9);
  await Bun.sleep(5);
  expect(seen).toEqual(["9"]);
  wrapper.remove();
});
