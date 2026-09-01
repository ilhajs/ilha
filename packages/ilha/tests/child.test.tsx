/** @jsxImportSource ../src */
import { expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";

const Badge = async (props: Record<string, unknown>) => {
  const n = atom(0);
  return (
    <button id="badge" onclick={() => n.update((x: number) => x + 1)}>
      {String(props.label ?? "")}
      {n}
    </button>
  );
};

test("async child inside generator parent", async () => {
  const Page = function* () {
    yield (
      <div>
        <p>parent</p>
        <Badge label="n=" />
      </div>
    );
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, Page);
  await Bun.sleep(10);
  expect(el.textContent).toContain("parent");
  expect(el.textContent).toContain("n=0");
  (el.querySelector("#badge") as HTMLButtonElement).click();
  await Bun.sleep(10);
  expect(el.textContent).toContain("n=1");
  el.remove();
});

test("generator child inside async parent", async () => {
  const Ticker = function* () {
    const n = atom(0);
    yield (
      <button id="tick" onclick={() => n.update((x: number) => x + 1)}>
        gen {n}
      </button>
    );
  };
  const Page = async () => {
    const label = atom("async parent");
    return (
      <div>
        <p>{label}</p>
        <Ticker />
      </div>
    );
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, Page);
  await Bun.sleep(15);
  expect(el.textContent).toContain("async parent");
  expect(el.textContent).toContain("gen 0");
  (el.querySelector("#tick") as HTMLButtonElement).click();
  await Bun.sleep(10);
  expect(el.textContent).toContain("gen 1");
  el.remove();
});
