import { Tutorial } from "$lib/components/tutorial";
import dedent from "dedent";

const content = dedent`
  ## PokéDex: Slot

  As your components grow, you'll want to split logic into smaller, focused pieces.
  Use \`.slot()\` to compose multiple Ilha components together into a single parent
  component — each child manages its own state, lifecycle, and rendering independently.

  \`\`\`
  .slot("slotName", childComponent)
  \`\`\`

  A slot registers a child component under a name. The parent can then place it
  anywhere in its template by calling \`slots.slotName()\` inside \`.render()\`.
  The parent doesn't need to know anything about the child's internals — it just
  decides *where* it appears.

  This is Ilha's approach to composition over inheritance. Rather than one large
  component with all the state and logic in one place, you build a tree of focused
  islands — each one independently reactive — and assemble them in a parent via slots.

  In the example above, the single component from the previous step is split into two:
  \`pokemonPicker\` handles the dropdown, and \`pokemonCard\` handles the display.
  The \`pokedex\` parent registers both as slots and renders them without coupling to
  either's implementation. Swapping or reusing either child elsewhere requires no
  changes to the parent.

  > Pokémon and PokéDex are trademarks of Nintendo/Creatures Inc./GAME FREAK inc.
  > This tutorial uses the PokéAPI for educational purposes only and is not affiliated
  > with or endorsed by the Pokémon Company.
`;

const code = {
  template: dedent`
    <div data-ilha="pokedex"></div>
  `,
  script: dedent`
    import ilha, { html, mount, type } from "ilha";

    const pokemonPicker = ilha
      .input(type<{ defaultPokemon: string }>())
      .state("pokemon", ({ defaultPokemon }) => defaultPokemon)
      .state("pokemonList", [])
      .onMount(({ state }) => {
        const fetchList = async () => {
          const req = await fetch("https://pokeapi.co/api/v2/pokemon");
          const list = await req.json();
          state.pokemonList(list.results);
        };
        fetchList();
      })
      .bind("#pokemon", "pokemon")
      .render(({ state }) => {
        const options = state
          .pokemonList()
          .map(({ name }) => html\`
            <option value="\${name}">\${name}</option>
          \`);
        return html\`
          <label for="pokemon">Pick a Pokemon</label>
          <select id="pokemon">
            \${options}
          </select>
        \`;
      });

    const pokemonCard = ilha
      .input(type<{ pokemon: string }>())
      .state("pokemonData", null)
      .onMount(({ state, input }) => {
        const fetchPokemon = async () => {
          const req = await fetch(\`https://pokeapi.co/api/v2/pokemon/\${input.pokemon}\`);
          const data = await req.json();
          state.pokemonData(data);
        };
        fetchPokemon();
      })
      .render(({ state }) => {
        if (!state.pokemonData()) return html\`<p>Loading...</p>\`;
        const { name, sprites, types } = state.pokemonData();
        const typeBadges = types.map(({ type }) => html\`
          <span class="badge">\${type.name}</span>
        \`);
        return html\`
          <img src="\${sprites.front_default}" />
          <h2>\${name}</h2>
          \${typeBadges}
        \`;
      });

    const pokedex = ilha
      .slot("picker", pokemonPicker)
      .slot("card", pokemonCard)
      .state("selected", "charizard")
      .render(({ slots, state }) => html\`
        \${slots.picker({ defaultPokemon: state.selected() })}
        \${slots.card({ pokemon: state.selected() })}
      \`);

    mount({ pokedex });
  `,
};

export default Tutorial({ name: "Pokédex: Slot", content, code });
