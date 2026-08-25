import { loader, type InferLoader } from "@ilha/router";
import { Badge, Button, Checkbox, Input, LayerCard } from "areia";
import { action, derived, effect, ilha, state } from "ilha";
import { each } from "quando";

type Todo = { id: string; text: string; completed: boolean };

const DEFAULT_TODOS: Todo[] = [
  { id: "1", text: "Start Ilha Dev Server", completed: true },
  { id: "2", text: "Develop my Ilha app", completed: false },
  { id: "3", text: "Deploy my Ilha app", completed: false },
];

export const load = loader.client(({ head }) => {
  // TIP: Fetch external resources here and pass them to the page via input.
  head({ title: "Home" });
  return {
    todos: DEFAULT_TODOS,
  };
});

export default ilha(({ todos }: InferLoader<typeof load>) => {
  const items = state([] as Todo[]);
  const draft = state("");
  const pending = derived(() => items().filter((t) => !t.completed));

  // Seed from the loader once per mounted instance.
  effect.once(() => {
    items(todos?.load.value.todos ?? []);
  });

  const addItem = action((event: SubmitEvent) => {
    event.preventDefault();
    const text = draft().trim();
    if (!text) return;
    items((current) => [...current, { id: crypto.randomUUID(), text, completed: false }]);
    draft("");
  });
  const deleteItem = action((index: number) => {
    items((current) => current.filter((_, i) => i !== index));
  });

  return (
    <div class="flex flex-col gap-4">
      <LayerCard>
        <LayerCard.Title>
          <span>To Do</span>
          <Badge>{pending().length}</Badge>
        </LayerCard.Title>
        <LayerCard.Content>
          <form onsubmit={addItem}>
            <div class="flex items-center gap-2">
              <Input placeholder="Add a new todo" class="w-full" bind:value={draft} />
              <Button type="submit">Add</Button>
            </div>
          </form>
          <div class="flex flex-col gap-2">
            {each(items())
              .as((todo, index) => (
                <div key={todo.id} class="flex items-center justify-between gap-2">
                  <Checkbox
                    label={todo.text}
                    bind:checked={items.select((current) => current[index]?.completed ?? false)}
                  />
                  <Button onclick={() => deleteItem(index)}>Delete</Button>
                </div>
              ))
              .else(<p>No todos.</p>)}
          </div>
        </LayerCard.Content>
      </LayerCard>
    </div>
  );
});
