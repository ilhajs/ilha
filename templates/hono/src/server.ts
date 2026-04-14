import { readFile } from "node:fs/promises";
import path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "hono/serve-static";
import ilha, { html, type } from "ilha";

import spaTemplate from "../index.html?raw";

const serveAssets = serveStatic({
  async getContent(assetPath) {
    return readFile(path.resolve(import.meta.dirname, assetPath), "utf-8");
  },
});

const app = new Hono();

app.use("/static/*", serveAssets);

app.get("/task-counter", async (c) => {
  const counter = ilha.input(type<{ count: string }>()).render(
    ({ input }) =>
      html`
      <p>There are ${input.count} tasks</p>
    `,
  );

  const url = new URL(c.req.url);
  return c.html(await counter({ count: url.searchParams.get("count") ?? "" }));
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
