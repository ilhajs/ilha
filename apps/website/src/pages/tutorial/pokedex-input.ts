import { Tutorial } from "$lib/components/tutorial";
import dedent from "dedent";

const content = dedent`
  ## PokéDex: Input

  Use \`.input()\` to define a validated schema for properties passed into your
  component from the outside. Ilha uses any [Standard Schema](https://standardschema.dev)-compatible
  library for schema definition — including Zod, Valibot, and ArkType — so inputs
  are fully type-safe and validated at runtime.

  For simple cases, Ilha ships a built-in \`type()\` helper that lets you define
  an input schema using a plain TypeScript generic, without any extra dependencies:

  \`\`\`
  .input(type<{ defaultPokemon: string }>())
  \`\`\`

  This is enough when you just need type safety and don't require runtime validation
  rules like min/max lengths, regex patterns, or conditional logic. For those more
  advanced scenarios, reach for a full schema library instead:

  \`\`\`
  .input(z.object({ defaultPokemon: z.string().min(1) }))
  \`\`\`

  Once an input schema is defined, the validated properties become available as
  the first argument to any builder method that accepts a callback — including
  \`.state()\`. This means you can initialize state directly from an input value
  by passing a function instead of a plain default:

  \`\`\`
  .state("pokemon", ({ defaultPokemon }) => defaultPokemon)
  \`\`\`

  Input values are passed to the component at the call site — in the example above,
  the parent \`pokedex\` passes \`{ defaultPokemon: "charizard" }\` when rendering
  the \`picker\` slot. If the value doesn't match the schema, Ilha will throw at
  render time rather than silently passing invalid data into your component.

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
      .state('pokemon', ({ defaultPokemon }) => defaultPokemon)
      .state('pokemonList', [])
      .state('pokemonData', null)
      .onMount(({ state }) => {
        const fetchList = async () => {
          const req = await fetch('https://pokeapi.co/api/v2/pokemon');
          const list = await req.json();
          state.pokemonList(list.results);
        };
        fetchList();
      })
      .effect(({ state }) => {
        const fetchPokemon = async () => {
          const req = await fetch(
            \`https://pokeapi.co/api/v2/pokemon/\${state.pokemon()}\`
          );
          const data = await req.json();
          state.pokemonData(data);
        };
        fetchPokemon();
      })
      .bind('#pokemon', 'pokemon')
      .render(({ state }) => {
        const currentPokemon = state.pokemon();
        const options = state.pokemonList().map(
          ({ name }) => html\`
            <option value="\${name}" \${
            name === currentPokemon ? 'selected' : ''
          }>\${name}</option>
          \`
        );

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

    const pokedex = ilha
      .slot("picker", pokemonPicker)
      .render(({ slots }) => html\`
        \${slots.picker({ defaultPokemon: "charizard" })}
      \`);

    mount({ pokedex });
  `,
};

export default Tutorial({ name: "Pokédex: Input", content, code });
