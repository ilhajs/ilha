import { r as HTTPResponse } from "../_libs/h3+rou3+srvx.mjs";
//#region #nitro/virtual/renderer-template
var rendererTemplate = () =>
  new HTTPResponse(
    '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>Ilha + Hono</title>\n    <link rel="icon" href="/static/favicon.svg" />\n    <meta content="width=device-width, initial-scale=1" name="viewport" />\n    <script type="module" crossorigin src="/assets/index-CNEqw9eY.js"><\/script>\n    <link rel="stylesheet" crossorigin href="/assets/index-DDaNOvR7.css">\n  </head>\n  <body>\n    <div id="app"></div>\n  </body>\n</html>\n',
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
//#endregion
//#region ../../node_modules/.bun/nitro@3.0.260610-beta+85e7c04590d463c4/node_modules/nitro/dist/runtime/internal/routes/renderer-template.mjs
function renderIndexHTML(event) {
  return rendererTemplate(event.req);
}
//#endregion
export { renderIndexHTML as default };
