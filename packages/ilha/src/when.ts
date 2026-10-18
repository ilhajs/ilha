import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as Stream from "effect/Stream";

import { instr } from "./atom.ts";
import { interpret } from "./interpret.ts";
import { closeFiber, getFiber, makeFiber } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import type { Instruction, View, Yielded } from "./types.ts";

/** Rerun `body` for every value of `stream`, replacing the previous run. */
export const when = <A, E = never, R = never>(
  stream: Stream.Stream<A, E, R>,
  body: (value: A) => Generator<Yielded, View | undefined, View>
): Instruction<void, E> =>
  instr(
    Effect.suspend(() => {
      const parent = getFiber();
      let child: FiberLocal | undefined;
      const stop = (): void => {
        if (child) {
          closeFiber(child);
        }
      };
      parent.holes.push({ dispose: stop });
      // SAFETY: when() runs under an island fiber whose registry satisfies AtomRegistry.
      const base = stream as Stream.Stream<A, E, AtomRegistry>;
      return Stream.runForEach(
        parent.runtime.ssr ? Stream.take(base, 1) : base,
        (value) =>
          Effect.sync(() => {
            stop();
            // Child fibers paint with their parent's paint fn, so `when` works
            // under both DOM mount and SSR.
            child = makeFiber(parent.runtime, parent.root, parent.paintFn, {
              parent,
            });
            interpret(() => body(value), child);
          })
      ).pipe(Effect.asVoid);
    })
  );
