export const example = `import { ilha, state } from "ilha";
import { Button } from "areia";

export default ilha(() => {
  const count = state(0);

  const increment = () =>
    count.update((value) => value + 1);

  return (
    <div class="flex flex-col gap-2">
      <p>Count: {count()}</p>
      <Button onclick={increment}>Increment</Button>
    </div>
  );
});
`;
