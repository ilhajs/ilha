import ilha, { html } from "ilha";

export default ilha
  .state("name", "World")
  .bind("#name", "name")
  .render(
    ({ state }) => html`
      <section>
        <h1>Home</h1>
        <input id="name" type="text" />
        <p>Hello ${state.name()}!</p>
      </section>
    `,
  );
