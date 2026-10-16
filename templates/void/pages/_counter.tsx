import { atom } from "ilha";

export default function Counter({ start = 0 }: { start?: number }) {
  const count = atom(start);
  return (
    <button type="button" onclick={() => count.update((n) => n + 1)}>
      Clicked {count} times
    </button>
  );
}
