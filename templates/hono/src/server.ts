import { readFile } from "node:fs/promises";
import path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "hono/serve-static";
import ilha, { html } from "ilha";

import spaTemplate from "../index.html?raw";

const serveAssets = serveStatic({
  async getContent(assetPath) {
    return readFile(path.resolve(import.meta.dirname, assetPath), "utf-8");
  },
});

const app = new Hono();

app.use("/static/*", serveAssets);

app.get("/server-island", (c) => {
  const Counter = ilha.render(
    () =>
      html`
        <p>Hello from the server.</p>
      `,
  );

  return c.html(Counter());
});

app.get("/*", async (c) => {
  return c.html(spaTemplate);
});

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
