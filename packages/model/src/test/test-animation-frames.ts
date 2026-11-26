/**
 * A fake `DomSubscription.AnimationFrames` for whole-app tests, so a test
 * fires animation frames without a window, in Node too.
 *
 * Provide `layer` next to the host layer, and fire a frame with `fire`,
 * giving the time since the last one. Every `onAnimationFrame` of the
 * mounted components runs. Settle the host afterwards to see the update.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DomSubscription from "../dom-subscription";

/**
 * The `TestAnimationFrames` service: the fake's control.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair, mirroring ilha's Fragment.
export interface TestAnimationFrames {
  /** The fake clock's time, in ms. */
  readonly now: () => number;
  /** Fires a frame `delta` ms after the last, `16` by default. */
  readonly fire: (delta?: number) => void;
}

/**
 * The `TestAnimationFrames` service.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair, mirroring ilha's Fragment.
export const TestAnimationFrames: Context.Service<
  TestAnimationFrames,
  TestAnimationFrames
> = Context.Service<TestAnimationFrames>(
  "@ilha/model/test/TestAnimationFrames"
);

/**
 * Makes a fake source and its control, with its clock at `0`. `layer`
 * provides a new one per build.
 */
export const make = (): DomSubscription.AnimationFrames &
  TestAnimationFrames => {
  let time = 0;
  const listeners = new Set<(time: number) => void>();
  return {
    fire: (delta = 16) => {
      time += delta;
      // oxlint-disable-next-line unicorn/no-useless-spread -- listeners are snapshotted: a frame may unsubscribe a later listener, which the has check then skips.
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) {
          listener(time);
        }
      }
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    now: () => time,
  };
};

/**
 * Provides a fake `DomSubscription.AnimationFrames` with its control,
 * `TestAnimationFrames`.
 */
export const layer: Layer.Layer<TestAnimationFrames> = Layer.effectContext(
  Effect.sync(() => {
    const frames = make();
    return Context.make(TestAnimationFrames, frames).pipe(
      // SAFETY: `make` returns one object implementing both services; the cast reuses it for each key.
      Context.add(
        DomSubscription.AnimationFrames,
        frames as DomSubscription.AnimationFrames
      )
    );
  })
);

/**
 * Fires a frame `delta` ms after the last, `16` by default, through the
 * fake.
 */
export const fire = (
  delta?: number
): Effect.Effect<void, never, TestAnimationFrames> =>
  TestAnimationFrames.useSync((frames) => frames.fire(delta));
