import "./app.css";
import "basecoat-css/all";
import "shedit/editor.css";
import { setupTheme } from "$lib/theme";
import { mount } from "ilha";
import { findRoute } from "rou3";

import { router } from "./router";

async function render() {
  const route = findRoute(router, "GET", window.location.pathname);
  const component = route!.data.component;
  mount({ app: component });
}

await render();

window.addEventListener("popstate", render);

document.addEventListener("DOMContentLoaded", () => {
  setupTheme();
});

if (import.meta.hot) {
  import.meta.hot.accept();
}
