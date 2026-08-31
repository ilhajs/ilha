import { mount } from "ilha";

export default (element: HTMLElement) =>
  async (
    Component: unknown,
    props: Record<string, unknown>,
    slotted: Record<string, string>,
    _metadata: Record<string, string>,
  ) => {
    if (typeof Component !== "function") return;

    const merged: Record<string, unknown> = { ...props };
    for (const [name, value] of Object.entries(slotted ?? {})) {
      merged[name === "default" ? "children" : name] = value;
    }

    const hydrate = element.hasAttribute("ssr");
    const host = (hydrate && element.querySelector<HTMLElement>("[data-ilha]")) || element;
    const unmount = mount(host, () => Component(merged) as never, { hydrate });
    element.addEventListener("astro:unmount", () => unmount(), { once: true });
  };
