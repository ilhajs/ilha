import { mount } from "ilha";
import type { View } from "ilha";

import type { JsonRecord } from "./types";

/** An island module: its default export is an ilha component. */
export interface IslandModule<P extends JsonRecord> {
  readonly default: (props: P) => View;
}

/**
 * Mount one island from its `data-island` marker. The islands client entry
 * passes this to Void's `initIslands`, which applies the hydration strategy.
 */
export const mountIsland = <P extends JsonRecord>(
  el: HTMLElement,
  { default: Component }: IslandModule<P>,
  props: P
): void => {
  const host = el.querySelector(":scope > [data-ilha]");
  mount(host ?? el, () => Component(props), { hydrate: host !== null });
  el.dataset.hydrated = "true";
};
