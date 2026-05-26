import type { RawHtml } from "./index";

export namespace JSX {
  export type Child = unknown;
  export type ElementType = string | ((props: any) => any);

  export interface Element extends RawHtml {}

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicAttributes {
    key?: string | number;
  }

  export type IntrinsicElementProps = {
    children?: Child;
    class?: string | unknown[] | Record<string, boolean>;
    className?: string | unknown[] | Record<string, boolean>;
    htmlFor?: string;
    [name: string]: unknown;
  };

  export interface IntrinsicElements {
    [name: string]: IntrinsicElementProps;
  }
}
