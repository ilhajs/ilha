import type { RawHtml } from "ilha";

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
    class?: string | string[] | Record<string, boolean>;
    className?: string | string[] | Record<string, boolean>;
    htmlFor?: string;
    [name: string]: unknown;
  };

  export interface IntrinsicElements {
    [name: string]: IntrinsicElementProps;
  }
}
