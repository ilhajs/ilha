import ilha, { html, raw } from "ilha";

const DEFAULT_TODOS = [
  { text: "Start Ilha Dev Server", completed: true },
  { text: "Develop my Ilha app", completed: false },
  { text: "Deploy my Ilha app", completed: false },
];

type Todo = { text: string; completed: boolean };

const addTodo = (todos: Todo[], text: string): Todo[] => [...todos, { text, completed: false }];

const toggleTodo = (todos: Todo[], index: number): Todo[] =>
  todos.map((todo, i) => (i === index ? { ...todo, completed: !todo.completed } : todo));

const deleteTodo = (todos: Todo[], index: number): Todo[] => todos.filter((_, i) => i !== index);

const getIndex = (target: Element) => Number.parseInt(target.getAttribute("data-index")!);

const todoItem = (todo: Todo, index: number) => html`
  <div class="item x-stack">
    <input id="todo-${index}" type="checkbox" data-index="${index}" ${todo.completed ? "checked" : ""} data-todo-checkbox />
    <label for="todo-${index}" style="${todo.completed ? "flex:1;text-decoration:line-through" : "flex:1;"}">${todo.text}</label>
    <button data-action="delete" data-index="${index}" type="button" data-variant="secondary">Delete</button>
  </div>
`;

export default ilha
  .state("todos", DEFAULT_TODOS)
  .state("serverResult", "")
  .on("[data-todo-checkbox]@change", ({ state, target }) => {
    state.todos(toggleTodo(state.todos(), getIndex(target)));
  })
  .on("[data-todo-form]@submit", ({ event, target, state }) => {
    event.preventDefault();
    const form = target as HTMLFormElement;
    const text = new FormData(form).get("todo")!.toString();
    state.todos(addTodo(state.todos(), text));
    form.reset();
  })
  .on("[data-action=delete]@click", ({ state, target }) => {
    state.todos(deleteTodo(state.todos(), getIndex(target)));
  })
  .on("[data-action=fetch_component]@click", async ({ state }) => {
    const req = await fetch("/task-counter?count=" + state.todos().length);
    const html = await req.text();
    state.serverResult(html);
  })
  .render(
    ({ state }) =>
      html`
        <div class="y-stack">
            <div class="card">
            <header>
                <h2>To Do</h2>
            </header>
            <section class="y-stack">
                <form data-todo-form>
                <div class="x-stack">
                    <input
                    name="todo"
                    type="text"
                    placeholder="Add a new todo"
                    style="flex-shrink: 1;"
                    />
                    <button type="submit">Add</button>
                </div>
                </form>
                <div class="y-stack">${state.todos().map(todoItem)}</div>
            </section>
            </div>
            <div class="x-stack">
                <button data-action="fetch_component" data-variant="secondary">Fetch Server Side Component</button>
                ${raw(state.serverResult())}
            </div>
        </div>
      `,
  );
