export const example = `import { ilha } from "ilha";

export default ilha
  .state("count", 0)
  .render(({ state }) => <p>Count: {state.count()}</p>);
`;
