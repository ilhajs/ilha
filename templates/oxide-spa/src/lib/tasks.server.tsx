import { Badge, Button, Checkbox } from "areia";
import { derived, each, ilha } from "ilha";
import { action, useRequest } from "oxidejs";
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

export const TaskCount = ilha(() => {
  const items = derived(async function* () {
    yield* getTasks();
  });
  const count = derived(() => items()?.filter((task) => !task.completed).length ?? 0);
  return <Badge>{count()}</Badge>;
});

// Server-owned island: streams live task state and replays mutations over RPC.
export const TaskList = ilha(() => {
  const items = derived(async function* () {
    yield* getTasks();
  });

  return (
    <div class="flex flex-col gap-2">
      {each(items() ?? [])
        .as((todo) => (
          <div data-key={todo.id} class="flex items-center justify-between gap-2">
            <Checkbox
              checked={todo.completed}
              label={todo.text}
              onCheckedChange={() => toggleTask(todo.id)}
            />
            <Button type="button" onclick={() => deleteTask(todo.id)}>
              Delete
            </Button>
          </div>
        ))
        .else(<p>No todos.</p>)}
    </div>
  );
});
