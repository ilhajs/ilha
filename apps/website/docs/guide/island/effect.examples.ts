export const example = `import { ilha } from "ilha";
import { Input } from "areia";
import { each } from "quando";

export default ilha
  .state("changes", [] as string[])
  .state("label", "Hello")
  .effect(({ state }) => {
    const label = state.label();
    if (!label) return;
    const head = state.changes()[0];
    if (head === label) return;
    state.changes([label, ...state.changes()]);
  })
  .render(({ state }) => (
    <div class="flex flex-col gap-2">
      <Input bind:value={state.label} />
      {each(state.changes())
        .as((change, index) => (
          <p key={index}>{change}</p>
        ))
        .else(<p>No changes yet.</p>)}
    </div>
  ));
`;
