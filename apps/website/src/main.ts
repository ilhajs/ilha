import "./app.css";
import "basecoat-css/all";
import "shedit/editor.css";
import { setupTheme } from "$lib/theme";
// @ts-ignore just making sure .d.ts in CI is fine.
import { pageRouter } from "ilha:pages";

pageRouter.mount("#app");

document.addEventListener("DOMContentLoaded", () => {
  setupTheme();
});
