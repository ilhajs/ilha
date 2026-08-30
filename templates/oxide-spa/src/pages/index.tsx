import { createTask, TaskCount, TaskList } from "$lib/tasks.server";
import { loader } from "@ilha/router";
import { Button, Input, LayerCard } from "areia";
import { ilha, state } from "ilha";

export const load = loader.client(({ head }) => {
  head({ title: "Home" });
});

export default ilha(() => {
  const draft = state("");

  const addItem = async (event: SubmitEvent) => {
    event.preventDefault();
    const text = draft().trim();
    if (!text) return;
    await createTask(text);
    draft.set("");
  };

  return (
    <div class="flex flex-col gap-4">
      <LayerCard>
        <LayerCard.Title>
          <span>To Do</span>
          <TaskCount />
        </LayerCard.Title>
        <LayerCard.Content>
          <form onsubmit={addItem}>
            <div class="flex items-center gap-2">
              <Input placeholder="Add a new todo" class="w-full" bind:value={draft} />
              <Button type="submit">Add</Button>
            </div>
          </form>
          <TaskList />
        </LayerCard.Content>
      </LayerCard>
    </div>
  );
});
