export const example = `import { ilha, state, derived, effect } from "ilha";
import { Button, Input } from "areia";

export default ilha(() => {
  const count = state(0);
  const doubled = derived(() => count() * 2);

  const increase = () => {
    count.update((value) => value + 1);
  };

  effect(() => {
    if (count() > 3) count.set(0);
  });

  return (
    <>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <Input
        id="count"
        type="number"
        label="Current count"
        bind:value={count}
      />
      <Button variant="primary" onclick={increase}>
        Increase
      </Button>
    </>
  );
});
`;
