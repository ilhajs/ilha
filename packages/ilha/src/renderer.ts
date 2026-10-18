/**
 * Host renderer seam.
 *
 * `mount()` and `renderToString()` ship the two painters ilha uses on the web.
 * This entry exposes the same painter for a third host — a native toolkit, a
 * test harness, or any tree that is not a DOM — through `PaintOps`.
 *
 * Every paint materializes fresh host nodes and hands the complete child list
 * of the painted root to `ops.placeChildren` (or `ops.morph`). Holes that
 * survive a repaint (atoms, keyed rows, positional components) hand their host
 * node back through `ops.reuseNode`, so their state is never remounted.
 */
import { createPainter } from "./paint-core.ts";
import type { PaintEl, Painter, PaintOps } from "./paint-core.ts";
import { startRoot } from "./start.ts";
import type { Component, IlhaRuntime } from "./types.ts";

export type {
  FormControlKey,
  PaintEl,
  Painter,
  PaintOps,
} from "./paint-core.ts";
export { bindEvents } from "./events.ts";
export { getFiber } from "./runtime.ts";
export type { FiberLocal } from "./runtime.ts";
export type {
  Component,
  IlhaRuntime,
  PropBag,
  PropValue,
  View,
} from "./types.ts";

export interface RendererMountOptions {
  /**
   * Called with a failing root component, and with a nested component no
   * `ErrorBoundary` caught, before the error view paints.
   */
  onError?: (error: Error) => void;
  /**
   * Called with the mount's runtime before the root component runs. Every
   * fiber of the mount carries it, so a host can key its own per-mount state
   * on it and read that state from inside a component through `getFiber()`.
   */
  onRuntime?: (runtime: IlhaRuntime) => void;
}

export interface RendererHandle {
  /** Stop the tree: closes every fiber, releases the registry, clears the root. */
  unmount: () => void;
  /** Resolves once in-flight work (async components, streams) goes idle. */
  ready: Promise<null>;
  runtime: IlhaRuntime;
}

export interface HostRenderer<Node> {
  /** The shared painter, for advanced callers that paint holes themselves. */
  readonly painter: Painter<Node>;
  mount: (
    root: ParentNode,
    fn: Component,
    options?: RendererMountOptions
  ) => RendererHandle;
}

/** Build a renderer for a host described by `ops`. */
export const createRenderer = <Node, El extends PaintEl<Node> & Node>(
  ops: PaintOps<Node, El>
): HostRenderer<Node> => {
  const painter = createPainter(ops);
  return {
    mount: (root, fn, { onError, onRuntime } = {}) => {
      const { close, ready, runtime } = startRoot({
        fn,
        onError,
        onRuntime,
        paint: painter.paint,
        root,
      });
      return {
        ready,
        runtime,
        unmount: () => {
          close();
          ops.placeChildren(root, []);
        },
      };
    },
    painter,
  };
};
