export const example = `import { ilha } from "ilha";

export default ilha
  .input<{ name?: string }>()
  .render(({ input }) => (
    <p>Hello, {input.name ?? "World"}!</p>
  ));
`;
