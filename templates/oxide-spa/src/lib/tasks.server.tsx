import { Button, Checkbox } from "areia";
import { derived, ilha } from "ilha";
import { action, useRequest } from "oxidejs";
import { each } from "quando";
import { Publisher } from "tacho";

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
const changes = new Publisher<{ change: Task[] }>();

const snapshot = () => tasks.map((task) => ({ ...task }));
const notify = () => changes.publish("change", snapshot());

export const getTasks = action(async function* () {
  const signal = useRequest().signal;

  try {
    yield snapshot();
    for await (const tasks of changes.subscribe("change", { signal })) yield tasks;
  } catch (error) {
    if ((error as { name?: string }).name !== "AbortError") throw error;
  }
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

// Server-owned island: streams live task state over SSE and exposes its
// mutations as actions. The component never ships to the browser — the
// client hydrates a proxy that replays actions over RPC and morphs streamed
// HTML frames into place. The scanner wires transports by slot order: the
// first streaming derived generator becomes `d0`, and each action() slot
// becomes `a0`, `a1`, ... in declaration order.
export const TaskList = ilha(() => {
  const items = derived(async function* () {
    yield* getTasks();
  });
  return (
    <ul class="flex flex-col gap-2">
      {each(items() ?? [])
        .as((task) => (
          <li key={task.id} class="flex items-center justify-between gap-2">
            <Checkbox
              checked={task.completed}
              label={task.text}
              onCheckedChange={() => toggleTask(task.id)}
            />
            <Button
              type="button"
              class="text-sm text-red-500 hover:text-red-700"
              onclick={() => deleteTask(task.id)}
            >
              Delete
            </Button>
          </li>
        ))
        .else(<p class="text-sm opacity-60">No todos.</p>)}
    </ul>
  );
});
