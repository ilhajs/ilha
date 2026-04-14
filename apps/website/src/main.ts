import "./app.css";
import "basecoat-css/all";
import "shedit/editor.css";
import { setupTheme } from "$lib/theme";
// @ts-ignore just making sure .d.ts in CI is fine.
import { pageRouter } from "ilha:pages";
import { createHead } from "unhead/client";

window.__UNHEAD__ = createHead();
pageRouter.mount("#app");

document.addEventListener("DOMContentLoaded", () => {
  setupTheme();
});
