export const example = `import ilha from "ilha";
import { Button } from "areia";

export default ilha
  .state("count", 1)
  .derived("doubled", ({ state }) => state.count() * 2)
  .on("[data-action=increase]@click", ({ state }) => {
    state.count(state.count() + 1);
  })
  .render(({ state, derived }) => (
    <>
      <p>Count: {state.count()}</p>
      <p>Doubled: {derived.doubled()}</p>
      <Button variant="primary" data-action="increase">
        Increase
      </Button>
    </>
  ));
`;
