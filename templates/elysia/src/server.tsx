import { staticPlugin } from "@elysiajs/static";
import { Elysia } from "elysia";

const app = new Elysia()
  .use(staticPlugin({ indexHTML: true, assets: "./dist", prefix: "/" }))
  .listen(3000);

console.log(`Elysia is running at ${app.server?.url}`);
