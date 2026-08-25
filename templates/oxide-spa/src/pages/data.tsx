import { ilha } from "ilha";

// Regular page with a server load — client navigations fetch its data from
// GET /__ilha/loader, served by the frame middleware in production.
export async function load() {
  return { note: "hello-from-server-load" };
}

export default ilha(({ note }: { note?: string }) => `<p data-note>${note ?? "-"}</p>`);
