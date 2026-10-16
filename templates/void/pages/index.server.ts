import { defineHandler } from "void";
import type { InferProps } from "void";

export interface Todo {
  id: number;
  text: string;
}

// In-memory store for the starter. Swap in `void/db` for persistence.
const todos: Todo[] = [{ id: 1, text: "Render a page with Void and Ilha" }];

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(() => ({ todos }));

export const action = defineHandler(async (c) => {
  const { text } = await c.req.json<{ text?: string }>();
  const trimmed = text?.trim() ?? "";
  if (!trimmed) {
    return c.json({ errors: { text: "Write something first." } }, 422);
  }
  todos.push({ id: todos.length + 1, text: trimmed });
  return c.json({ ok: true });
});
