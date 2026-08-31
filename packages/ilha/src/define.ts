import { mount } from "./mount.ts";
import type { Setup } from "./types.ts";

export function define(name: string, setup: Setup): void {
  customElements.define(
    name,
    class extends HTMLElement {
      #unmount: (() => void) | undefined;
      connectedCallback(): void {
        this.#unmount = mount(this, setup, {
          hydrate: this.hasAttribute("data-ilha"),
        });
      }
      disconnectedCallback(): void {
        this.#unmount?.();
        this.#unmount = undefined;
      }
    },
  );
}
