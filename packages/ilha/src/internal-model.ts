/**
 * Model-runtime hooks for `@ilha/model`: the current fiber and the island
 * types the public entrypoint keeps private. Importing from `ilha`
 * (not `ilha/internal`) cannot reach these.
 *
 * `@ilha/model` needs the rendering fiber to own instance records per
 * island (`fiber.registry` scopes the kernel), to discover a child hole's
 * vnode key in its parent's maps, and to type the vnode walk and the view
 * helper. These are read-only or type-only; the painter's invariants are
 * untouched.
 */
export {
  getFiber,
  onFiberClose,
  onRuntimeClose,
  withFiber,
} from "./runtime.ts";
export { readTracked } from "./atom.ts";
export type { FiberLocal } from "./runtime.ts";
export type { HFn } from "./vnode.ts";
export type {
  ComponentFn,
  IlhaRuntime,
  PropBag,
  VNode,
  View,
} from "./types.ts";
