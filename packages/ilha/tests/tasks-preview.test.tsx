// @jsxImportSource ../src
import { expect, test } from "bun:test";

import * as Atom from "effect/unstable/reactivity/Atom";

import { atom, mount } from "../src/index.ts";

let nextId = 4;

const mapAtom = Atom.map;

const Tasks = () => {
  const tasks = atom([
    { done: true, id: 1, label: "Ship the landing page" },
    { done: false, id: 2, label: "Write unit tests" },
    { done: false, id: 3, label: "Update README" },
  ]);
  const pending = atom(
    mapAtom(tasks.atom, (list) => list.filter((task) => !task.done).length)
  );

  const addItem = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget;
    // SAFETY: onsubmit is bound to the form element painted below.
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const label = String(new FormData(form).get("text") ?? "").trim();
    if (!label) {
      return;
    }
    const id = nextId;
    nextId += 1;
    tasks.update((current) => [...current, { done: false, id, label }]);
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
                  const target = event.currentTarget;
                  // SAFETY: onchange is bound to the checkbox input.
                  if (!(target instanceof HTMLInputElement)) {
                    return;
                  }
                  const done = target.checked;
                  tasks.update((current) =>
                    current.map((item) =>
                      item.id === task.id ? { ...item, done } : item
                    )
                  );
                }}
              />
              <span>{task.label}</span>
            </label>
            <button
              type="button"
              data-delete={task.id}
              onclick={() =>
                tasks.update((current) =>
                  current.filter((item) => item.id !== task.id)
                )
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
};

test("tasks preview: toggle, delete, and add", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, Tasks);
  await Bun.sleep(10);

  expect(el.querySelector("[data-pending]")?.textContent).toBe("2");
  expect(el.querySelectorAll("li").length).toBe(3);

  const firstCheckbox = el.querySelector("input[type=checkbox]");
  if (!(firstCheckbox instanceof HTMLInputElement)) {
    throw new Error("checkbox missing");
  }
  firstCheckbox.checked = false;
  firstCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
  await Bun.sleep(10);
  expect(el.querySelector("[data-pending]")?.textContent).toBe("3");

  const deleteBtn = el.querySelector("[data-delete='3']");
  if (!(deleteBtn instanceof HTMLButtonElement)) {
    throw new Error("delete button missing");
  }
  deleteBtn.click();
  await Bun.sleep(10);
  expect(el.querySelectorAll("li").length).toBe(2);

  const input = el.querySelector("input[name=text]");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("text input missing");
  }
  input.value = "New task";
  const form = el.querySelector("form");
  if (!form) {
    throw new Error("form missing");
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await Bun.sleep(10);
  expect(el.querySelectorAll("li").length).toBe(3);
  expect(el.textContent).toContain("New task");

  unmount();
  el.remove();
});
