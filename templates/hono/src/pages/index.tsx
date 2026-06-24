import { head } from "@ilha/router";
import { store } from "@ilha/store";
import { preventDefault } from "@ilha/store/form";
import { Badge, Button, Checkbox, Input, LayerCard } from "areia";
import ilha from "ilha";
import { each } from "quando";

const DEFAULT_TODOS: Todo[] = [
  { id: "1", text: "Start Ilha Dev Server", completed: true },
  { id: "2", text: "Develop my Ilha app", completed: false },
  { id: "3", text: "Deploy my Ilha app", completed: false },
];

type Todo = { id: string; text: string; completed: boolean };

const todos = store({ draft: "", items: [] as Todo[] })
  .derived("pending", ({ get }) => (get().items ?? []).filter((t) => !t.completed))
  .action("addItem", (_, { get }) => {
    const text = get().draft.trim();
    if (!text) return;
    const item = { id: crypto.randomUUID(), text, completed: false };
    return { items: [...get().items, item], draft: "" };
  })
  .action("deleteItem", (index: number, { get }) => {
    return { items: get().items.filter((_, i) => i !== index) };
  })
  .action("toggleItem", (index: number, { get }) => {
    return {
      items: get().items.map((item, i) =>
        i === index ? { ...item, completed: !item.completed } : item,
      ),
    };
  })
  .build();

const getIndex = (target: Element) => {
  const el = target.closest("[data-index]") ?? target;
  const index = Number.parseInt(el.getAttribute("data-index") ?? "", 10);
  return Number.isNaN(index) ? -1 : index;
};

export default ilha
  .on("#todo-form@submit", preventDefault(todos.addItem))
  .on("[data-action=delete_todo]@click", ({ target }) => todos.deleteItem(getIndex(target)))
  .onMount(() => {
    todos.items(DEFAULT_TODOS);
  })
  .render(() => {
    head({ title: "Home" });
    return (
      <div class="flex flex-col gap-4">
        <LayerCard>
          <LayerCard.Title>
            <span>To Do</span>
            <Badge>{todos.pending()?.length}</Badge>
          </LayerCard.Title>
          <LayerCard.Content>
            <form id="todo-form">
              <div class="flex items-center gap-2">
                <Input placeholder="Add a new todo" class="w-full" bind:value={todos.draft} />
                <Button type="submit">Add</Button>
              </div>
            </form>
            <div class="flex flex-col gap-2">
              {each(todos.items())
                .as((todo, index) => (
                  <div key={todo.id} class="flex items-center justify-between gap-2">
                    <Checkbox
                      label={todo.text}
                      bind:checked={todos.bind((s) => s.items[index]?.completed ?? false)}
                    />
                    <Button data-action="delete_todo" data-index={index}>
                      Delete
                    </Button>
                  </div>
                ))
                .else(<p>No todos.</p>)}
            </div>
          </LayerCard.Content>
        </LayerCard>
      </div>
    );
  });
