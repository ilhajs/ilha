import "./app.css";
import { IlhaHandler, appHead, mergeAssets } from "@ilha/router/ssr";

import client from "./entry-client.ts?assets=client";
import server from "./entry-server.ts?assets=ssr";

const themeScript = `(function () {
  var stored = localStorage.getItem("imprensa:theme");
  var dark =
    stored === "dark" ||
    (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.documentElement.dataset.themeReady = "";
})();`;

const handler = new IlhaHandler({
  assets: mergeAssets({ client, server }),
  head: appHead({
    title: "Ilha + Nitro",
    script: [{ children: themeScript }],
  }),
});

export const fetch = (request: Request) => handler.handle(request);
