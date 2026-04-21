import { docsLoader } from "$lib/content";
import ilha, { html } from "ilha";

console.log(docsLoader);

export default ilha.render(
  () =>
    html`
      <p>ok</p>
    `,
);
