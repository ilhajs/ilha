export const example = `import { ilha } from "ilha";
import { Button } from "areia";

export default ilha
  .state("count", 0)
  .action("increase", (_, { state }) => {
    state.count((count) => count + 1);
  })
  .render(({ state, action }) => (
    <>
      <p>Count: {state.count()}</p>
      <Button variant="primary" onclick={action.increase}>
        Increase
      </Button>
    </>
  ));
`;
