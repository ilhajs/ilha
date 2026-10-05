// @jsxImportSource ../src
import { expect, spyOn, test } from "bun:test";

import { atom, mount, watch } from "../src/index.ts";

const events: string[] = [];
const rowRenders: string[] = [];

/** A stateful row: its own counter, and a label that comes from the parent. */
const Row = ({ id, label }: { id?: unknown; label?: unknown }) => {
  const n = atom(0);
  rowRenders.push(String(id));
  watch.once(() => {
    events.push(`mount:${String(id)}`);
    return () => {
      events.push(`unmount:${String(id)}`);
    };
  });
  return (
    <button
      class={`row-${String(id)}`}
      onclick={() => n.update((x: number) => x + 1)}
    >
      {String(label)}:{n()}
    </button>
  );
};

const rowsText = (el: Element): string =>
  [...el.querySelectorAll("button[class^=row]")]
    .map((button) => button.textContent)
    .join(" ");

const click = async (el: Element, selector: string): Promise<void> => {
  const found = el.querySelector(selector);
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`${selector} missing`);
  }
  found.click();
  await Bun.sleep(8);
};

/** Keyed rows inside an element of the root component. */
const InRoot = () => {
  const tick = atom(0);
  return (
    <div>
      <button class="bump" onclick={() => tick.update((x: number) => x + 1)}>
        bump
      </button>
      <Row key="a" id="a" label={`a${tick()}`} />
      <Row key="b" id="b" label={`b${tick()}`} />
    </div>
  );
};

/** The same rows, inside an element of a nested component. */
const Inner = () => {
  const tick = atom(0);
  return (
    <section>
      <button class="bump" onclick={() => tick.update((x: number) => x + 1)}>
        bump
      </button>
      <Row key="a" id="a" label={`a${tick()}`} />
      <Row key="b" id="b" label={`b${tick()}`} />
    </section>
  );
};

const InNested = () => (
  <div>
    <Inner />
  </div>
);

const tickOfList = { bump: (): void => undefined };

/** A component that returns only a list of keyed components. */
const BareList = () => {
  const tick = atom(0);
  tickOfList.bump = () => tick.update((x: number) => x + 1);
  return [
    <Row key="a" id="a" label={`a${tick()}`} />,
    <Row key="b" id="b" label="fixed" />,
  ];
};

/** The same list inside an element. */
const WrappedList = () => {
  const tick = atom(0);
  tickOfList.bump = () => tick.update((x: number) => x + 1);
  return (
    <span>
      <Row key="a" id="a" label={`a${tick()}`} />
      <Row key="b" id="b" label="fixed" />
    </span>
  );
};

const withList = (List: typeof BareList | typeof WrappedList) => () => (
  <div>
    <button class="bump" onclick={() => tickOfList.bump()}>
      bump
    </button>
    <List />
  </div>
);

/** Clicks, then a parent repaint: state must stay, labels must follow. */
const exercise = async (el: Element): Promise<string> => {
  await click(el, ".row-a");
  await click(el, ".row-a");
  await click(el, ".row-b");
  await click(el, ".bump");
  await click(el, ".row-b");
  return rowsText(el);
};

test("keyed rows in the root component keep state and take new props", async () => {
  events.length = 0;
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, InRoot);
  await Bun.sleep(10);

  expect(await exercise(el)).toBe("a1:2 b1:2");
  expect(events).toEqual(["mount:a", "mount:b"]);
  unmount();
  el.remove();
});

test("keyed rows in a nested component keep state and take new props", async () => {
  events.length = 0;
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, InNested);
  await Bun.sleep(10);

  expect(await exercise(el)).toBe("a1:2 b1:2");
  // Not remounted by the nested component's repaint.
  expect(events).toEqual(["mount:a", "mount:b"]);
  unmount();
  el.remove();
});

for (const [placement, List] of [
  ["bare", BareList],
  ["wrapped", WrappedList],
] as const) {
  test(`a ${placement} keyed list reruns the rows whose props changed, and only those`, async () => {
    events.length = 0;
    const el = document.createElement("div");
    document.body.append(el);
    const unmount = mount(el, withList(List));
    await Bun.sleep(10);

    const untouched = el.querySelector(".row-b");
    await click(el, ".row-a");
    await click(el, ".row-b");
    rowRenders.length = 0;
    await click(el, ".bump");
    expect(rowRenders).toEqual(["a"]);
    expect(rowsText(el)).toBe("a1:1 fixed:1");
    await click(el, ".row-b");
    expect(rowRenders).toEqual(["a", "b"]);
    expect(rowsText(el)).toBe("a1:1 fixed:2");
    expect(events).toEqual(["mount:a", "mount:b"]);
    expect(el.querySelector(".row-b")).toBe(untouched);
    unmount();
    el.remove();
  });
}

const renders: string[] = [];

/** Reads the same atom as its parent, and gets a label derived from it. */
const Chip = ({ value, label }: { value?: unknown; label?: unknown }) => {
  // SAFETY: the test passes the parent's atom handle as `value`.
  const current = (value as () => string)();
  renders.push(`${String(label)}/${current}`);
  return <p class="chip">{String(label)}</p>;
};

const Picker = () => {
  const model = atom("fast");
  return (
    <div>
      <button class="pick" onclick={() => model.set("deep")}>
        pick
      </button>
      <Chip value={model} label={model() === "fast" ? "Fast" : "Deep"} />
    </div>
  );
};

test("a child that reads its parent's atom is not repainted with old props", async () => {
  renders.length = 0;
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, Picker);
  await Bun.sleep(10);
  expect(el.querySelector(".chip")?.textContent).toBe("Fast");

  await click(el, ".pick");
  expect(el.querySelector(".chip")?.textContent).toBe("Deep");
  // One render per change: the repaint queued for the child's own read is
  // dropped once the parent has rerun it.
  expect(renders).toEqual(["Fast/fast", "Deep/deep"]);
  unmount();
  el.remove();
});

/** Two components with their own state, so a leak between them shows. */
const Apple = ({ id }: { id?: unknown }) => {
  const n = atom("apple-state");
  return (
    <p class="fruit">
      apple {String(id)} {n()}
    </p>
  );
};

const Pear = ({ id }: { id?: unknown }) => {
  const n = atom("pear-state");
  return (
    <p class="fruit">
      pear {String(id)} {n()}
    </p>
  );
};

const fruit = { pear: (): void => undefined };

const BareFruit = () => {
  const pear = atom(false);
  fruit.pear = () => pear.set(true);
  return [pear() ? <Pear key="1" id="1" /> : <Apple key="1" id="1" />];
};

const WrappedFruit = () => {
  const pear = atom(false);
  fruit.pear = () => pear.set(true);
  return (
    <span>{pear() ? <Pear key="1" id="1" /> : <Apple key="1" id="1" />}</span>
  );
};

for (const [placement, Fruit] of [
  ["bare", BareFruit],
  ["wrapped", WrappedFruit],
] as const) {
  test(`a ${placement} key that changes component mounts the new one fresh`, async () => {
    const el = document.createElement("div");
    document.body.append(el);
    const unmount = mount(el, () => (
      <div>
        <Fruit />
      </div>
    ));
    await Bun.sleep(10);
    expect(el.querySelector(".fruit")?.textContent).toBe("apple 1 apple-state");

    fruit.pear();
    await Bun.sleep(10);
    expect(el.querySelectorAll(".fruit")).toHaveLength(1);
    expect(el.querySelector(".fruit")?.textContent).toBe("pear 1 pear-state");
    unmount();
    el.remove();
  });
}

const twinTick = { bump: (): void => undefined };

const Twins = () => {
  const tick = atom(0);
  twinTick.bump = () => tick.update((x: number) => x + 1);
  return [
    <Row key="twin" id="one" label={`one${tick()}`} />,
    <Row key="twin" id="two" label={`two${tick()}`} />,
  ];
};

test("a key used twice in a bare keyed list warns and renders both", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, () => (
    <div>
      <Twins />
    </div>
  ));
  await Bun.sleep(10);
  expect(rowsText(el)).toBe("one0:0 two0:0");

  await click(el, ".row-two");
  twinTick.bump();
  await Bun.sleep(10);
  expect(rowsText(el)).toBe("one1:0 two1:1");
  expect(
    warn.mock.calls.filter((call) => String(call[0]).includes('key "twin"'))
  ).toHaveLength(1);
  warn.mockRestore();
  unmount();
  el.remove();
});

const slow = { bump: (): void => undefined };

/** An async row with its own atom: a self-render can start mid-render. */
const SlowRow = async ({ label }: { label?: unknown }) => {
  const n = atom(0);
  slow.bump = () => n.update((x: number) => x + 1);
  const count = n();
  await Bun.sleep(15);
  return (
    <p class="slow">
      {String(label)}:{count}
    </p>
  );
};

const SlowParent = () => {
  const tick = atom(0);
  return (
    <div>
      <button class="bump" onclick={() => tick.update((x: number) => x + 1)}>
        bump
      </button>
      <SlowRow key="s" label={`L${tick()}`} />
    </div>
  );
};

test("an async keyed row's self-render uses the props of the newest parent render", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, SlowParent);
  await Bun.sleep(40);
  expect(el.querySelector(".slow")?.textContent).toBe("L0:0");

  // The parent hands the row new props, and the row's own atom changes while
  // that render is still awaiting.
  const bump = el.querySelector(".bump");
  if (!(bump instanceof HTMLButtonElement)) {
    throw new Error(".bump missing");
  }
  bump.click();
  await Bun.sleep(3);
  slow.bump();
  await Bun.sleep(60);
  expect(el.querySelector(".slow")?.textContent).toBe("L1:1");
  unmount();
  el.remove();
});
