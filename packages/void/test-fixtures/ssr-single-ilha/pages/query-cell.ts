import { atom } from "ilha";
import type { AtomHandle } from "ilha";

/** Shared cell mounted by the layout; reads below it subscribe. */
let cell: AtomHandle<number> | undefined;

/** The root layout calls this on every render, ahead of any early return. */
export const provideQueryCell = (): void => {
  cell = atom(0);
};

/** A query read subscribes to the layout-provided cell. */
export const queryCellVersion = (): number => {
  cell?.();
  return 0;
};
