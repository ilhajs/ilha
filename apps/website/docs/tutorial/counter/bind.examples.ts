export const example = `import { ilha, state, derived, action } from "ilha";
import { Button, Input } from "areia";

export default ilha(() => {
  const count = state(0);
  const doubled = derived(() => count() * 2);

  const increase = action(() => {
    count((value) => value + 1);
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
