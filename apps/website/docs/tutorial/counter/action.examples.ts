export const example = `import { ilha, state, action } from "ilha";
import { Button } from "areia";

export default ilha(() => {
  const count = state(0);

  const save = action(async (value: number) => {
    await fetch("/api/count", {
      method: "POST",
      body: JSON.stringify({ value }),
    });
    return value;
  });

  return (
    <>
      <p>Count: {count()}</p>
      <Button
        variant="primary"
        disabled={save.pending}
        onclick={async () => {
          const next = count() + 1;
          count.set(next);
          await save(next);
        }}
      >
        Increase{save.pending ? "…" : ""}
      </Button>
    </>
  );
});
`;
