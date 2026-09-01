export const example = `import { atom } from "ilha";

export default function Counter() {
  const count = atom(0);
  return (
    <button type="button" class="btn btn-primary" onclick={() => count.update((n: number) => n + 1)}>
      Count: {count}
    </button>
  );
}
`;
