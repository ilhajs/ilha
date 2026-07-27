export const example = `import ilha from "ilha";
import { Button, Input, Label } from "areia";

export default ilha
  .state("count", 0)
  .derived("doubled", ({ state }) => state.count() * 2)
  .on("[data-action=increase]@click", ({ state }) => {
    state.count(state.count() + 1);
  })
  .effect(({ state }) => {
    if (state.count() > 3) {
      state.count(0);
    }
  })
  .render(({ state, derived }) => (
    <>
      <p>Count: {state.count()}</p>
      <p>Doubled: {derived.doubled()}</p>
      <Input
        id="count"
        type="number"
        label="Current count"
        bind:value={state.count}
      />
      <Button variant="primary" data-action="increase">
        Increase
      </Button>
    </>
  ));
`;
