import { Tutorial } from "$lib/components/tutorial";
import dedent from "dedent";

const content = dedent`
  ## Counter: Bind

  Use the \`.bind()\` method to create a two-way connection between a state property
  and a form element. When the state changes, the input updates. When the user types,
  the state updates — no event listener boilerplate required.

  \`\`\`
  .bind("selector", "propertyName")
  \`\`\`

  The selector targets an element in your rendered output, just like \`.on()\` — scoped
  to your component so there are no conflicts with the rest of the page. The second
  argument is the name of the state property to sync with.

  \`.bind()\` works with any standard form element — \`input\`, \`select\`, \`textarea\`.
  Ilha infers the correct value property automatically: \`value\` for text and number
  inputs, \`checked\` for checkboxes.

  Because binding is just another builder method, it composes naturally with \`.on()\`,
  \`.derived()\`, and \`.render()\`. In the example above, the input and the button both
  control the same \`count\` state — either can update it, and both stay in sync.

  ### Similar concepts

  - React: controlled inputs with onChange + value
  - Vue: v-model
  - Svelte: bind:value
`;

const code = {
  template: dedent`
    <div data-ilha="counter"></div>
  `,
  script: dedent`
    import ilha, { html, mount } from "ilha";

    const counter = ilha
      .state("count", 0)
      .derived("doubled", ({ state }) => state.count() * 2)
      .on("[data-action=increase]@click", ({ state }) => {
        state.count(state.count() + 1)
      })
      .bind("#count", 'count')
      .render(
        ({ state, derived }) => html\`
          <p>Count: \${state.count()}</p>
          <p>Doubled: \${derived.doubled.value}</p>
          <label for="count">Current count</label>
          <input id="count" type="number" />
          <button data-action="increase">Increase</button>
        \`
      );

    mount({ counter });
  `,
};

export default Tutorial({ name: "Counter: Bind", content, code });
