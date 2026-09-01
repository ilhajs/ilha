/** @jsxImportSource ../src */
import { expect, test } from "bun:test";

import * as Atom from "effect/unstable/reactivity/Atom";

import { atom, mount } from "../src/index.ts";

let nextId = 4;

function Tasks() {
  const tasks = atom([
    { id: 1, label: "Ship the landing page", done: true },
    { id: 2, label: "Write unit tests", done: false },
    { id: 3, label: "Update README", done: false },
  ]);
  const pending = atom(Atom.map(tasks.atom, (list) => list.filter((task) => !task.done).length));

  const addItem = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const label = String(new FormData(form).get("text") ?? "").trim();
    if (!label) return;
    tasks.update((current) => [...current, { id: nextId++, label, done: false }]);
    form.reset();
  };

  return (
    <div class="card">
      <h2>
        My Tasks <span data-pending>{pending}</span>
      </h2>
      <ul>
        {tasks().map((task) => (
          <li key={task.id}>
            <label>
              <input
                type="checkbox"
                checked={task.done}
                onchange={(event: Event) => {
                  const done = (event.currentTarget as HTMLInputElement).checked;
                  tasks.update((current) =>
                    current.map((item) => (item.id === task.id ? { ...item, done } : item)),
                  );
                }}
              />
              <span>{task.label}</span>
            </label>
            <button
              type="button"
              data-delete={task.id}
              onclick={() =>
                tasks.update((current) => current.filter((item) => item.id !== task.id))
              }
            >
              {"\u2715"}
            </button>
          </li>
        ))}
      </ul>
      <form onsubmit={addItem}>
        <input name="text" />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}

test("tasks preview: toggle, delete, and add", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, Tasks);
  await Bun.sleep(10);

  expect(el.querySelector("[data-pending]")?.textContent).toBe("2");
  expect(el.querySelectorAll("li").length).toBe(3);

  const firstCheckbox = el.querySelector<HTMLInputElement>("input[type=checkbox]");
  firstCheckbox!.checked = false;
  firstCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
  await Bun.sleep(10);
  expect(el.querySelector("[data-pending]")?.textContent).toBe("3");

  el.querySelector<HTMLButtonElement>("[data-delete='3']")!.click();
  await Bun.sleep(10);
  expect(el.querySelectorAll("li").length).toBe(2);

  const input = el.querySelector<HTMLInputElement>("input[name=text]")!;
  input.value = "New task";
  el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await Bun.sleep(10);
  expect(el.querySelectorAll("li").length).toBe(3);
  expect(el.textContent).toContain("New task");

  unmount();
  el.remove();
});
