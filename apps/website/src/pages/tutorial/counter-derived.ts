import { Tutorial } from "$lib/components/tutorial";
import dedent from "dedent";

const content = dedent`
  ## Counter: Derived

  Now that you can mutate state with \`.on()\`, derived properties let you compute
  values from that state automatically — recalculating only when their dependencies
  change. Use \`.derived()\` to keep complex logic out of your templates and make
  components easier to reason about.

  \`\`\`
  .derived("name", ({ state }) => /* computed value */)
  \`\`\`

  The callback receives the component context, just like \`.on()\`. The result is
  available in \`.render()\` via \`derived.name.value\`. Unlike state, you never
  write to a derived property directly — it always reflects the latest computed result.

  \`.derived()\` also accepts an async function, making it suitable for data fetching.
  The result exposes \`value\`, \`loading\`, and \`error\` — so you get built-in async
  state without reaching for SWR or TanStack Query.

  ### Similar concepts

  - React: useMemo
  - Vue: computed()
  - Svelte: $derived()
`;

const code = {
  template: dedent`
    <div data-ilha="counter"></div>
  `,
  script: dedent`
    import ilha, { html, mount } from "ilha";


    const counter = ilha
      .state("count", 1)
      .derived("doubled", ({ state }) => state.count() * 2)
      .on("[data-action=increase]@click", ({ state }) => {
        state.count(state.count() + 1)
      })
      .render(
        ({ state, derived }) => html\`
          <p>Count: \${state.count()}</p>
          <p>Doubled: \${derived.doubled.value}</p>
          <button data-action="increase">increase</button>
        \`
      );


    mount({ counter });
  `,
};

export default Tutorial({ key: "counter-derived", content, code });
