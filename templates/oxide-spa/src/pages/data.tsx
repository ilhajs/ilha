import { ilha } from "ilha";

// Regular page with a server load — client navigations fetch its data from
// GET /__ilha/loader, served by the frame middleware in production.
export async function load() {
  return { note: "hello-from-server-load" };
}

export default ilha.render(({ input }: any) => `<p data-note>${input?.note ?? "-"}</p>`);
