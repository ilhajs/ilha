import { EventEmitter, on } from "node:events";

// Island-render scope (page SSR + frames). Oxide's useRequest only exists
// inside /_action execution, so the stream keeps an aliased import for its
// live-subscription signal.
import { useContext } from "@ilha/router";
import { Button, Checkbox, Input } from "areia";
import ilha from "ilha";
import { action, useRequest as useActionRequest, type ActionOptions } from "oxidejs";
import { each } from "quando";

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
const emitter = new EventEmitter();

const snapshot = () => tasks.map((task) => ({ ...task }));
const notify = () => emitter.emit("change");

export const getTasks = action(async function* (_options?: ActionOptions): AsyncGenerator<Task[]> {
  // Live change subscription needs a request scope (SSE over /_action).
  // Island SSR and frame re-renders have none — they pull snapshots only.
  let changes: AsyncIterableIterator<unknown> | undefined;
  try {
    changes = on(emitter, "change", { signal: useActionRequest().signal });
  } catch {
    changes = undefined;
  }

  try {
    yield snapshot();
    if (!changes) return;
    for await (const _ of changes) yield snapshot();
  } catch (error) {
    if ((error as { name?: string }).name !== "AbortError") throw error;
  }
});

export const createTask = action(async (text: string): Promise<void> => {
  const trimmed = text.trim();
  if (!trimmed) return;
  tasks.push({ id: crypto.randomUUID(), text: trimmed, completed: false });
  notify();
});

export const toggleTask = action(async (id: string): Promise<void> => {
  const task = tasks.find((task) => task.id === id);
  if (!task) return;
  task.completed = !task.completed;
  notify();
});

export const deleteTask = action(async (id: string): Promise<void> => {
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return;
  tasks.splice(index, 1);
  notify();
});

// Server-owned island: streams live task state over SSE and exposes its
// mutations as actions. The render function never ships to the browser —
// the client hydrates a proxy that replays actions over RPC and morphs
// streamed HTML frames into place.
export const TaskList = ilha
  .stream("items", ({ signal }) => getTasks({ signal }))
  .action("toggle", (id: string) => toggleTask(id))
  .action("remove", (id: string) => deleteTask(id))
  .render(({ state, action }) => (
    <ul class="flex flex-col gap-2">
      {each(state.items() ?? [])
        .as((task) => (
          <li key={task.id} class="flex items-center justify-between gap-2">
            <Checkbox
              checked={task.completed}
              label={task.text}
              onCheckedChange={() => action.toggle(task.id)}
            />
            <Button
              type="button"
              class="text-sm text-red-500 hover:text-red-700"
              onclick={() => action.remove(task.id)}
            >
              Delete
            </Button>
          </li>
        ))
        .else(<p class="text-sm opacity-60">No todos.</p>)}
    </ul>
  ));
