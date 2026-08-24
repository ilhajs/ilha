export const example = `import { ilha } from "ilha";
import { Button } from "areia";
import { toast } from "sonner";

export default ilha
  .state("count", 0)
  .on("button@click", ({ state }) => {
    if (state.count() > 1)
      throw new Error("too many clicks");
    state.count((count) => count + 1);
  })
  .onError(({ error }) => {
    toast.error(error.message);
  })
  .render(({ state }) => (
    <div class="flex flex-col gap-2">
      <p>Count: {state.count()}</p>
      <Button>Increase</Button>
      <p class="text-sm text-areia-muted">Click the button more than twice to see the error handler in action.</p>
    </div>
  ));
`;
