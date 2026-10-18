// Bundle the panel SPA into dist/spa, the directory `clientAssets` serves.
import { cp, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const outdir = new URL("dist/spa/", root);

await mkdir(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [new URL("src/spa/main.tsx", root).pathname],
  minify: true,
  naming: "[name].js",
  outdir: outdir.pathname,
  target: "browser",
});

if (!result.success) {
  throw new AggregateError(result.logs, "Panel SPA build failed");
}

await cp(new URL("src/spa/index.html", root), new URL("index.html", outdir));
await cp(new URL("src/spa/style.css", root), new URL("style.css", outdir));
