import "./app.css";
import { pageRouter } from "ilha:pages";
import { registry } from "ilha:registry";

import clientAssets from "./entry-client.ts?assets=client";
import serverAssets from "./entry-server.ts?assets=ssr";

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const href = url.href.slice(url.origin.length);

  const body = await pageRouter.renderHydratable(href, registry);

  const assets = clientAssets.merge(serverAssets);
  const entryPath = assets.entry ?? "/entry-client.js";
  const styles = assets.css.map((asset) => stylesheetTag(asset)).join("\n  ");

  return new Response(htmlTemplate(body, entryPath, styles), {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
}

function stylesheetTag(attrs: { href: string; "data-vite-dev-id"?: string }): string {
  const devId = attrs["data-vite-dev-id"] ? ` data-vite-dev-id="${attrs["data-vite-dev-id"]}"` : "";

  return `<link rel="stylesheet" href="${attrs.href}"${devId} />`;
}

function htmlTemplate(body: string, clientEntry: string, styles: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ilha + Nitro</title>
  <link rel="icon" href="/favicon.svg" />
  ${styles}
</head>
<body>
  <div id="app">${body}</div>
  <script type="module" src="${clientEntry}"></script>
</body>
</html>`;
}

export default { fetch: handler };
