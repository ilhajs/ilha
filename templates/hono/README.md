# Hono and Ilha

## Add Tailwind

Install dependencies:

```sh
npm install -D tailwindcss @tailwindcss/cli
# or Bun
bun add -D tailwindcss @tailwindcss/cli
```

Import `tailwindcss` in `app.css`:

```diff
+@import "tailwindcss";
```

Adjust `tsdown.config.ts`:

```diff
import { defineConfig } from "tsdown";

export default defineConfig([
  // ...
  {
    entry: ["src/client.ts"],
    copy: [
      { from: "public/*", to: "dist/static" },
-     { from: "src/app.css", to: "dist/static" },
    ],
    // ...
+   hooks: {
+     "build:done": async () => {
+       const proc = spawn(
+         "bunx",
+         ["@tailwindcss/cli", "-i", "src/app.css", "-o", "dist/static/app.css"],
+         {
+           stdio: "inherit",
+         },
+       );
+       if (!proc.stdout) return;
+       for await (const chunk of proc.stdout) {
+         process.stdout.write(chunk);
+       }
+     },
+   },
  },
]);
```
