interface MountableIsland {
  mount(host: Element, props?: Record<string, unknown>): () => void;
}

type PlainComponent = (props: Record<string, unknown>) => unknown;

function isMountable(Component: unknown): Component is MountableIsland {
  return !!Component && typeof (Component as MountableIsland).mount === "function";
}

// Astro renders our SSR output (a `[data-ilha]` element) as a light-DOM child
// of the `<astro-island>` element it passes here — find it and hand it to
// ilha's own hydration, which reads props/state straight off the DOM.
//
// Non-island components (e.g. Areia's `ContextMenu` without callbacks) have no
// `.mount()`, but calling them schedules client-side auto-bind against the
// already-SSR'd markup (`data-areia-*`). Re-invoke so `client:*` actually
// wires interactivity; discard the return value — the DOM is already correct.
export default (element: HTMLElement) =>
  async (
    Component: unknown,
    props: Record<string, unknown>,
    slotted: Record<string, string>,
    _metadata: Record<string, string>,
  ) => {
    if (!element.hasAttribute("ssr")) return;

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
    try {
      (Component as PlainComponent)(merged);
    } catch {
      // SSR already produced markup; a throw here only means the component
      // couldn't re-run its client scheduler with serialized props.
    }
  };
