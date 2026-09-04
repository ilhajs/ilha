import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { action } from "oxidejs";

export interface Task {
  id: string;
  text: string;
  completed: boolean;
}

const tasks: Task[] = [
  { completed: true, id: "1", text: "Start Ilha Dev Server" },
  { completed: false, id: "2", text: "Develop my Ilha app" },
  { completed: false, id: "3", text: "Deploy my Ilha app" },
];

const hub = Effect.runSync(PubSub.unbounded<Task[]>({ replay: 1 }));
const snapshot = () => tasks.map((task) => ({ ...task }));
const notify = () => Effect.runSync(PubSub.publish(hub, snapshot()));
notify();

// SAFETY: async-iterable rejection values have no schema; normalize to Error.
const asStreamError = <T,>(error: T): Error =>
  error instanceof Error ? error : new Error(String(error));

export const getTasks = action(async function* getTasks() {
  yield* Stream.toAsyncIterable(Stream.fromPubSub(hub));
});

export const createTask = action((text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  tasks.push({ completed: false, id: crypto.randomUUID(), text: trimmed });
  notify();
});

export const toggleTask = action((id: string) => {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) {
    return;
  }
  task.completed = !task.completed;
  notify();
});

export const deleteTask = action((id: string) => {
  const index = tasks.findIndex((candidate) => candidate.id === id);
  if (index === -1) {
    return;
  }
  tasks.splice(index, 1);
  notify();
});

const renderList = (list: Task[]) => (
  <div class="flex flex-col gap-2">
    {list.map((todo) => (
      <div key={todo.id} class="flex items-center justify-between gap-2">
        <label class="label cursor-pointer justify-start gap-2">
          <input
            type="checkbox"
            class="checkbox"
            checked={todo.completed}
            onchange={toggleTask.with(todo.id)}
          />
          <span>{todo.text}</span>
        </label>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onclick={deleteTask.with(todo.id)}
        >
          Delete
        </button>
      </div>
    ))}
  </div>
);

export const TaskCount = function TaskCount() {
  // Keep fromAsyncIterable(getTasks()) in the island body so the server-island
  // scanner can wire the stream transport.
  return Stream.map(
    Stream.fromAsyncIterable(getTasks(), asStreamError),
    (list: Task[]) => (
      <span class="badge badge-primary">
        {list.filter((task) => !task.completed).length}
      </span>
    )
  );
};

export const TaskList = function TaskList() {
  return Stream.map(
    Stream.fromAsyncIterable(getTasks(), asStreamError),
    renderList
  );
};
