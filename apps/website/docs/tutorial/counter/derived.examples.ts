export const example = `import { ilha } from "ilha";
import { Button } from "areia";

export default ilha
  .state("count", 1)
  .derived("doubled", ({ state }) => state.count() * 2)
  .action("increase", (_, { state }) => {
    state.count((count) => count + 1);
  })
  .render(({ state, derived, action }) => (
    <>
      <p>Count: {state.count()}</p>
      <p>Doubled: {derived.doubled()}</p>
      <Button variant="primary" onclick={action.increase}>
        Increase
      </Button>
    </>
  ));
`;
