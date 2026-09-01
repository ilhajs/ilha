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

    const nested = element.querySelector<HTMLElement>("[data-ilha]");
    const hydrate = !!nested;
    const host = nested ?? element;
    const unmount = mount(
      host,
      () => (Component as (p: Record<string, unknown>) => unknown)(merged) as never,
      {
        hydrate,
      },
    );
    element.addEventListener("astro:unmount", () => unmount(), { once: true });
  };
