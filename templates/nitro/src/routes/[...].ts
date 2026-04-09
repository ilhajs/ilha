import pageRouter from "ilha:pages";
import { defineHandler } from "nitro";

export default defineHandler((event) => {
  const html = pageRouter.render(event.url.pathname ?? "/");
  return new Response(`<!doctype html><html><body>${html}</body></html>`, {
    headers: { "content-type": "text/html" },
  });
});
