export const example = `import { atom } from "ilha";

export default function Counter() {
  const count = atom(0);

  return (
    <div class="flex flex-col gap-2">
      <p>Count: {count}</p>
      <button type="button" class="btn btn-primary" onclick={() => count.update((n) => n + 1)}>
        Increment
      </button>
    </div>
  );
}
`;
