import type * as Stream from "effect/Stream";

/**
 * Ongoing work whose lifetime follows slices of the model and props.
 * Declarative: the runtime restarts the stream when `depsOf` changes
 * (compared with `Equal.equals`), stops it when the entry leaves the
 * list, and starts everything on the client only.
 */
export interface Subscription<Model, Props, Msg, R, Deps> {
  /** Subscription name; duplicates in one list throw at render. */
  readonly name: string;
  /** Values controlling the lifetime; the stream restarts when they change. */
  readonly depsOf: (model: Model, props: Props) => Deps;
  /** Stream of messages for the current deps. */
  readonly run: (deps: Deps) => Stream.Stream<Msg, never, R>;
}

/** Overloads for {@link make}: constant stream or deps-driven stream. */
export interface MakeSubscription {
  <Msg, R = never>(
    name: string,
    stream: Stream.Stream<Msg, never, R>
  ): Subscription<unknown, unknown, Msg, R, void>;
  <Model, Props, Msg, R, Deps>(
    name: string,
    depsOf: (model: Model, props: Props) => Deps,
    run: (deps: Deps) => Stream.Stream<Msg, never, R>
  ): Subscription<Model, Props, Msg, R, Deps>;
}

/** A subscription with constant deps: same stream for the instance's life. */
export const make: MakeSubscription = (
  name: string,
  // oxlint-disable-next-line typescript/no-explicit-any -- the erased impl shape; see above.
  second: any,
  // oxlint-disable-next-line typescript/no-explicit-any -- the erased impl shape; see above.
  third?: any
  // oxlint-disable-next-line typescript/no-explicit-any -- the erased impl shape; see above.
): Subscription<any, any, any, any, any> => {
  if (third === undefined) {
    // SAFETY: one argument after the name means the constant-stream shape.
    const stream = second as Stream.Stream<never, never, never>;
    return { depsOf: (): void => undefined, name, run: () => stream };
  }
  // SAFETY: two arguments after the name mean (depsOf, run); both are
  // `any`-erased, and the overloads carry the precise types.
  return { depsOf: second, name, run: third };
};
