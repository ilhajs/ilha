import { html as htmlPlugin } from "@elysiajs/html";
import { staticPlugin } from "@elysiajs/static";
import { Elysia } from "elysia";
import ilha from "ilha";

const app = new Elysia()
  .use(staticPlugin({ indexHTML: true, assets: "./dist", prefix: "/" }))
  .use(htmlPlugin())
  .get("/server-island", () => ilha.render(() => <p>Hello from the server.</p>))
  .listen(3000);

console.log(`Elysia is running at ${app.server?.url}`);
