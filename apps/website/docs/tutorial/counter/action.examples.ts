export const example = `import { ilha, state, action } from "ilha";
import { Button } from "areia";

export default ilha(() => {
  const count = state(0);

  const increase = action(() => {
    count((value) => value + 1);
  });

  return (
    <>
      <p>Count: {count()}</p>
      <Button variant="primary" onclick={increase}>
        Increase
      </Button>
    </>
  );
});
`;
