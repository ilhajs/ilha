/**
 * Host renderer seam.
 *
 * `mount()` and `renderToString()` ship the two painters ilha uses on the web:
 * the DOM painter and the SSR string painter. This entry exposes the same
 * machinery for a third host — a native toolkit, a test harness, or any tree
 * that is not a DOM — by letting the caller supply `PaintOps`.
 *
 * The painter is host-agnostic: props, holes, keyed reconciliation, refs,
 * events, atoms and generators all run through `PaintOps`. The only host
 * differences are element creation, text creation, placement and teardown.
 *
 * A host mounted through `createRenderer` is placed with `placeChildren` only:
 * every paint hands over the complete child list of the root it painted.
 * `appendRoot` is never called on this path.
 */
import { createPainter } from "./paint-core.ts";
import type { PaintEl, Painter, PaintOps } from "./paint-core.ts";
import { closeFiber, makeRootFiber, makeRuntime } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import { defer } from "./shared.ts";
import { runSetup } from "./start.ts";
import type { Component, IlhaRuntime, View } from "./types.ts";

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

export interface HostRenderer<Node, El extends PaintEl<Node> & Node> {
  /** The shared painter, for advanced callers that paint holes themselves. */
  readonly painter: Painter<Node, El>;
  mount: (
    root: ParentNode,
    fn: Component,
    options?: RendererMountOptions
  ) => RendererHandle;
}

/**
 * Build a renderer for a host described by `ops`.
 *
 * Unlike the DOM painter this materializes fresh host nodes on every paint and
 * attempts no morph: the host receives the new child list through
 * `ops.placeChildren` and decides what to keep. Holes that must survive a
 * repaint (atoms, islands, keyed rows, positional components) stay alive across
 * paints and hand their host node back through `ops.reuseNode`, so their state
 * is never remounted.
 */
export const createRenderer = <Node, El extends PaintEl<Node> & Node>(
  ops: PaintOps<Node, El>
): HostRenderer<Node, El> => {
  const painter = createPainter(ops);

  const paint = (fiber: FiberLocal, view: View): void => {
    painter.commit(() => {
      painter.pass(fiber, () => {
        fiber.islandFrame ??= { i: 0, slots: [] };
        // Keep atom, island, keyed and positional component holes alive so the
        // rebuild below reuses their host nodes instead of remounting them.
        painter.disposeHoles(fiber, { morph: true });
        // Materialize before placing: `reuseNode` reads the live host, which
        // must still be attached when the new tree asks for it.
        ops.placeChildren(fiber.root, painter.materialize(view, fiber));
      });
    });
  };

  return {
    mount(root, fn, options = {}) {
      const runtime = makeRuntime({ onError: options.onError });
      options.onRuntime?.(runtime);
      const { promise: ready, resolve } = defer();
      const fiber = makeRootFiber({ paint, root, runtime, settle: resolve });
      runtime.begin();
      runtime.setIdle(resolve);
      runSetup(fiber, fn);
      runtime.end();
      return {
        ready,
        runtime,
        unmount: () => {
          closeFiber(fiber);
          runtime.close();
          ops.placeChildren(root, []);
        },
      };
    },
    painter,
  };
};
