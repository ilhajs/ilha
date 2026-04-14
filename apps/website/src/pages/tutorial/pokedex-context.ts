import { Tutorial } from "$lib/components/tutorial";
import dedent from "dedent";

const content = dedent`
  ## PokéDex: Context

  Use \`context()\` to create a reactive value that can be shared across multiple
  components without passing it through inputs or slots. Any component that reads
  a context value will react to its changes automatically.

  \`\`\`
  const pokemon = context("pokemon", "charizard");
  \`\`\`

  The first argument is a unique key, the second is the initial value. Read the
  current value by calling it as a function — \`pokemon()\` — and update it by
  passing a new value — \`pokemon("bulbasaur")\`. Both work anywhere in your
  component tree.

  Context is the right tool when the same piece of state needs to be consumed by
  components that don't share a direct parent-child relationship, or when threading
  it through \`.input()\` and \`.slot()\` would create unnecessary coupling. In the
  example above, \`pokemonPicker\` writes to the context via \`.bind()\`, and
  \`pokedex\` reads it in \`.derived()\` — the two components stay fully decoupled.

  Because context values are reactive, any \`.derived()\` or \`.effect()\` that reads
  a context value will re-run when it changes — just like state. Here, changing the
  selected Pokémon automatically re-triggers the \`pokemonData\` fetch and re-renders
  the stats and sprite without any additional wiring.

  ### Similar concepts

  - React: createContext / useContext
  - Vue: provide / inject
  - Svelte: setContext / getContext

  > Pokémon and PokéDex are trademarks of Nintendo/Creatures Inc./GAME FREAK inc.
  > This tutorial uses the PokéAPI for educational purposes only and is not affiliated
  > with or endorsed by the Pokémon Company.
`;

const code = {
  template: dedent`
    <div data-ilha="pokedex"></div>
  `,
  script: dedent`
    import ilha, { html, mount, context, type } from "ilha";

    type Pokemon = {
      name: string;
      stats: { base_stat: number; stat: { name: string } }[];
      sprites: { front_default: string };
      types: { type: { name: string } }[];
    };

    const pokemon = context("pokemon", "charizard");

    const pokemonPicker = ilha
      .state("pokemonList", [])
      .onMount(({ state }) => {
        const fetchList = async () => {
          const req = await fetch("https://pokeapi.co/api/v2/pokemon");
          const list = await req.json();
          state.pokemonList(list.results);
        };
        fetchList();
      })
      .bind("#pokemon", pokemon)
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

    const pokemonStats = ilha
      .input(type<{ stats: { key: string; value: number }[] }>())
      .render(({ input }) => {
        const stats = input.stats.map(({ key, value }) => html\`
          <tr>
            <td>\${key}</td>
            <td>\${value}</td>
          </tr>
        \`);
        return html\`
          <div class="table" style="width:100%">
            <table>
              <thead>
                <tr>
                  <th>Stat</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                \${stats}
              </tbody>
            </table>
          </div>
        \`;
      });

    const pokemonCard = ilha
      .derived("pokemonData", async (): Promise<Pokemon> => {
        const req = await fetch(\`https://pokeapi.co/api/v2/pokemon/\${pokemon()}\`);
        return await req.json();
      })
      .slot("stats", pokemonStats)
      .render(({ derived, slots }) => {
        if (derived.pokemonData.loading) return html\`<p>Loading Pokémon...</p>\`;
        if (derived.pokemonData.error) return html\`
          <p>\${derived.pokemonData.error.message}</p>
        \`;

        const { name, sprites, types, stats } = derived.pokemonData.value!;
        const typesBadges = types.map(({ type }) => html\`
          <span class="badge">\${type.name}</span>
        \`);
        const mappedStats = stats.map((entry) => ({
          key: entry.stat.name,
          value: entry.base_stat,
        }));

        return html\`
          <img src="\${sprites.front_default}" />
          <h2>\${name}</h2>
          \${typesBadges}
          \${slots.stats({ stats: mappedStats })}
        \`;
      });

    const pokedex = ilha
      .slot("picker", pokemonPicker)
      .slot("card", pokemonCard)
      .render(({ slots }) => html\`
        \${slots.picker()}
        \${slots.card()}
      \`);

    mount({ pokedex });
  `,
};

export default Tutorial({ name: "Pokédex: Context", content, code });
