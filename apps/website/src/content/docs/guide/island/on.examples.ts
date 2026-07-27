export const example = `import ilha from "ilha";
import { Input, Button } from "areia";
import { toast } from "sonner";

export default ilha
  .state("email", "")
  .derived("valid", ({ state }) => {
    return state.email().includes("@");
  })
  .on(
    "form@submit",
    ({ event, state }) => {
      event.preventDefault();
      state.email("");
      toast.success("Subscribed!");
    }
  )
  .render(({ state, derived }) => (
    <form>
      <Input
        name="email"
        label="Email Address"
        bind:value={state.email}
      />
      <Button
        type="submit"
        disabled={!derived.valid()}
      >Subscribe</Button>
    </form>
  ));
`;
