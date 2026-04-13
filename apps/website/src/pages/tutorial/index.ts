import { Tutorial } from "$lib/components/tutorial";
import dedent from "dedent";

const content = dedent`
  ## Counter: State

  Ilha uses Signals to make your components reactive. Use the \`.state()\` builder method
  to define state - any property declared here will automatically trigger UI updates when it changes.
  Pass the property name and its initial value. All state properties are then available
  inside \`.render()\` via the \`state\` property.

  ### Similar concepts

  - React: useState
  - Vue: reactive()
  - Svelte: $state()
`;

const code = {
  template: dedent`
    <div data-ilha="counter"></div>
  `,
  script: dedent`
    import ilha, { html, mount } from "ilha";

    const counter = ilha
      .state("count", 0)
      .render(
        ({ state }) => html\`
          <p>Count: \${state.count()}</p>
        \`
      );

    mount({ counter });
  `,
};

export default Tutorial({ key: "index", content, code });
