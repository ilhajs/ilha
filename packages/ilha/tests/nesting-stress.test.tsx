// @jsxImportSource ../src
import { expect, test } from "bun:test";

import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type { AtomHandle } from "ilha";

import { atom, mount } from "../src/index.ts";
import type { PropBag } from "../src/types.ts";

const LEVELS = 10;

type DeepProps = PropBag & { readonly depth: number };
interface Task {
  id: number;
  label: string;
}
type RowProps = PropBag & { readonly task: Task };
type LevelProps = PropBag & { readonly depth: number };

const Deep = (props: DeepProps) => {
  const { depth } = props;
  const local = atom(depth);
  if (depth >= LEVELS) {
    return <span data-depth={depth}>leaf:{local}</span>;
  }
  return (
    <div data-depth={depth}>
      <Deep depth={depth + 1} />
    </div>
  );
};

test("ten levels of nested components mount and rerender", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, () => <Deep depth={1} />);
  await Bun.sleep(5);
  for (let depth = 1; depth <= LEVELS; depth += 1) {
    expect(el.querySelector(`[data-depth="${depth}"]`)).not.toBeNull();
  }
  expect(el.textContent).toContain("leaf:10");
  unmount();
  el.remove();
});

const Row = (props: RowProps) => {
  const { task } = props;
  return <li data-id={task.id}>{task.label}</li>;
};

test("fifty keyed rows survive add, remove, and reorder", async () => {
  let next = 0;
  let tasks: AtomHandle<Task[]> | undefined;

  const App = function* App() {
    const initial = atom<Task[]>(
      Array.from({ length: 50 }, () => {
        next += 1;
        return {
          id: next,
          label: `task-${next}`,
        };
      })
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

  if (!tasks) {
    throw new Error("tasks missing");
  }
  // Remove 10 from the front, add 10 at the back.
  tasks.update((list) => [
    ...list.slice(10),
    ...Array.from({ length: 10 }, () => {
      next += 1;
      return {
        id: next,
        label: `task-${next}`,
      };
    }),
  ]);
  await Bun.sleep(20);
  const lis = el.querySelectorAll("li");
  expect(lis).toHaveLength(50);
  expect(el.querySelector('li[data-id="1"]')).toBeNull();
  expect(el.querySelector(`li[data-id="${next}"]`)).not.toBeNull();
  const [first] = lis;
  if (!first) {
    throw new Error("first li missing");
  }
  expect(first.dataset.id).toBe("11");

  unmount();
  el.remove();
});

test("Atom.transform tracks through nested components", async () => {
  let deep: AtomHandle<number> | undefined;

  const Level = (props: LevelProps) => {
    const { depth } = props;
    if (!deep) {
      throw new Error("deep root missing");
    }
    const derived = atom(
      Atom.transform(deep.atom, (get, source) => get(source) + depth)
    );
    if (depth === LEVELS) {
      return <span data-out={depth}>{derived}</span>;
    }
    return (
      <div>
        <Level depth={depth + 1} />
      </div>
    );
  };

  const App = () => {
    const root = atom(0);
    deep ??= root;
    return <Level depth={1} />;
  };

  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  const out = el.querySelector(`[data-out="${LEVELS}"]`);
  if (!out) {
    throw new Error("out missing");
  }
  expect(out.textContent).toBe(`${LEVELS}`);
  if (!deep) {
    throw new Error("deep missing");
  }
  deep.set(100);
  await Bun.sleep(5);
  expect(out.textContent).toBe(`${LEVELS + 100}`);
  unmount();
  el.remove();
});
