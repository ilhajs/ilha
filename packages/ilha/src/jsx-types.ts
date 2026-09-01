import type { View } from "./types.ts";

export namespace JSX {
  export type Element = View;
  export type ElementType =
    | string
    | ((
        props: Record<string, unknown>,
      ) => View | Promise<View | void> | Generator<unknown, View | void, unknown>);
  export interface IntrinsicElements {
    [tag: string]: {
      ref?: (el: globalThis.Element | null) => void;
      [key: string]: unknown;
    };
  }
  export interface ElementChildrenAttribute {
    children: {};
  }
}
