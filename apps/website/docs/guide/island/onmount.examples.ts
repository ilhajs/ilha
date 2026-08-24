export const example = `import { ilha } from "ilha";

export default ilha
  .onMount(({ host }) => {
    const box = host.querySelector("#box");
    if (!box) return;
    box.classList.add("bg-green-200");
  })
  .render(() => (
    <div
      id="box"
      class="rounded-lg p-4 text-green-800"
    >Hello there</div>
  ));
`;
