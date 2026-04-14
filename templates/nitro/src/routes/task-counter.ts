import ilha, { html, type } from "ilha";
import { defineHandler } from "nitro";

const counter = ilha.input(type<{ count: string }>()).render(
  ({ input }) =>
    html`
      <p>There are ${input.count} tasks</p>
    `,
);

export default defineHandler(async (event) => {
  const url = new URL(event.req.url);
  return counter({ count: url.searchParams.get("count") ?? "" });
});
