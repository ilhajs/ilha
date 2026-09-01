import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import { instr } from "./atom.ts";
import { interpret } from "./interpret.ts";
import { paint } from "./paint.ts";
import { closeFiber, getFiber, makeFiber } from "./runtime.ts";
import type { Done, GeneratorFn, Instruction, View, Yielded } from "./types.ts";

export function wait<A>(
  body: (done: Done<A>) => Generator<Yielded, View | void, unknown>,
): Instruction<A> {
  return instr(
    Effect.gen(function* () {
      const parent = getFiber();
      const deferred = yield* Deferred.make<A>();
      let settled = false;
      const done: Done<A> = (value) => {
        if (settled) return;
        settled = true;
        Effect.runSync(Deferred.succeed(deferred, value));
      };
      const child = makeFiber(parent.runtime, parent.root, paint, {
        onFail: parent.fail,
      });
      interpret((() => body(done)) as GeneratorFn, child);
      try {
        return yield* Deferred.await(deferred);
      } finally {
        closeFiber(child);
      }
    }),
  );
}
