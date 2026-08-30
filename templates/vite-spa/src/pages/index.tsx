import { Badge, Button, Checkbox, Input, LayerCard } from "areia";
import { derived, each, ilha, state } from "ilha";

type Todo = { id: string; text: string; completed: boolean };

// A static app needs no loaders — plain client state is enough.
const DEFAULT_TODOS: Todo[] = [
  { id: "1", text: "Start Ilha Dev Server", completed: true },
  { id: "2", text: "Develop my Ilha app", completed: false },
  { id: "3", text: "Deploy my Ilha app", completed: false },
];

export default ilha(() => {
  const items = state(DEFAULT_TODOS);
  const draft = state("");
  const pending = derived(() => items().filter((t) => !t.completed));

  const addItem = (event: SubmitEvent) => {
    event.preventDefault();
    const text = draft().trim();
    if (!text) return;
    items.update((current) => [...current, { id: crypto.randomUUID(), text, completed: false }]);
    draft.set("");
  };
  const deleteItem = (index: number) => {
    items.update((current) => current.filter((_, i) => i !== index));
  };

  return (
    <div class="flex flex-col gap-4">
      <LayerCard>
        <LayerCard.Title>
          <span>To Do</span>
          <Badge>{pending()?.length ?? 0}</Badge>
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
