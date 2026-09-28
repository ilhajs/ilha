// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";

const ResetApp = () => {
  const text = atom("hello");
  return (
    <div>
      <input id="controlled" value={text()} />
      <button id="reset" type="button" onclick={() => text.set("reset!")}>
        reset
      </button>
    </div>
  );
};

test("controlled input resets to the rendered value", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ResetApp);
  await Bun.sleep(10);

  const input = el.querySelector("#controlled");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("input missing");
  }
  expect(input.value).toBe("hello");
  // User edit lands in the live property only.
  input.value = "user edit";
  el.querySelector("#reset")?.click();
  await Bun.sleep(10);

  expect(input.value).toBe("reset!");
  unmount();
  el.remove();
});

const ShiftApp = () => {
  const show = atom(false);
  return (
    <div>
      {show() ? <p id="extra">extra</p> : null}
      <input id="below" placeholder="type here" />
      <button
        id="toggle"
        type="button"
        onclick={() => show.update((v: boolean) => !v)}
      >
        toggle
      </button>
    </div>
  );
};

test("conditional above an input does not shift the morph", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ShiftApp);
  await Bun.sleep(10);

  const input = el.querySelector("#below");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("input missing");
  }
  input.value = "typed";
  el.querySelector("#toggle")?.click();
  await Bun.sleep(10);

  expect(el.querySelector("#extra")?.textContent).toBe("extra");
  // The skipped branch leaves a placeholder, so the input keeps its node.
  expect(el.querySelector("#below")).toBe(input);
  expect(input.value).toBe("typed");

  el.querySelector("#toggle")?.click();
  await Bun.sleep(10);
  expect(el.querySelector("#extra")).toBeNull();
  expect(el.querySelector("#below")).toBe(input);
  expect(input.value).toBe("typed");
  unmount();
  el.remove();
});

const HydResetApp = () => {
  const text = atom("hello");
  return (
    <div>
      <input id="hyd-controlled" value={text()} />
      <button id="hyd-reset" type="button" onclick={() => text.set("reset!")}>
        reset
      </button>
    </div>
  );
};

test("controlled reset works after hydration", async () => {
  const html = await renderToString(HydResetApp);
  expect(html).toContain('value="hello"');

  const el = document.createElement("div");
  document.body.append(el);
  el.innerHTML = html;
  const unmount = mount(el, HydResetApp, { hydrate: true });
  await Bun.sleep(10);

  const input = el.querySelector("#hyd-controlled");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("input missing");
  }
  input.value = "user edit";
  el.querySelector("#hyd-reset")?.click();
  await Bun.sleep(10);

  expect(input.value).toBe("reset!");
  unmount();
  el.remove();
});
