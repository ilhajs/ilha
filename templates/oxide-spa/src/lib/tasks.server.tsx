import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { action } from "oxidejs";

export type Task = {
  id: string;
  text: string;
  completed: boolean;
};

const tasks: Task[] = [
  { id: "1", text: "Start Ilha Dev Server", completed: true },
  { id: "2", text: "Develop my Ilha app", completed: false },
  { id: "3", text: "Deploy my Ilha app", completed: false },
];

const hub = Effect.runSync(PubSub.unbounded<Task[]>({ replay: 1 }));
const snapshot = () => tasks.map((task) => ({ ...task }));
const notify = () => Effect.runSync(PubSub.publish(hub, snapshot()));
notify();

export const getTasks = action(async function* () {
  yield* Stream.toAsyncIterable(Stream.fromPubSub(hub));
});

export const createTask = action(async (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return;
  tasks.push({ id: crypto.randomUUID(), text: trimmed, completed: false });
  notify();
});

export const toggleTask = action(async (id: string) => {
  const task = tasks.find((task) => task.id === id);
  if (!task) return;
  task.completed = !task.completed;
  notify();
});

export const deleteTask = action(async (id: string) => {
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return;
  tasks.splice(index, 1);
  notify();
});

function renderList(list: Task[]) {
  return (
    <div class="flex flex-col gap-2">
      {list.map((todo) => (
        <div key={todo.id} class="flex items-center justify-between gap-2">
          <label class="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              class="checkbox"
              checked={todo.completed}
              onchange={() => toggleTask(todo.id)}
            />
            <span>{todo.text}</span>
          </label>
          <button type="button" class="btn btn-sm btn-ghost" onclick={() => deleteTask(todo.id)}>
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}

export const TaskCount = async function TaskCount() {
  return Stream.map(
    Stream.fromAsyncIterable(getTasks(), (error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    ),
    (list: Task[]) => (
      <span class="badge badge-primary">{list.filter((task) => !task.completed).length}</span>
    ),
  );
};

export const TaskList = async function TaskList() {
  return Stream.map(
    Stream.fromAsyncIterable(getTasks(), (error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    ),
    renderList,
  );
};
