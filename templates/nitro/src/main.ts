import ilha, { html, mount, raw } from "ilha";

import "./style.css";

const app = ilha
  .state("name", "Alice")
  .derived("greeting", async ({ state, signal }) => {
    const req = await fetch(`/islands/hello?name=${state.name()}`, { signal });
    return req.text();
  })
  .bind("#name", "name")
  .render(
    ({ derived }) => html`
      <input id="name" type="text" />
      ${raw(derived.greeting.value ?? "")}
    `,
  );

mount({ app });
