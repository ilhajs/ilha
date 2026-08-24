import { createTask, TaskList } from "$lib/tasks.server";
import { loader } from "@ilha/router";
import { Button, Input, LayerCard } from "areia";
import { ilha } from "ilha";

export const clientLoad = loader(({ head }) => {
  head({ title: "Home" });
});

// The page owns local UI state (the draft input) and composes the
// server-owned <TaskList /> island, which SSRs with live data and stays
// interactive through the proxy protocol.
export default ilha
  .state("draft", "")
  .action("addItem", async (event: SubmitEvent, { state }) => {
    event.preventDefault();
    const text = state.draft().trim();
    if (!text) return;
    await createTask(text);
    state.draft("");
  })
  .render(({ state, action }) => (
    <div class="flex flex-col gap-4">
      <LayerCard>
        <LayerCard.Title>
          <span>To Do</span>
        </LayerCard.Title>
        <LayerCard.Content>
          <form onsubmit={action.addItem}>
            <div class="flex items-center gap-2">
              <Input placeholder="Add a new todo" class="w-full" bind:value={state.draft} />
              <Button type="submit">Add</Button>
            </div>
          </form>
          <TaskList />
        </LayerCard.Content>
      </LayerCard>
    </div>
  ));
