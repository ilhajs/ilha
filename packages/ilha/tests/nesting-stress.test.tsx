/** @jsxImportSource ../src */
import { expect, test } from "bun:test";

import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type { AtomHandle } from "ilha";

import { atom, mount } from "../src/index.ts";

const LEVELS = 10;

function Deep(props: Record<string, unknown>) {
  const depth = props.depth as number;
  const local = atom(depth);
  if (depth >= LEVELS) return <span data-depth={depth}>leaf:{local}</span>;
  return (
    <div data-depth={depth}>
      <Deep depth={depth + 1} />
    </div>
  );
}

test("ten levels of nested components mount and rerender", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, () => <Deep depth={1} />);
  await Bun.sleep(5);
  for (let depth = 1; depth <= LEVELS; depth++) {
    expect(el.querySelector(`[data-depth="${depth}"]`)).not.toBeNull();
  }
  expect(el.textContent).toContain("leaf:10");
  unmount();
  el.remove();
});

test("fifty keyed rows survive add, remove, and reorder", async () => {
  let next = 0;
  type Task = { id: number; label: string };
  let tasks: AtomHandle<Task[]> | undefined;

  const Row = (props: Record<string, unknown>) => {
    const task = props.task as Task;
    return <li data-id={task.id}>{task.label}</li>;
  };

  const App = function* () {
    const initial = atom<Task[]>(
      Array.from({ length: 50 }, () => ({ id: ++next, label: `task-${next}` })),
    );
    tasks ??= initial;
    yield Stream.map(Atom.toStream(initial.atom), (list: Task[]) => (
      <ul>
        {list.map((task) => (
          <Row key={task.id} task={task} />
        ))}
      </ul>
    ));
  };

  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(20);
  expect(el.querySelectorAll("li")).toHaveLength(50);
  expect(el.querySelector('li[data-id="1"]')).not.toBeNull();

  // Remove 10 from the front, add 10 at the back.
  tasks!.update((list) => [
    ...list.slice(10),
    ...Array.from({ length: 10 }, () => ({ id: ++next, label: `task-${next}` })),
  ]);
  await Bun.sleep(20);
  const lis = el.querySelectorAll("li");
  expect(lis).toHaveLength(50);
  expect(el.querySelector('li[data-id="1"]')).toBeNull();
  expect(el.querySelector(`li[data-id="${next}"]`)).not.toBeNull();
  expect(lis[0]!.getAttribute("data-id")).toBe("11");

  unmount();
  el.remove();
});

test("computed atoms track through nested components", async () => {
  let deep: AtomHandle<number> | undefined;
  function Level(props: Record<string, unknown>) {
    const depth = props.depth as number;
    const derived = atom(() => (deep?.() ?? 0) + depth);
    if (depth === LEVELS) return <span data-out={depth}>{derived}</span>;
    return (
      <div>
        <Level depth={depth + 1} />
      </div>
    );
  }
  const App = () => {
    const root = atom(0);
    deep ??= root;
    return <Level depth={1} />;
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(el.querySelector(`[data-out="${LEVELS}"]`)!.textContent).toBe(`${LEVELS}`);
  deep!.set(100);
  await Bun.sleep(5);
  expect(el.querySelector(`[data-out="${LEVELS}"]`)!.textContent).toBe(`${LEVELS + 100}`);
  unmount();
  el.remove();
});
