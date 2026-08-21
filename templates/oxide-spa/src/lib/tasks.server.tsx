import { EventEmitter, on } from "node:events";

import { useRequest, type ActionOptions } from "oxidejs";

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

export async function* getTasks(_options?: ActionOptions): AsyncGenerator<Task[]> {
  const changes = on(emitter, "change", { signal: useRequest().signal });

  try {
    yield snapshot();
    for await (const _ of changes) yield snapshot();
  } catch (error) {
    if ((error as { name?: string }).name !== "AbortError") throw error;
  }
}

export async function createTask(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  tasks.push({ id: crypto.randomUUID(), text: trimmed, completed: false });
  notify();
}

export async function toggleTask(id: string): Promise<void> {
  const task = tasks.find((task) => task.id === id);
  if (!task) return;
  task.completed = !task.completed;
  notify();
}

export async function deleteTask(id: string): Promise<void> {
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return;
  tasks.splice(index, 1);
  notify();
}
