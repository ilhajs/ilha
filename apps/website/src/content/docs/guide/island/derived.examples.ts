export const example = `import ilha from "ilha";
import { Input } from "areia";

export default ilha
  .state("price", 100)
  .state("qty", 3)
  .derived("total", ({ state }) => {
    return state.price() * state.qty();
  })
  .render(({ state, derived }) => (
    <div class="flex flex-col gap-2">
      <Input
        label="Price"
        type="number"
        bind:value={state.price}
      />
      <Input
        label="Quantity"
        type="number"
        bind:value={state.qty}
      />
      <p>Total: {derived.total()}</p>
    </div>
  ));
`;
