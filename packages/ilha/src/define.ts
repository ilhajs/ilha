import { mount } from "./mount.ts";
import type { Component } from "./types.ts";

export function define(name: string, component: Component): void {
  customElements.define(
    name,
    class extends HTMLElement {
      #unmount: (() => void) | undefined;
      connectedCallback(): void {
        this.#unmount = mount(this, component, {
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
