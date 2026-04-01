import ilha, { html, mount, type } from "ilha";

const counter = ilha
  .input(type<{ count: number }>())
  .state("count", ({ count }) => count)
  .derived("doubled", ({ state }) => state.count() * 2)
  .on("[data-action=increase]@click", ({ state }) => state.count(state.count() + 1))
  .render(
    ({ state, derived }) => html`
      <p>Count: ${state.count()}</p>
      <p>Doubled: ${derived.doubled.value}</p>
      <button data-action="increase" class="btn">Increase</button>
    `,
  );

const app = ilha.slot("counter", counter).render(
  ({ slots }) => html`
    <div>${slots.counter({ count: 0 })}</div>
  `,
);

mount({ app });
