export const example = `import ilha from "ilha";
import { Button } from "areia";

export default ilha
  .state("count", 0)
  .on("[data-action=increase]@click", ({ state }) => {
    state.count(state.count() + 1);
  })
  .render(({ state }) => (
    <>
      <p>Count: {state.count()}</p>
      <Button variant="primary" data-action="increase">
        Increase
      </Button>
    </>
  ));
`;
