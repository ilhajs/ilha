import { head } from "@ilha/router";
import * as Atom from "effect/unstable/reactivity/Atom";
import { atom, batch } from "ilha";

type Todo = { id: string; text: string; completed: boolean };

const DEFAULT_TODOS: Todo[] = [
  { id: "1", text: "Start Ilha Dev Server", completed: true },
  { id: "2", text: "Develop my Ilha app", completed: false },
  { id: "3", text: "Deploy my Ilha app", completed: false },
];

export default function Home() {
  head({ title: "Home" });
  const items = atom(DEFAULT_TODOS);
  const pending = atom(
    Atom.map(items.atom, (list) => list.filter((todo) => !todo.completed).length),
  );

  const addItem = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const text = String(new FormData(form).get("text") ?? "").trim();
    if (!text) return;
    items.update((list) => [...list, { id: crypto.randomUUID(), text, completed: false }]);
    form.reset();
  };

  return (
    <div class="card bg-base-100 shadow">
      <div class="card-body gap-4">
        <h2 class="card-title">
          To Do
          <span class="badge badge-primary">{pending}</span>
        </h2>
        <form onsubmit={addItem} class="flex items-center gap-2">
          <input name="text" class="input input-bordered w-full" placeholder="Add a new todo" />
          <button type="submit" class="btn btn-primary">
            Add
          </button>
        </form>
        <div class="flex flex-col gap-2">
          {items().map((todo) => (
            <div key={todo.id} class="flex items-center justify-between gap-2">
              <label class="label cursor-pointer justify-start gap-2">
                <input
                  type="checkbox"
                  class="checkbox"
                  checked={todo.completed}
                  onchange={(event: Event) => {
                    const checked = (event.currentTarget as HTMLInputElement).checked;
                    batch(() =>
                      items.update((current) =>
                        current.map((item) =>
                          item.id === todo.id ? { ...item, completed: checked } : item,
                        ),
                      ),
                    );
                  }}
                />
                <span>{todo.text}</span>
              </label>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                onclick={() =>
                  batch(() =>
                    items.update((current) => current.filter((item) => item.id !== todo.id)),
                  )
                }
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
