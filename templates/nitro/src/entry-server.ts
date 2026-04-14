import "./app.css";
import { pageRouter } from "ilha:pages";
import { registry } from "ilha:registry";

import clientAssets from "./entry-client.ts?assets=client";

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const href = url.href.slice(url.origin.length);

  const body = await pageRouter.renderHydratable(href, registry);

  const entryPath = clientAssets.entry ?? "/entry-client.js";
  return new Response(htmlTemplate(body, entryPath), {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
}

function htmlTemplate(body: string, clientEntry: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ilha + Nitro</title>
  <link rel="icon" href="/favicon.svg" />
  <link
    href="https://cdn.jsdelivr.net/npm/@faith-tools/sensible-ui@1.0.5/dist/sensible-ui.min.css"
    type="text/css"
    rel="stylesheet"
  />
</head>
<body>
  <div id="app">${body}</div>
  <script type="module" src="${clientEntry}"></script>
</body>
</html>`;
}

export default { fetch: handler };
