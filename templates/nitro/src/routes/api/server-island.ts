import ilha, { html } from "ilha";
import { defineHandler } from "nitro";

const counter = ilha.render(
  () =>
    html`
      <p>Hello from the server.</p>
    `,
);

export default defineHandler(() => {
  return counter();
});
