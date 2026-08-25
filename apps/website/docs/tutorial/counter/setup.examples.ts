export const example = `import { ilha, state, derived, effect } from "ilha";
import { Button, Input } from "areia";

export default ilha(() => {
  const count = state(0);
  const doubled = derived(() => count() * 2);

  const increase = () => {
    count((value) => value + 1);
  };

  effect.once(() => {
    count(2);
  });

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
