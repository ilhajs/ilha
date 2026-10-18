import { Form, useForm } from "@ilha/void";

import type { Props } from "./index.server.ts";

export default function Todos({ todos }: Props) {
  const form = useForm("/", { text: "" });
  return (
    <section>
      <h1>Todos</h1>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
      <Form form={form}>
        <input
          name="text"
          aria-label="New todo"
          value={form.data.text}
          oninput={(event) => form.setData("text", event.currentTarget.value)}
        />
        <button type="submit" disabled={form.pending}>
          Add
        </button>
      </Form>
      {form.errors.text ? <p class="error">{form.errors.text}</p> : null}
    </section>
  );
}
