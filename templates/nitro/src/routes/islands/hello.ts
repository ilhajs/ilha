import ilha, { html, type } from "ilha";
import { defineHandler } from "nitro";

const greet = ilha.input(type<{ name: string }>()).render(
  ({ input }) =>
    html`
      <p>Hello, ${input.name}</p>
    `,
);

export default defineHandler(async (event) => {
  const url = new URL(event.req.url);
  return greet({ name: url.searchParams.get("name") ?? "" });
});
