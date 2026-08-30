export const example = `import { ilha, state, derived } from "ilha";
import { Button } from "areia";

export default ilha(() => {
  const count = state(1);
  const doubled = derived(() => count() * 2);

  const increase = () => {
    count.update((value) => value + 1);
  };

  return (
    <>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <Button variant="primary" onclick={increase}>
        Increase
      </Button>
    </>
  );
});
`;
