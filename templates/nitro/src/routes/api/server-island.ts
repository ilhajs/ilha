import ilha, { html } from "ilha";
import { defineHandler } from "nitro";

const Counter = ilha.render(
  () =>
    html`
      <p>Hello from the server.</p>
    `,
);

export default defineHandler(() => {
  return Counter();
});
