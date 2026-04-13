import { footer } from "$lib/components/footer";
import { navbar } from "$lib/components/navbar";
import type { LayoutHandler } from "@ilha/router";
import ilha, { html } from "ilha";

export default ((children) =>
  ilha
    .slot("navbar", navbar)
    .slot("footer", footer)
    .slot("children", children)
    .render(({ slots }) => {
      return html`
        <div id="toaster" class="toaster"></div>
        <div class="flex min-h-screen flex-col gap-2">
          ${slots.navbar()}
          <div class="container mx-auto flex flex-1 flex-col p-4">${slots.children()}</div>
          ${slots.footer()}
        </div>
      `;
    })) satisfies LayoutHandler;
