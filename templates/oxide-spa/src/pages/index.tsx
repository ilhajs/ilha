import { createTask, TaskCount, TaskList } from "$lib/tasks.server";
import { head } from "@ilha/router";

export default function Home() {
  head({ title: "Home" });

  const addItem = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const text = String(new FormData(form).get("text") ?? "").trim();
    if (!text) return;
    void createTask(text);
    form.reset();
  };

  return (
    <div class="card bg-base-100 shadow">
      <div class="card-body gap-4">
        <h2 class="card-title">
          To Do
          <TaskCount />
        </h2>
        <form onsubmit={addItem} class="flex items-center gap-2">
          <input name="text" class="input input-bordered w-full" placeholder="Add a new todo" />
          <button type="submit" class="btn btn-primary">
            Add
          </button>
        </form>
        <TaskList />
      </div>
    </div>
  );
}
