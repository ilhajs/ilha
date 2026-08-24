export const example = `import { ilha } from "ilha";
import { Button } from "areia";

export default ilha
  .state("count", 0)
  .action("increment", (_, { state }) =>
    state.count((count) => count + 1))
  .render(({ state, action }) => (
    <div class="flex flex-col gap-2">
      <p>Count: {state.count()}</p>
      <Button onclick={action.increment}>Increment</Button>
    </div>
  ));
`;
