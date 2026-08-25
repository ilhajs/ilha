export const example = `import { ilha, state } from "ilha";

export default ilha(() => {
  const count = state(0);
  return <p>Count: {count()}</p>;
});
`;
