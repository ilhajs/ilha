import { createTask, deleteTask, getTasks, toggleTask, type Task } from "$lib/tasks.server";
import { loader } from "@ilha/router";
import { Badge, Button, Checkbox, Input, LayerCard } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";
import { each } from "quando";

export const clientLoad = loader(({ head }) => {
  head({ title: "Home" });
});

export default ilha
  .state("draft", "")
  .state("tasks", [] as Task[])
  .state("previousPending", 0)
  .derived("pending", ({ state }) => state.tasks().filter((task) => !task.completed))
  .action("addItem", async (event: SubmitEvent, { state }) => {
    event.preventDefault();
    const text = state.draft().trim();
    if (!text) return;
    await createTask(text);
    state.draft("");
  })
  .action("toggleItem", (id: string) => toggleTask(id))
  .action("deleteItem", (id: string) => deleteTask(id))
  .onMount(({ state, signal }) => {
    void (async () => {
      const stream = await getTasks({ signal });
      for await (const tasks of stream) state.tasks(tasks);
    })().catch((error) => {
      if ((error as { name?: string }).name !== "AbortError") toast.error("Task updates stopped");
    });
  })
  .effect(({ state, derived }) => {
    const pendingCount = (derived.pending() ?? []).length;
    const previousPending = state.previousPending();
    state.previousPending(pendingCount);
    if (previousPending === 0 || pendingCount !== 0) return;
    toast.success("No tasks left!");
  })
  .render(({ state, derived, action }) => (
    <div class="flex flex-col gap-4">
      <LayerCard>
        <LayerCard.Title>
          <span>To Do</span>
          <Badge>{derived.pending()?.length}</Badge>
        </LayerCard.Title>
        <LayerCard.Content>
          <form onsubmit={action.addItem}>
            <div class="flex items-center gap-2">
              <Input placeholder="Add a new todo" class="w-full" bind:value={state.draft} />
              <Button type="submit">Add</Button>
            </div>
          </form>
          <div class="flex flex-col gap-2">
            {each(state.tasks())
              .as((task) => (
                <div key={task.id} class="flex items-center justify-between gap-2">
                  <Checkbox
                    label={task.text}
                    checked={task.completed}
                    onchange={() => action.toggleItem(task.id)}
                  />
                  <Button onclick={() => action.deleteItem(task.id)}>Delete</Button>
                </div>
              ))
              .else(<p>No todos.</p>)}
          </div>
        </LayerCard.Content>
      </LayerCard>
    </div>
  ));
