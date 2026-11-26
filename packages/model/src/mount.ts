/**
 * Mounts: the work an element starts with its host node, such as drawing on
 * a canvas or measuring a box.
 *
 * A mount is a definition: `Mount.make(name, { args }, run)` takes a name,
 * an `args` Schema and a body, and returns a factory. A view calls the
 * factory with the args and gives the result to `h.mount(issued)`, which
 * returns an Ilha `ref` prop for the element. The runtime runs the body once
 * the element commits, and a test names the mount by its definition without
 * running anything.
 *
 * The body gets the host node, the args and a Stream of the args, and ends
 * with its own result. The view maps that result to a message with
 * `Mount.map`. When there is nothing to report, return `Component.noop`: it
 * sends no message, but the log still records when the body starts and ends.
 * Use `Mount.makeStream` for a mount that reports as it goes, such as a
 * widget that sends events. Its body is a Stream of results.
 *
 * Ported from Effect UI's `mount.ts`.
 */
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Pipeable from "effect/Pipeable";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

/**
 * Identifies an issued mount.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const TypeId = "~@effect/ui/Mount" as const;

/**
 * Identifies an issued mount.
 */
export type TypeId = typeof TypeId;

/**
 * Identifies a mount definition.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const DefinitionTypeId = "~@effect/ui/Mount/Definition" as const;

/**
 * Identifies a mount definition.
 */
export type DefinitionTypeId = typeof DefinitionTypeId;

/**
 * An args record or struct for a mount definition. Any Schema works here,
 * including `Schema.Struct`, `Schema.optional` fields and `Schema.declare`
 * results: mounts decode args and compare them through `Schema.Top`.
 */
export type ArgsInput =
  | Record<string, Schema.Top>
  | Schema.Struct<Schema.Struct.Fields>;
/** The decoded args struct a mount body, and its `changes` Stream, receive. */
export type ArgsOf<In extends ArgsInput> =
  In extends Schema.Struct<Schema.Struct.Fields>
    ? In["Type"]
    : {
        readonly [K in keyof In]: In[K] extends Schema.Schema<infer T>
          ? T
          : never;
      };

/**
 * The options of `make`: `args` is required. The log encodes a mount's args
 * through it, redacting `Schema.Redacted` fields, and the runtime uses its
 * equivalence to tell whether a render changed them.
 */
export interface Options<In extends ArgsInput> {
  /** The args Schema: a fields record or a `Schema.Struct`. */
  readonly args: In;
}

/**
 * A mount definition: what a test names a mount by. `Args` is the args
 * struct, `A` the body's result, `Node` the host node the body needs and `R`
 * what it requires.
 */
// oxlint-disable-next-line eslint/no-shadow -- Args is the mount args-struct name throughout; the generic binding is intentional.
export interface Definition<Args, A, Node = unknown, R = never> {
  readonly [DefinitionTypeId]: DefinitionTypeId;
  /** The definition's name, shown in the log and in test failures. */
  readonly name: string;
  /** The args Schema. */
  readonly args: Schema.Top;
  /**
   * Phantom compile-time record of the definition's types. Never present at
   * runtime; it keeps `Args`, `A`, `Node` and `R` bound to the definition.
   */
  readonly "~types"?:
    | {
        readonly args: Args;
        readonly result: A;
        readonly node: Node;
        readonly env: R;
      }
    | undefined;
}

/**
 * Any mount definition.
 */
export type AnyDefinition = Definition<never, never, never, never>;

/**
 * What `make` returns: call it with the mount's args struct to issue it.
 */
export interface Factory<
  // oxlint-disable-next-line eslint/no-shadow -- Args is the mount args-struct name throughout; the generic binding is intentional.
  in out Args,
  in out A,
  in out Node = unknown,
  out R = never,
> extends Definition<Args, A, Node, R> {
  (
    // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- {} extends Args probes for no required props; the empty object type is the correct probe.
    ...args: {} extends Args ? readonly [args?: Args] : readonly [args: Args]
  ): Issued<A, R, Node, A>;
}

/**
 * An issued mount: what a definition's factory returns, and what `h.mount`
 * takes. `Msg` is what it ends with, after every `map`. `R` is what its
 * body requires and `Node` the host node the body needs. `Source` is the
 * definition's own result, before any `map`.
 */
export interface Issued<
  out Msg,
  out R = never,
  in Node = unknown,
  in Source = Msg,
>
  extends Pipeable.Pipeable {
  readonly [TypeId]: TypeId;
  /** The definition's name, shown in the log and in test failures. */
  readonly name: string;
  /** The args struct the mount was issued with. */
  readonly args: unknown;
  /**
   * The args Schema, for the log and for comparing args.
   *
   * @internal
   */
  readonly argsSchema: Schema.Top;
  /**
   * Whether the body gives any number of results, as `makeStream`'s does,
   * rather than one. A test ends a mount that gives one only once.
   *
   * @internal
   */
  readonly stream: boolean;
  /**
   * The definition's body, before any `map`, giving each result to `send`.
   *
   * @internal
   */
  readonly run: (
    node: Node,
    args: never,
    changes: Stream.Stream<never>,
    send: (result: never) => Effect.Effect<void>
  ) => Effect.Effect<void, never, R>;
  /**
   * Maps the definition's result to what this mount ends with, composing
   * every `map` applied since it was issued.
   *
   * @internal
   */
  readonly resolve: (result: Source) => Msg;
}

/**
 * Any issued mount.
 */
export type Any = Issued<never, never, Element, never>;

/**
 * The result of a mount's definition, before any `map`.
 */
export type Result<M> =
  M extends Definition<infer _Args, infer A, infer _Node, infer _R>
    ? A
    : M extends Issued<infer _Msg, infer _R, infer _Node, infer Source>
      ? Source
      : never;

/**
 * The args struct a definition is issued with.
 */
export type Args<D> =
  // oxlint-disable-next-line eslint/no-shadow -- Args is the mount args-struct name throughout; the infer binding is intentional.
  D extends Definition<infer Args, infer _A, infer _Node, infer _R>
    ? Args
    : never;

const identity = (result: never): never => result;

const Proto = {
  [TypeId]: TypeId,
  pipe(...args: unknown[]) {
    // SAFETY: pipeArguments only reads length and indices; an array satisfies its IArguments use.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- pipeArguments takes IArguments; the forwarded rest array has no single-step assertion to it.
    return Pipeable.pipeArguments(this, args as unknown as IArguments);
  },
};

interface Fields {
  readonly name: string;
  readonly args: unknown;
  readonly argsSchema: Schema.Top;
  readonly stream: boolean;
  readonly run: Issued<never, never, never, never>["run"];
  readonly resolve: (result: never) => never;
}

const makeIssued = (fields: Fields): Any =>
  Object.assign(Object.create(Proto), fields);

// oxlint-disable-next-line eslint/no-shadow -- Args is the mount args-struct name throughout; the generic binding is intentional.
const define = <Args, A, Node, R>(
  name: string,
  options: Options<ArgsInput>,
  stream: boolean,
  run: (
    node: Node,
    args: Args,
    changes: Stream.Stream<Args>,
    send: (result: A) => Effect.Effect<void>
  ) => Effect.Effect<void, never, R>
): Factory<Args, A, Node, R> => {
  // SAFETY: args is either a Schema used directly or a fields record built into a Struct; both are Schemas.
  const argsSchema = (
    Schema.isSchema(options.args) ? options.args : Schema.Struct(options.args)
  ) as Schema.Top;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the factory takes the decoded args struct; untyped at the impl seam while Factory's call signature states the contract.
  const factory = (args: unknown = {}) =>
    makeIssued({
      args,
      argsSchema,
      name,
      resolve: identity,
      // SAFETY: the mount body's full signature (node, args, changes, send) upcasts to the erased internal run type; the final cast pins the public Factory.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the body's full signature has no single-step assertion to the erased internal run type.
      run: run as unknown as Fields["run"],
      stream,
    });
  Object.defineProperty(factory, "name", { value: name });
  // SAFETY: factory plus the definition brand is exactly the Factory contract the overloads above state.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the assigned factory shape has no single-step assertion to the overloaded Factory type.
  return Object.assign(factory, {
    [DefinitionTypeId]: DefinitionTypeId,
    args: argsSchema,
  }) as unknown as Factory<Args, A, Node, R>;
};

/**
 * Whether `u` is an issued mount.
 */
export const isMount = (u: unknown): u is Any =>
  Predicate.hasProperty(u, TypeId);

/**
 * Whether `u` is a mount definition.
 */
export const isDefinition = (u: unknown): u is AnyDefinition =>
  Predicate.hasProperty(u, DefinitionTypeId);

/**
 * Defines a mount: once-per-element work that ends with one result. The body
 * runs once per element, after it commits, in a Scope that closes when the
 * element goes. It gets the host node, the args the element had when the
 * mount started, and a `changes` Stream that starts with the current args
 * and gives each new one when a render's args differ by the args Schema's
 * equivalence. A reader that falls behind gets only the latest.
 *
 * The body's requirements join those of the component that renders it. When
 * there is nothing to report, end with `Component.noop`: the log records
 * the body's completion as `MountEnded` with `silent: true` instead of an
 * `Update`.
 *
 * Args with no real Schema, such as a callback or a class instance, need
 * `Schema.declare` or `Schema.Any`. They then compare by identity and show
 * in the log as a placeholder.
 */
export const make = <
  const Name extends string,
  const In extends ArgsInput,
  A,
  Node extends Element = Element,
  R = never,
>(
  name: Name,
  options: Options<In>,
  run: (
    node: Node,
    args: ArgsOf<In>,
    changes: Stream.Stream<ArgsOf<In>>
  ) => Effect.Effect<A, never, R>
): Factory<ArgsOf<In>, A, Node, R> =>
  define(name, options, false, (node, args, changes, send) =>
    Effect.flatMap(run(node, args, changes), send)
  );

/**
 * Defines a mount that sends a result for each value of a Stream, for as
 * long as its element lives. As `make`, but the body returns a Stream: each
 * value goes through the `map` of the latest render and is sent to the
 * component, and a value mapped to `Component.noop` sends nothing. The
 * Stream runs in the mount's Scope, so a listener it adds with
 * `Stream.callback` is removed when the element goes. When the Stream ends,
 * the mount sends nothing more.
 */
export const makeStream = <
  const Name extends string,
  const In extends ArgsInput,
  A,
  Node extends Element = Element,
  R = never,
>(
  name: Name,
  options: Options<In>,
  run: (
    node: Node,
    args: ArgsOf<In>,
    changes: Stream.Stream<ArgsOf<In>>
  ) => Stream.Stream<A, never, R>
): Factory<ArgsOf<In>, A, Node, R> =>
  define(name, options, true, (node, args, changes, send) =>
    Stream.runForEach(run(node, args, changes), send)
  );

/**
 * Maps what a mount ends with, to turn its own result into the component's
 * message in a view. The name and args are kept, so the log and tests still
 * see the original mount. The runtime applies the map of the latest render
 * when the mount ends, so a value the map closes over is current.
 */
export const map: {
  <A, B>(
    f: (a: A) => B
  ): <R, Node, Source>(
    self: Issued<A, R, Node, Source>
  ) => Issued<B, R, Node, Source>;
  <A, R, Node, Source, B>(
    self: Issued<A, R, Node, Source>,
    f: (a: A) => B
  ): Issued<B, R, Node, Source>;
} = dual(
  2,
  <A, R, Node, Source, B>(
    self: Issued<A, R, Node, Source>,
    f: (a: A) => B
  ): Issued<B, R, Node, Source> => {
    const { resolve } = self;
    // SAFETY: resolve composes the previous map chain with f; the erased record only pins the remapped Issued type.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the remapped record shape has no single-step assertion to the Issued type.
    return makeIssued({
      args: self.args,
      argsSchema: self.argsSchema,
      name: self.name,
      // SAFETY: the mapped resolve keeps the source-result contract; the outer cast pins the remapped Issued type.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the composed resolve closure has no single-step assertion to the erased record type.
      resolve: ((result: Source) =>
        f(resolve(result))) as unknown as Fields["resolve"],
      // SAFETY: the run body is untouched by map; only the result mapping changes, which the outer cast pins.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the untouched run body has no single-step assertion to the erased record type.
      run: self.run as unknown as Fields["run"],
      stream: self.stream,
    }) as unknown as Issued<B, R, Node, Source>;
  }
);

/**
 * Whether two issued mounts are one mount with the same args: the same name,
 * and args equal by the args Schema's equivalence. The runtime and a test
 * both decide "changed" with it.
 *
 * @internal
 */
export const sameArgs = (self: Any, that: Any): boolean => {
  if (self.name !== that.name) {
    return false;
  }
  if (self.args === that.args) {
    return true;
  }
  // SAFETY: argsSchema is always a Schema (built by define); Top erases the interface and equivalence runs structurally on the decoded args.
  return Schema.toEquivalence(self.argsSchema as Schema.Schema<unknown>)(
    self.args,
    that.args
  );
};
