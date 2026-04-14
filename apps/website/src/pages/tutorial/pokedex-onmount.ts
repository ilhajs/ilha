import { Tutorial } from "$lib/components/tutorial";
import dedent from "dedent";

const content = dedent`
  ## PokéDex: onMount

  Use \`.onMount()\` to run logic once, immediately after the component renders for
  the first time. Unlike \`.effect()\`, it does not re-run on state changes — making
  it the right place for one-time setup work.

  \`\`\`
  .onMount(({ state, derived }) => { ... })
  \`\`\`

  The callback receives the full component context, so you have direct access to
  \`state\` and \`derived\`. This makes \`.onMount()\` ideal for seeding initial data:
  fetch a resource, resolve its result, and write it into state — Ilha will
  re-render automatically once the data arrives.

  The example fetches both the Pokémon list and the selected Pokémon's data on mount.
  Because \`.onMount()\` doesn't await async functions directly, each fetch is wrapped
  in an inner async function and called immediately — a common pattern for async work
  inside synchronous callbacks.

  ### Similar concepts

  - React: useEffect with an empty dependency array
  - Vue: onMounted()
  - Svelte: onMount()

  > Pokémon and PokéDex are trademarks of Nintendo/Creatures Inc./GAME FREAK inc.
  > This tutorial uses the PokéAPI for educational purposes only and is not affiliated
  > with or endorsed by the Pokémon Company.
`;

const code = {
  template: dedent`
    <div data-ilha="pokedex"></div>
  `,
  script: dedent`
    import ilha, { html, mount } from "ilha";

    const pokedex = ilha
      .state("pokemon", "charizard")
      .state("pokemonList", [])
      .state("pokemonData", null)
      .onMount(({ state }) => {
        const fetchList = async () => {
          const req = await fetch("https://pokeapi.co/api/v2/pokemon");
          const list = await req.json();
          state.pokemonList(list.results);
        };
        const fetchPokemon = async () => {
          const req = await fetch(\`https://pokeapi.co/api/v2/pokemon/\${state.pokemon()}\`);
          const data = await req.json();
          state.pokemonData(data);
        };
        fetchList();
        fetchPokemon();
      })
      .bind("#pokemon", "pokemon")
      .render(({ state }) => {
        const options = state
          .pokemonList()
          .map(({ name }) => html\`
            <option value="\${name}">\${name}</option>
          \`);

        const card = state.pokemonData()
          ? html\`
              <img src="\${state.pokemonData().sprites.front_default}" />
              <h2>\${state.pokemonData().name}</h2>
            \`
          : html\`<p>Loading...</p>\`;

        return html\`
          <label for="pokemon">Pick a Pokemon</label>
          <select id="pokemon">
            \${options}
          </select>
          \${card}
        \`;
      });

    mount({ pokedex });

    // HTML: <div data-ilha="pokedex"></div>
  `,
};

export default Tutorial({ name: "Pokédex: onMount", content, code });
