import { Badge, Button, Checkbox, Input, LayerCard } from "areia";
import ilha, { raw } from "ilha";
import { each } from "quando";

type Todo = { id: string; text: string; completed: boolean };

const DEFAULT_TODOS: Todo[] = [
  { id: "1", text: "Start Ilha Dev Server", completed: true },
  { id: "2", text: "Develop my Ilha app", completed: false },
  { id: "3", text: "Deploy my Ilha app", completed: false },
];

const addTodo = (todos: Todo[], text: string): Todo[] => [
  ...todos,
  { id: crypto.randomUUID(), text, completed: false },
];

const deleteTodo = (todos: Todo[], index: number): Todo[] =>
  index < 0 ? todos : todos.filter((_, i) => i !== index);

const getIndex = (target: Element) => {
  const el = target.closest("[data-index]") ?? target;
  const index = Number.parseInt(el.getAttribute("data-index") ?? "", 10);
  return Number.isNaN(index) ? -1 : index;
};

export default ilha
  .state("todos", DEFAULT_TODOS)
  .state("serverIslandHtml", "")
  .derived("pending", ({ state }) => state.todos().filter((t) => !t.completed))
  .on("#todo-form@submit", ({ event, target, state }) => {
    event.preventDefault();
    const form = target as HTMLFormElement;
    const text = new FormData(form).get("todo")!.toString().trim();
    if (!text) return;
    state.todos(addTodo(state.todos(), text));
    form.reset();
  })
  .on("[data-action=delete_todo]@click", ({ state, target }) => {
    state.todos(deleteTodo(state.todos(), getIndex(target)));
  })
  .on("[data-action=fetch_component]@click", async ({ state }) => {
    const res = await fetch("/api/server-island");
    state.serverIslandHtml(await res.text());
  })
  .render(({ state, derived }) => (
    <div class="flex flex-col gap-4">
      <LayerCard>
        <LayerCard.Title>
          <span>To Do</span>
          <Badge>{derived.pending.value?.length}</Badge>
        </LayerCard.Title>
        <LayerCard.Content>
          <form id="todo-form">
            <div class="flex items-center gap-2">
              <Input name="todo" type="text" placeholder="Add a new todo" class="w-full" />
              <Button type="submit">Add</Button>
            </div>
          </form>
          <div class="flex flex-col gap-2">
            {each(state.todos())
              .as((todo, index) => (
                <div key={todo.id} class="flex items-center justify-between gap-2">
                  <Checkbox
                    label={todo.text}
                    bind:checked={state.todos.select((t) => t[index].completed)}
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
      <div class="x-stack">
        {state.serverIslandHtml() ? (
          <div>{raw(state.serverIslandHtml())}</div>
        ) : (
          <Button data-action="fetch_component" data-variant="secondary">
            Fetch Server Side Component
          </Button>
        )}
      </div>
    </div>
  ));
