// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";
import type { PropBag } from "../src/types.ts";

const Badge = (props: PropBag) => {
  const n = atom(0);
  return (
    <button id="badge" onclick={() => n.update((x: number) => x + 1)}>
      {String(props.label ?? "")}
      {n}
    </button>
  );
};

const GeneratorPage = function* GeneratorPage() {
  yield (
    <div>
      <p>parent</p>
      <Badge label="n=" />
    </div>
  );
};

test("async child inside generator parent", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, GeneratorPage);
  await Bun.sleep(10);
  expect(el.textContent).toContain("parent");
  expect(el.textContent).toContain("n=0");
  const badge = el.querySelector("#badge");
  if (!(badge instanceof HTMLButtonElement)) {
    throw new Error("#badge missing");
  }
  badge.click();
  await Bun.sleep(10);
  expect(el.textContent).toContain("n=1");
  el.remove();
});

const Ticker = function* Ticker() {
  const n = atom(0);
  yield (
    <button id="tick" onclick={() => n.update((x: number) => x + 1)}>
      gen {n}
    </button>
  );
};

const AsyncPage = () => {
  const label = atom("async parent");
  return (
    <div>
      <p>{label}</p>
      <Ticker />
    </div>
  );
};

test("generator child inside async parent", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, AsyncPage);
  await Bun.sleep(15);
  expect(el.textContent).toContain("async parent");
  expect(el.textContent).toContain("gen 0");
  const tick = el.querySelector("#tick");
  if (!(tick instanceof HTMLButtonElement)) {
    throw new Error("#tick missing");
  }
  tick.click();
  await Bun.sleep(10);
  expect(el.textContent).toContain("gen 1");
  el.remove();
});
