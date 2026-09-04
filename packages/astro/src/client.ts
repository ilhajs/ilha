import { mount } from "ilha";
import type { View } from "ilha";

/** JSON-serializable data — Astro props cross the client boundary serialized. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Props passed to a hydrated island: Astro's serialized props plus slotted
 * content re-keyed as `children`. */
type IslandProps = Record<string, Json>;

export type { IslandProps };

/** An ilha component: a function of props producing a view. The integration's
 * `check()` validates the component at build time, so no runtime guard is
 * needed here. */
type IslandComponent = (
  props: IslandProps
) => View | undefined | Promise<View | undefined>;

const mountIsland =
  (element: HTMLElement) =>
  (
    Component: IslandComponent,
    props: IslandProps,
    slotted: Record<string, string>,
    _metadata: Record<string, string>
  ) => {
    const merged = { ...props };
    for (const [name, value] of Object.entries(slotted ?? {})) {
      merged[name === "default" ? "children" : name] = value;
    }

    const nested = element.querySelector<HTMLElement>("[data-ilha]");
    const hydrate = !!nested;
    const host = nested ?? element;
    const unmount = mount(host, () => Component(merged), {
      hydrate,
    });
    element.addEventListener("astro:unmount", () => unmount(), { once: true });
  };

export default mountIsland;
