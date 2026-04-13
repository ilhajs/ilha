import { Tutorial } from "$lib/components/tutorial";
import dedent from "dedent";

const content = dedent`
  ## Counter: On

  Use the \`.on()\` method to attach event listeners to elements inside your component.
  It takes a selector and an event name joined by \`@\`, and a callback that receives
  the component context — giving you direct access to \`state\` and more.

  \`\`\`
  .on("[selector]@eventName", callback)
  \`\`\`

  The selector works like \`document.querySelector\` scoped to your component's rendered
  output. This means you can target any attribute, class, or element — \`[data-action=increase]\`,
  \`.btn-submit\`, \`input\` — without worrying about conflicts with the rest of the page.

  Inside the callback, updating state is as simple as calling the state property as a
  function with a new value. Ilha will re-render only what changed — so clicking the
  button below updates the count without touching anything else in the DOM.

  ### Similar concepts

  - React: onClick and other event props
  - Vue: v-on / @click
  - Svelte: onclick, onchange...
`;

const code = {
  template: dedent`
    <div data-ilha="counter"></div>
  `,
  script: dedent`
    import ilha, { html, mount } from "ilha";


    const counter = ilha
      .state("count", 0)
      .on("[data-action=increase]@click", ({ state }) => {
        state.count(state.count() + 1)
      })
      .render(
        ({ state }) => html\`
          <p>Count: \${state.count()}</p>
          <button data-action="increase">increase</button>
        \`
      );


    mount({ counter });
  `,
};

export default Tutorial({ key: "counter-on", content, code });
