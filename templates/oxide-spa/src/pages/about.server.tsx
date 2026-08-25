import { ilha } from "ilha";

type AboutInput = { path?: string };

// Server page: rendered entirely server-side. `load` runs at frame time via
// pageRouter; its return value becomes the island's props.
export async function load({ request }: { request: Request }) {
  const path = new URL(request.url).pathname;
  return { path };
}

export default ilha(({ path }: AboutInput) => {
  return `<section><h1>About</h1><p data-path>rendered for ${path ?? "unknown"}</p></section>`;
});
