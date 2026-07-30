import { Hono } from "hono";

const app = new Hono().get("/foo", async (c) => {
  return c.text("bar");
});

export type AppType = typeof app;

export default app;
