import { isActive } from "@ilha/router";
import type { LayoutHandler } from "@ilha/router/vite";
import ilha, { html } from "ilha";

export default ((children) =>
  ilha.slot("children", children).render(
    ({ slots }) => html`
    <nav class="container navbar x-stack">
      <a href="/" class="button" data-variant="${isActive("/") ? "secondary" : "ghost"}">Home</a>
      <a href="/learn" class="button" data-variant="${isActive("/learn") ? "secondary" : "ghost"}">Learn</a>
    </nav>
    <main class="container">
      ${slots.children()}
    </main>
  `,
  )) satisfies LayoutHandler;
