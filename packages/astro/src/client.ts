import { wrapPlainAsIsland, type PlainComponent } from "./plain";

interface MountableIsland {
  mount(host: Element, props?: Record<string, unknown>): () => void;
}

function isMountable(Component: unknown): Component is MountableIsland {
  return !!Component && typeof (Component as MountableIsland).mount === "function";
}

// Astro renders our SSR output (a `[data-ilha]` element) as a light-DOM child
// of the `<astro-island>` element it passes here — find it and hand it to
// ilha's own hydration, which reads props/state straight off the DOM.
//
// `client:only` islands have no `ssr` attribute and no SSR markup — mount them
// fresh with the props Astro passes into the client renderer.
//
// Non-island components (e.g. Areia's `Button`) have no `.mount()`, but calling
// them schedules client-side auto-bind against the already-SSR'd markup
// (`data-areia-*`). Re-invoke so `client:*` actually wires interactivity.
//
// When a plain component nests islands, SSR emits a `data-ilha` shell (see
// server.ts). Mount that shell so nested `data-ilha-slot` children get
// `.mount()` / hydration setup — re-invoke alone cannot hydrate nested islands.
export default (element: HTMLElement) =>
  async (
    Component: unknown,
    props: Record<string, unknown>,
    slotted: Record<string, string>,
    _metadata: Record<string, string>,
  ) => {
    if (!element.hasAttribute("ssr")) {
      if (isMountable(Component)) {
        const unmount = Component.mount(element, props);
        element.addEventListener("astro:unmount", () => unmount(), { once: true });
      }
      return;
    }

    if (isMountable(Component)) {
      const host = element.querySelector<HTMLElement>("[data-ilha]") ?? element;
      const unmount = Component.mount(host);
      element.addEventListener("astro:unmount", () => unmount(), { once: true });
      return;
    }

    if (typeof Component !== "function") return;

    const merged: Record<string, unknown> = { ...props };
    for (const [name, value] of Object.entries(slotted ?? {})) {
      merged[name === "default" ? "children" : name] = value;
    }

    const nestedHost = element.querySelector<HTMLElement>("[data-ilha]");
    if (nestedHost?.querySelector("[data-ilha-slot]")) {
      try {
        const Shell = wrapPlainAsIsland(Component as PlainComponent, merged);
        const unmount = Shell.mount(nestedHost);
        element.addEventListener("astro:unmount", () => unmount(), { once: true });
      } catch {
        throw new Error(
          `[@ilha/astro] Failed to mount nested islands inside plain component — expected a function that returns ilha RawHtml/string.`,
        );
      }
      return;
    }

    try {
      (Component as PlainComponent)(merged);
    } catch {
      throw new Error(
        `[@ilha/astro] Failed to bind client component — expected a function that can re-run against SSR markup.`,
      );
    }
  };
