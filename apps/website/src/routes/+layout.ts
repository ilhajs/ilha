import { footer } from "$lib/components/footer";
import { navbar } from "$lib/components/navbar";
import type { Island } from "ilha";
import ilha, { html } from "ilha";

export default (child: Island) =>
  ilha
    .slot("navbar", navbar)
    .slot("footer", footer)
    .slot("child", child)
    .render(({ slots }) => {
      return html`
        <div class="flex min-h-screen flex-col gap-2">
          ${slots.navbar()}
          <div class="container mx-auto flex flex-1 flex-col p-2">${slots.child()}</div>
          ${slots.footer()}
        </div>
      `;
    });
