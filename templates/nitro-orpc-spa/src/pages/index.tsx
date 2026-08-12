import { client } from "$lib/rpc";
import { loader, type InferLoader } from "@ilha/router";
import { Badge, Button, Checkbox, Input, LayerCard } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";
import { each } from "quando";

export const clientLoad = loader(async ({ head }) => {
  head({ title: "Home" });
  return {
    tasks: await client.rpc.getTasks(),
  };
});

export default ilha
  .input<InferLoader<typeof clientLoad>>()
  .state("draft", "")
  .state("tasks", ({ tasks }) => tasks ?? [])
  .derived("pending", ({ state }) => state.tasks().filter((t) => !t.completed))
  .action("addItem", (event: SubmitEvent, { state }) => {
    event.preventDefault();
    const text = state.draft().trim();
    if (!text) return;
    state.tasks([...state.tasks(), { id: crypto.randomUUID(), text, completed: false }]);
    state.draft("");
  })
  .action("deleteItem", (id: string, { state }) => {
    state.tasks(state.tasks().filter((t) => t.id !== id));
  })
  .effect(({ derived }) => {
    const pendingCount = (derived.pending() ?? []).length;
    if (pendingCount !== 0) return;
    toast.success("No tasks left!");
  })
  .render(({ state, derived, action }) => {
    return (
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
                .as((task, index) => (
                  <div key={task.id} class="flex items-center justify-between gap-2">
                    <Checkbox
                      label={task.text}
                      bind:checked={state.tasks.select((tasks) => tasks[index].completed)}
                    />
                    <Button onclick={() => action.deleteItem(task.id)}>Delete</Button>
                  </div>
                ))
                .else(<p>No todos.</p>)}
            </div>
          </LayerCard.Content>
        </LayerCard>
      </div>
    );
  });
