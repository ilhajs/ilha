import ilha, { html, raw } from "ilha";

export default ilha
  .state("name", "Alice")
  .derived("greeting", async ({ state, signal }) => {
    if (import.meta.env.SSR) return "";
    const req = await fetch(`/islands/hello?name=${state.name()}`, {
      signal,
    });
    return req.text();
  })
  .bind("#name", "name")
  .render(
    ({ derived }) => html`
      <section>
        <h1>Home</h1>
        <p>Welcome to Ilha.</p>
        <input id="name" type="text" />
        ${raw(derived.greeting.value ?? "")}
      </section>
    `,
  );
