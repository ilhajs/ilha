/**
 * Commands: one-shot Effects and Streams an `update` issues, owned by the
 * issuing instance. Ported from Effect UI's `command.ts`, including the
 * query-coupled options (`invalidates`, `optimistic`, `writes`,
 * `afterRefetch`), which the query runtime applies through the cache.
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { Noop } from "./component.ts";
import { isNoop, noop } from "./internal/noop.ts";
import { canonical } from "./internal/wire-ast.ts";
import type * as Query from "./query.ts";

/**
 * Identifies an issued Command.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const TypeId = "~@effect/ui/Command" as const;

/**
 * Identifies an issued Command.
 */
export type TypeId = typeof TypeId;

/**
 * Identifies a Command definition: a factory from `make` or a `Service`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const DefinitionTypeId = "~@effect/ui/Command/Definition" as const;

/**
 * Identifies a Command definition: a factory from `make` or a `Service`.
 */
export type DefinitionTypeId = typeof DefinitionTypeId;

/**
 * Identifies an `Unmatched` Command: one issued by a `Service` whose body
 * can fail, before `match`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const UnmatchedTypeId = "~@effect/ui/Command/Unmatched" as const;

/**
 * Identifies an `Unmatched` Command: one issued by a `Service` whose body
 * can fail, before `match`.
 */
export type UnmatchedTypeId = typeof UnmatchedTypeId;

/**
 * Concurrency of one Command's runs within their instance: `concurrent`
 * always starts, `switch` cuts the group's earlier runs, `queue` waits for
 * them. There is deliberately no "ignore while running" mode: keep a
 * `Submitting` state in the Model and issue nothing while it holds.
 */
export type Mode = "concurrent" | "switch" | "queue";

/**
 * The kind of an issued Command: one result (`Effect`) or one per element
 * (`Stream`).
 */
export type Kind = "Effect" | "Stream";

/**
 * The framework services a `make` Command body may need without joining the
 * component's requirements. Other slices widen this by module augmentation
 * (host refs, files, the query cache).
 */

export interface FrameworkServices {
  readonly scope: Scope.Scope;
}

/**
 * The union of {@link FrameworkServices} values. A `make` body that requires
 * anything else doesn't compile, and the error names this type.
 */
export type FrameworkService = FrameworkServices[keyof FrameworkServices];

/**
 * An args record or struct for a Command definition: field Schemas, or a
 * Struct built from them. Fields are `Schema.Schema<unknown>` rather than
 * `Schema.Any`: Effect 4 Schemas are invariant in that member, so only the
 * general schema type accepts every field Schema.
 */
export type ArgsInput =
  | Record<string, Schema.Schema<unknown>>
  | Schema.Struct<Schema.Struct.Fields>;
/** The decoded args struct a body, `interrupt` and `h.isRunning` receive. */
export type ArgsOf<In extends ArgsInput> =
  In extends Schema.Struct<Schema.Struct.Fields>
    ? In["Type"]
    : {
        readonly [K in keyof In]: In[K] extends Schema.Schema<infer T>
          ? T
          : never;
      };

/**
 * An issued Command: the definition's name, decoded args, mode and group
 * key, plus the raw work and the message mapping. The runtime runs `work`,
 * so the exit tells success from typed failure.
 *
 * `K` is the Command's kind and `S` its source service (`never` for a
 * `make` Command): `Command.afterRefetch` takes only an Effect-kind
 * `Service` Command.
 */
export interface Issued<Msg, R = never, K extends Kind = Kind, S = never> {
  readonly [TypeId]: TypeId;
  readonly _tag: K;
  /** The Effect body, or `undefined` for a Stream Command. */
  readonly effect: Effect.Effect<unknown, unknown, R> | undefined;
  /** The Stream body, or `undefined` for an Effect Command. */
  readonly stream: Stream.Stream<unknown, unknown, R> | undefined;
  readonly name: string;
  readonly mode: Mode;
  readonly groupKey: string | undefined;
  readonly args: unknown;
  readonly argsSchema: Schema.Top;
  /**
   * The service a `Service` Command resolves per run, or `undefined` for
   * `make` Commands. The runtime fails the instance when it is missing.
   *
   * @internal
   */
  readonly serviceTag?: Context.Key<never, unknown> | undefined;
  /**
   * Phantom service marker: `never` for a `make` Command, the service for a
   * `Service` Command. Never set at runtime.
   *
   * @internal
   */
  readonly _service?: S | undefined;
  /**
   * What the run invalidates when its fiber exits, however it exits.
   * Empty for `make` Commands.
   *
   * @internal
   */
  readonly invalidates: readonly Query.Target[];
  /**
   * The optimistic patches, registered when the Command is issued. Empty
   * for `make` Commands.
   *
   * @internal
   */
  readonly optimistic: readonly Query.Patch[];
  /**
   * The writes a success stores, or `undefined` without `writes`. Only a
   * `Service` Command has one, and never a Stream Command.
   *
   * @internal
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Issued.writes maps the untyped success the runtime delivers; the Success type is erased at issue.
  readonly writes: ((success: unknown) => readonly Query.Write[]) | undefined;
  /**
   * The budget given to `Command.afterRefetch`, or `undefined` when a
   * success is delivered at once.
   *
   * @internal
   */
  readonly afterRefetch: Duration.Duration | undefined;
  /**
   * Success to message. Composes every `map`.
   *
   * @internal
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Issued.resolve maps the untyped run result; Msg is the caller's contract.
  readonly resolve: (result: unknown) => Msg | Noop;
  /**
   * Typed error to message, or `undefined`. A defect, or an unmatched typed
   * failure, fails the instance.
   *
   * @internal
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Issued.reject maps the untyped failure; Msg is the caller's contract.
  readonly reject: ((error: unknown) => Msg | undefined) | undefined;
}

/**
 * An issued Command of a `Service` whose body can fail, before `match`.
 * It is not a `Command`, so `$.run` and `Command.map` reject it in the
 * types until `match` maps both channels.
 */
export interface Unmatched<
  Msg,
  Err,
  R = never,
  K extends Kind = Kind,
  S = never,
> {
  readonly [TypeId]: TypeId;
  readonly [UnmatchedTypeId]: UnmatchedTypeId;
  readonly _tag: K;
  readonly effect: Effect.Effect<unknown, unknown, R> | undefined;
  readonly stream: Stream.Stream<unknown, unknown, R> | undefined;
  readonly name: string;
  readonly mode: Mode;
  readonly groupKey: string | undefined;
  readonly args: unknown;
  readonly argsSchema: Schema.Top;
  /**
   * What the run invalidates when its fiber exits, however it exits.
   *
   * @internal
   */
  readonly invalidates: readonly Query.Target[];
  /**
   * The optimistic patches, registered when the Command is issued.
   *
   * @internal
   */
  readonly optimistic: readonly Query.Patch[];
  /**
   * The writes a success stores, or `undefined` without `writes`. Never
   * set on a Stream Command.
   *
   * @internal
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Unmatched.writes maps the untyped success the runtime delivers; the Success type is erased at issue.
  readonly writes: ((success: unknown) => readonly Query.Write[]) | undefined;
  /**
   * The budget given to `Command.afterRefetch`, or `undefined` when a
   * success is delivered at once.
   *
   * @internal
   */
  readonly afterRefetch: Duration.Duration | undefined;
  /**
   * @internal
   */
  readonly serviceTag?: Context.Key<never, unknown> | undefined;
  /**
   * Phantom service marker: `never` for a `make` Command, the service for a
   * `Service` Command. Never set at runtime.
   *
   * @internal
   */
  readonly _service?: S | undefined;
  /**
   * @internal
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Unmatched.resolve maps the untyped run result; Msg is the caller's contract.
  readonly resolve: (result: unknown) => Msg | Noop;
  /**
   * @internal
   */
  readonly reject: ((error: Err) => Msg | undefined) | undefined;
}

/**
 * Interrupts the instance's running, queued and awaiting runs of a Command
 * name, only those of the group when a pick is given. Produces no message.
 */
export interface Interrupt {
  readonly [TypeId]: TypeId;
  readonly _tag: "Interrupt";
  readonly name: string;
  readonly groupKey: string | undefined;
  readonly mode: Mode;
}

/**
 * A Command an `update` may issue: an issued Effect or Stream Command, or an
 * interrupt. A Command whose result is `never` can be run by any component.
 */
export type Command<Msg, R = never> = Issued<Msg, R> | Interrupt;

/**
 * A Command definition: a factory from `make` or a `Service` class.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+namespace pair: the interface is the definition record, the namespace its companion types.
export interface Definition {
  readonly [DefinitionTypeId]: DefinitionTypeId;
  readonly name: string;
  readonly stream: boolean;
  readonly mode: Mode;
  /**
   * The group key a `group` pick addresses, or `undefined` for every run.
   *
   * @internal
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Definition.groupOf takes the caller's group pick; unknown is the honest input.
  readonly groupOf: ((group: unknown) => string | undefined) | undefined;
}

/**
 * Types of a Command definition.
 */
// oxlint-disable-next-line typescript/no-namespace -- the namespace holds the companion types; merging it into the interface pair is the public API.
export declare namespace Definition {
  /** Any definition: what `interrupt` and `h.isRunning` take. */
  export type Any = Definition;
}

/**
 * The requirements of a Command.
 */
export type Requirements<C> = C extends Command<unknown, infer R> ? R : never;

/**
 * The message an issued Command delivers.
 */
export type Message<C> = C extends Issued<infer Msg, unknown> ? Msg : never;

/**
 * The definition's own success: what story `resolve` takes.
 */
export type Result<C> = C extends Issued<infer Msg, unknown> ? Msg : never;

/**
 * Returns `true` for an issued Command or an `Interrupt`. Unmatched Commands
 * also carry the type id.
 */
export const isCommand = (u: unknown): u is Command<unknown, unknown> =>
  Predicate.hasProperty(u, TypeId);

/**
 * Returns `true` for an `Unmatched` Command: one issued by a `Service`
 * whose body can fail, before `match`.
 */
export const isUnmatched = (
  u: unknown
): u is Unmatched<unknown, unknown, unknown> =>
  Predicate.hasProperty(u, UnmatchedTypeId);

/**
 * Returns `true` for a Command definition: a factory from `make` or a
 * `Service` class.
 */
export const isDefinition = (u: unknown): u is Definition.Any =>
  Predicate.hasProperty(u, DefinitionTypeId);

/**
 * The name of a Command definition: the factory's name, or the service's key.
 */
// SAFETY: keyed definitions carry a string key and factories a name; the casts only read those brand records.
export const nameOf = (definition: Definition.Any): string =>
  Context.isKey(definition)
    ? // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the keyed definition shape has no single-step assertion to the key record.
      (definition as unknown as { readonly key: string }).key
    : // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the factory shape has no single-step assertion to the name record.
      (definition as unknown as { readonly name: string }).name;

/**
 * The group key a definition's `group` pick addresses, or `undefined` for
 * every run of it.
 *
 * @internal
 */
export const groupKeyOf = (
  definition: Definition.Any,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- groupKeyOf takes the caller's group pick; unknown is the honest input.
  group: unknown
): string | undefined =>
  group === undefined ? undefined : definition.groupOf?.(group);

/** The normalized args struct a definition decodes with. */
export type ArgsStruct = Schema.Struct<Schema.Struct.Fields>;
// SAFETY: isSchema proves args is a Struct; otherwise it is the fields record the Struct constructor takes.
const argsSchemaOf = (args: ArgsInput): ArgsStruct =>
  Schema.isSchema(args)
    ? (args as ArgsStruct)
    : Schema.Struct(args as Schema.Struct.Fields);

/**
 * A Command's group key builder. Throws at definition time when a group
 * field is not among the args.
 */
const makeGroupOf = (
  name: string,
  schema: ArgsStruct,
  group: readonly string[]
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the returned closure takes the caller's group pick; unknown is the honest input.
): ((group: unknown) => string | undefined) | undefined => {
  if (group.length === 0) {
    return undefined;
  }
  const fields: Record<string, Schema.Any> = {};
  for (const field of group) {
    if (!Object.hasOwn(schema.fields, field)) {
      throw new Error(
        `${name}: the group field "${field}" isn't one of its args`
      );
    }
    // SAFETY: the hasOwn check proves the field is one of the schema's; the cast only names its schema type.
    fields[field] = schema.fields[field] as Schema.Any;
  }
  const pickSchema = Schema.Struct(fields);
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- encode passes the picked group record through the codec; unknown is the honest boundary type.
  let encode: ((u: unknown) => unknown) | undefined;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the closure takes the issued args record; unknown is the honest input.
  return (args: unknown) => {
    if (encode === undefined) {
      encode = Schema.encodeUnknownSync(Schema.toCodecJson(pickSchema));
    }
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the picked group record is heterogeneous by construction; the pick schema states the contract.
    const picked: Record<string, unknown> = {};
    // SAFETY: factory args are the decoded struct or an empty record; the cast only reads the group fields the schema selected.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the issued args record is heterogeneous; the args schema states the contract.
    const source = (args ?? {}) as Record<string, unknown>;
    for (const field of group) {
      if (Object.hasOwn(source, field)) {
        picked[field] = source[field];
      }
    }
    // SAFETY: the codec encodes the picked record to a stable JSON value; the cast only names the canonical string form.
    return canonical(encode(picked)) as string;
  };
};

interface IssuedFields {
  readonly _tag: Kind;
  readonly effect: Effect.Effect<unknown, unknown, never> | undefined;
  readonly stream: Stream.Stream<unknown, unknown, never> | undefined;
  readonly name: string;
  readonly mode: Mode;
  readonly groupKey: string | undefined;
  readonly args: unknown;
  readonly argsSchema: Schema.Top;
  readonly serviceTag?: Context.Key<never, unknown> | undefined;
  readonly invalidates: readonly Query.Target[];
  readonly optimistic: readonly Query.Patch[];
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the erased writes record maps the untyped success; Issued states the contract.
  readonly writes: ((success: unknown) => readonly Query.Write[]) | undefined;
  readonly afterRefetch: Duration.Duration | undefined;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the erased resolve record maps the untyped result; Issued states the contract.
  readonly resolve: (result: unknown) => unknown;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the erased reject record maps the untyped failure; Issued states the contract.
  readonly reject: ((error: unknown) => unknown) | undefined;
}

const makeIssued = (
  fields: IssuedFields,
  unmatched: boolean
): Issued<never, never> => {
  const issued = {
    [TypeId]: TypeId,
    ...fields,
  };
  // SAFETY: makeIssued only attaches brand markers to the fully built record; the cast only names the issued Command type.
  return (
    unmatched ? { ...issued, [UnmatchedTypeId]: UnmatchedTypeId } : issued
  ) as Issued<never, never>;
};

/**
 * Options for `Command.make` and `Command.Service`.
 */
export interface Options<In extends ArgsInput> {
  /** The args Schema. Encoded for the log. */
  readonly args: In;
  /** Concurrency within the instance's group. Default `"concurrent"`. */
  readonly mode?: Mode | undefined;
  /**
   * The args fields the group key is built from. Without it, all runs of
   * the Command in one instance form one group.
   */
  readonly group?: readonly string[] | undefined;
  /** Whether the body is a Stream. Default `false`. */
  readonly stream?: boolean | undefined;
}

/** Options for a `Service` definition. */
export interface ServiceOptions<
  In extends ArgsInput,
  Success,
  Err,
> extends Options<In> {
  /** The success Schema. */
  readonly success: Schema.Schema<Success>;
  /** The typed error Schema. Default `Schema.Never`. */
  readonly error?: Schema.Schema<Err> | undefined;
  /**
   * What a run invalidates, from the args only, so it is known at issue.
   * Applied on every exit of a started run. Omitting it invalidates nothing.
   */
  readonly invalidates?:
    | ((args: ArgsOf<In>) => readonly Query.Target[])
    | undefined;
  /** The optimistic patches, registered at issue. */
  readonly optimistic?:
    | ((args: ArgsOf<In>) => readonly Query.Patch[])
    | undefined;
  /**
   * The writes a success stores. Takes the success and the args. Not
   * allowed with `stream: true`.
   */
  readonly writes?:
    | ((success: Success, args: ArgsOf<In>) => readonly Query.Write[])
    | undefined;
}

/** A factory from `Command.make`: call it (or its `make`) with the args to issue a Command. */
export interface Factory<
  Name extends string,
  Args,
  Msg,
  R = never,
  K extends Kind = Kind,
> extends Definition {
  (
    // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- {} extends Args probes for no required args; the empty object type is the correct probe.
    ...args: {} extends Args ? readonly [args?: Args] : readonly [args: Args]
  ): Issued<Msg, R, K>;
  /** The same issue function, for call sites that prefer a method. */
  readonly make: (
    // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- {} extends Args probes for no required args; the empty object type is the correct probe.
    ...args: {} extends Args ? readonly [args?: Args] : readonly [args: Args]
  ) => Issued<Msg, R, K>;
  readonly name: Name;
  readonly argsSchema: ArgsStruct;
}

/**
 * Defines a Command that needs nothing beyond the framework services: an
 * Effect, or with `stream: true` a Stream. The body can't fail; if it
 * requires a non-framework service, it doesn't compile. The body Effect is
 * built when the factory is called, at issue time.
 */
export const make: {
  <
    const Name extends string,
    const In extends ArgsInput,
    Msg,
    R extends FrameworkService = never,
  >(
    name: Name,
    options: Options<In> & { readonly stream?: false | undefined },
    body: (args: ArgsOf<In>) => Effect.Effect<Msg, never, R>
  ): Factory<Name, ArgsOf<In>, Msg, R, "Effect">;
  <
    const Name extends string,
    const In extends ArgsInput,
    Msg,
    R extends FrameworkService = never,
  >(
    name: Name,
    options: Options<In> & { readonly stream: true },
    body: (args: ArgsOf<In>) => Stream.Stream<Msg, never, R>
  ): Factory<Name, ArgsOf<In>, Msg, R, "Stream">;
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the dual overloads are the public contract; inference would collapse them.
} = (
  name: string,
  options: Options<ArgsInput>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the dual impl signature is untyped by design; the overloads above state the contract.
  body: (args: unknown) => unknown
  // oxlint-disable-next-line typescript/no-explicit-any -- the documented dual impl boundary: the impl satisfies the generic overloads above.
): any => {
  const stream = options.stream === true;
  const mode = options.mode ?? "concurrent";
  const argsSchema = argsSchemaOf(options.args);
  const groupOf = makeGroupOf(name, argsSchema, options.group ?? []);
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the factory takes the decoded args struct; untyped at the impl seam while Factory's overloads state the contract.
  const issue = (args: unknown = {}) => {
    // Factory args are Type-side values (`ArgsOf`), so check the Type side:
    // `decodeUnknownSync` would reject a transforming field's decoded form
    // (such as `NumberFromString`'s `number`).
    Schema.asserts(argsSchema, args);
    const issued = body(args);
    return makeIssued(
      {
        _tag: stream ? "Stream" : "Effect",
        afterRefetch: undefined,
        args,
        // SAFETY: argsSchema is the normalized struct every definition decodes with; the cast only names the Top form the record stores.
        argsSchema: argsSchema as Schema.Top,
        // SAFETY: the Effect body is untouched by issuing; the cast only names the erased effect record.
        effect: (stream ? undefined : issued) as IssuedFields["effect"],
        groupKey: groupOf?.(args),
        invalidates: [],
        mode,
        name,
        optimistic: [],
        reject: undefined,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the issue closure forwards the untyped run result; Msg is the caller's contract.
        resolve: (result: unknown) => result,
        // SAFETY: a Stream issue carries the stream body and an Effect issue none; the cast only names the erased stream record.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the conditional body has no single-step assertion to the erased stream record.
        stream: (stream
          ? issued
          : undefined) as unknown as IssuedFields["stream"],
        writes: undefined,
      },
      false
    );
  };
  // `name` is read-only on functions: assigning it (notably through
  // `Object.assign`) throws, so it goes through `defineProperty`.
  Object.assign(issue, {
    [DefinitionTypeId]: DefinitionTypeId,
    argsSchema,
    groupOf,
    make: issue,
    mode,
    stream,
  });
  Object.defineProperty(issue, "name", { configurable: true, value: name });
  return issue;
};

/**
 * A Command `Service`: a `Context` tag plus a definition, with `toLayer`
 * and `make`. `make` returns an `Unmatched` Command when the error isn't
 * `never`. Like `Query.Service`, the definition call returns a real class
 * extending the `Context` tag, so subclasses get `toLayer` and `make` as
 * statics.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+const pair: the interface is the service contract, the const its factory.
export interface Service<Self, Args, Success, Err, IsStream extends boolean>
  extends
    Context.ServiceClass<Self, string, (args: Args) => unknown>, // oxlint-disable-line anti-slop/no-unknown-returns -- the service body returns untyped output the runtime maps; Success is the caller's contract.
    Definition {
  /** Issue the Command with the args: an `Unmatched` Command when it can fail. */
  readonly make: (
    // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- {} extends Args probes for no required args; the empty object type is the correct probe.
    ...args: {} extends Args ? readonly [args?: Args] : readonly [args: Args]
  ) => [Err] extends [never]
    ? Issued<Success, Self>
    : Unmatched<Success, Err, Self>;
  readonly argsSchema: ArgsStruct;
  readonly stream: IsStream;
  /** Build the implementation layer from a function or an Effect. */
  readonly toLayer: (
    implementation:
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- the implementation returns untyped output the runtime maps; Success is the caller's contract.
      | ((args: Args) => unknown)
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- the implementation Effect resolves to untyped output; Success is the caller's contract.
      | Effect.Effect<(args: Args) => unknown>
  ) => Layer.Layer<Self>;
}

/**
 * Defines a shared Command behind a service: I/O lives in `toLayer`, tests
 * fake it with another `toLayer`. Each issued run resolves the service and
 * applies it to the args. A run whose service is missing fails the instance.
 */
type ServiceConstructor = <Self>() => {
  <const Key extends string, const In extends ArgsInput, Success, Err = never>(
    key: Key,
    options: ServiceOptions<In, Success, Err> & {
      readonly stream?: false | undefined;
    }
  ): Service<Self, ArgsOf<In>, Success, Err, false>;
  <const Key extends string, const In extends ArgsInput, Success, Err = never>(
    key: Key,
    options: ServiceOptions<In, Success, Err> & {
      readonly stream: true;
      readonly writes?: undefined;
    }
  ): Service<Self, ArgsOf<In>, Success, Err, true>;
};

const serviceConstructor =
  <Self>() =>
  (key: string, options: ServiceOptions<ArgsInput, unknown, unknown>) => {
    const stream = options.stream === true;
    const mode = options.mode ?? "concurrent";
    const argsSchema = argsSchemaOf(options.args);
    const groupOf = makeGroupOf(key, argsSchema, options.group ?? []);
    if (stream && options.writes !== undefined) {
      throw new Error(
        `${key}: writes is only for Effect Commands, never a Stream Command`
      );
    }
    // SAFETY: Never is the bottom schema marking a Command that cannot fail; the cast only compares the error schema identity.
    const unmatched =
      options.error !== undefined &&
      options.error !== (Schema.Never as unknown);
    // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the Context service body takes untyped args and returns untyped output; Args and Success are the caller's contract.
    const Base = Context.Service<Self, (args: unknown) => unknown>()(key);
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the issue closure takes the decoded args struct; untyped at the impl seam while Service.make states the contract.
    const issue = (args: unknown = {}) => {
      // Factory args are Type-side values (`ArgsOf`): check them like `make`
      // does, so transforming fields keep their decoded form.
      Schema.asserts(argsSchema, args);
      // Each issued run resolves the service, so layers and fakes swap freely.
      // SAFETY: the service call returns the body's Effect; the cast only names the untyped Effect the record stores.
      const run = Effect.flatMap(
        // oxlint-disable-next-line eslint/no-use-before-define, unicorn/no-array-method-this-argument -- Svc is referenced inside deferred run closures while its statics need issue and toLayer first; Effect.flatMap takes the service tag, not an Array thisArg.
        Svc,
        (service) => service(args) as Effect.Effect<unknown>
      );
      // SAFETY: the service call returns the body's Stream; the cast only names the untyped Stream the record stores.
      const unwrapped = Stream.unwrap(
        // oxlint-disable-next-line eslint/no-use-before-define, unicorn/no-array-method-this-argument -- Svc is referenced inside deferred run closures while its statics need issue and toLayer first; Effect.map takes the service tag, not an Array thisArg.
        Effect.map(Svc, (service) => service(args) as Stream.Stream<unknown>)
      );
      return makeIssued(
        {
          _tag: stream ? "Stream" : "Effect",
          afterRefetch: undefined,
          args,
          // SAFETY: argsSchema is the normalized struct every definition decodes with; the cast only names the Top form the record stores.
          argsSchema: argsSchema as Schema.Top,
          // SAFETY: the run body is untouched by issuing; the cast only names the erased effect record.
          effect: (stream ? undefined : run) as IssuedFields["effect"],
          groupKey: groupOf?.(args),
          // SAFETY: invalidates is computed from the decoded args; the casts only recover the args and target types the record stores.
          invalidates: (options.invalidates?.(args as never) ??
            []) as readonly Query.Target[],
          mode,
          name: key,
          // SAFETY: optimistic is computed from the decoded args; the casts only recover the args and patch types the record stores.
          optimistic: (options.optimistic?.(args as never) ??
            []) as readonly Query.Patch[],
          reject: undefined,
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the issue closure forwards the untyped run result; Msg is the caller's contract.
          resolve: (result: unknown) => result,
          // SAFETY: the service tag brands every run of this definition; the cast only names the key form the record stores.
          // oxlint-disable-next-line eslint/no-use-before-define, anti-slop/no-chained-type-assertions -- Svc's statics need issue and toLayer first, so the class comes after its uses in deferred closures; the tag shape has no single-step assertion to the key type.
          serviceTag: Svc as unknown as Context.Key<never, unknown>,
          // SAFETY: a Stream issue carries the unwrapped body and an Effect issue none; the cast only names the erased stream record.
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the conditional body has no single-step assertion to the erased stream record.
          stream: (stream
            ? unwrapped
            : undefined) as unknown as IssuedFields["stream"],
          // SAFETY: writes maps the delivered success with the issued args; the cast only recovers the writes signature the record stores.
          writes:
            options.writes === undefined
              ? undefined
              : // oxlint-disable-next-line anti-slop/no-unknown-parameters -- writes maps the untyped success the runtime delivers; Success is the caller's contract.
                (success: unknown) =>
                  (
                    options.writes as (
                      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the writes signature takes the untyped delivered success; Success is the caller's contract.
                      success: unknown,
                      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the writes signature takes the issued args record; Args is the caller's contract.
                      args: unknown
                    ) => readonly Query.Write[]
                  )(success, args),
        },
        unmatched
      );
    };
    const toLayer = (
      implementation:
        // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the implementation function takes untyped args and returns untyped output; Success is the caller's contract.
        | ((args: unknown) => unknown)
        // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the implementation Effect resolves to untyped output of an untyped args function; Success is the caller's contract.
        | Effect.Effect<(args: unknown) => unknown>
    ): Layer.Layer<Self, never, never> =>
      Effect.isEffect(implementation)
        ? // oxlint-disable-next-line eslint/no-use-before-define -- Svc's statics need issue and toLayer first, so the class comes after its uses in deferred closures.
          Layer.effect(Svc, implementation)
        : // oxlint-disable-next-line eslint/no-use-before-define -- Svc's statics need issue and toLayer first, so the class comes after its uses in deferred closures.
          Layer.succeed(Svc, implementation);
    // A real class extending the `Context` tag, like `Query.Service`: subclass
    // statics carry the definition, so `class X extends Command.Service...`
    // typechecks and `X.make`/`X.toLayer` resolve. `name` is read-only on
    // functions and classes, so it goes through `defineProperty`.
    class Svc extends Base {
      static readonly [DefinitionTypeId] = DefinitionTypeId;
      static readonly stream = stream;
      static readonly mode = mode;
      static readonly groupOf = groupOf;
      static readonly argsSchema = argsSchema;
      static readonly make = issue;
      static readonly toLayer = toLayer;
    }
    Object.defineProperty(Svc, "name", { configurable: true, value: key });
    // SAFETY: the class carries the Context tag plus the definition statics; the cast only names the Service type the factory returns.
    // oxlint-disable-next-line eslint/no-use-before-define, anti-slop/no-chained-type-assertions -- Svc is defined above but the rule sees the class after closure uses; the class shape has no single-step assertion to the Service type.
    return Svc as unknown as Service<Self, unknown, unknown, unknown, boolean>;
  };
/**
 * Defines a shared Command behind a service: `Service<Self>()(key,
 * options)` declares the args, success and error, and the implementation
 * comes from `toLayer`. See {@link Service} for the definition type.
 */
// SAFETY: serviceConstructor builds the full Service class; the cast only names the constructor type the export declares.
export const Service: ServiceConstructor =
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the constructed class has no single-step assertion to the ServiceConstructor type.
  serviceConstructor as unknown as ServiceConstructor;

/**
 * Maps an issued Command's success channel to messages, keeping its name,
 * args, options and requirements. After `match`, the failure message is
 * mapped too. The data-first form leaves an `Interrupt` unchanged.
 */
export const map: {
  <A, B>(
    f: (a: A) => B
  ): <R, K extends Kind, S>(self: Issued<A, R, K, S>) => Issued<B, R, K, S>;
  <C extends Command<unknown, unknown>, B>(
    self: C,
    f: (a: Message<C>) => B
  ): Mapped<C, B>;
} = dual(
  2,
  (
    self: Command<unknown, unknown>,
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- the dual impl seam is untyped by design; the overloads above state the contract.
    f: (a: never) => unknown
  ): Command<unknown, unknown> => {
    if (self._tag === "Interrupt") {
      return self;
    }
    // SAFETY: an issued Command carries the full fields record; the cast only recovers the erased record the mapping rebuilds.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the issued Command shape has no single-step assertion to the erased fields record.
    const fields = self as unknown as IssuedFields;
    return makeIssued(
      {
        ...fields,
        reject:
          fields.reject === undefined
            ? undefined
            : (error) =>
                f(
                  // SAFETY: reject maps the typed failure through f; the cast only recovers the failure signature the record stores.
                  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the stored reject signature takes the untyped failure; the message mapping is the caller's contract.
                  (fields.reject as (error: unknown) => unknown)(error) as never
                ),
        // SAFETY: resolve maps the delivered result through f; the cast only names the message type the mapping produces.
        resolve: (result) => f(fields.resolve(result) as never),
      },
      // oxlint-disable-next-line anti-slop/no-known-value-widening -- self is already the Command union the guard discriminates; the guard takes unknown by design.
      isUnmatched(self)
    );
  }
);

/**
 * An issued Command with its message type replaced by `B`: `Interrupt`
 * stays an `Interrupt`, anything else an issued Command.
 */
export type Mapped<C, B> = C extends Interrupt
  ? Interrupt
  : C extends Unmatched<unknown, infer Err, infer R, infer K, infer S>
    ? Unmatched<B, Err, R, K, S>
    : C extends Issued<unknown, infer R, infer K, infer S>
      ? Issued<B, R, K, S>
      : never;

/**
 * Replaces each message a Command produces with the supplied value. A Stream
 * Command emits the same value for every element. After `match`, both
 * channels are replaced.
 */
export const as: {
  <B>(
    message: B
  ): <A, R, K extends Kind, S>(self: Issued<A, R, K, S>) => Issued<B, R, K, S>;
  <C extends Command<unknown, unknown>, B>(self: C, message: B): Mapped<C, B>;
} = dual(
  2,
  (
    self: Command<unknown, unknown>,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the data-first impl takes the caller's message value of any type; unknown is the honest input.
    message: unknown
  ): Command<unknown, unknown> =>
    // SAFETY: as replaces every message with the fixed value; the cast only names the caller's Command type.
    map(self, () => message) as Command<unknown, unknown>
);

/**
 * Makes a Command send nothing when it finishes: every result is replaced
 * with `Component.noop`, so the run ends with no message and the log records
 * it silent. Takes issued Commands only, never an `Unmatched` one, so a
 * typed failure can't be dropped by accident.
 */
export const asNoop = <C extends Command<unknown, unknown>>(
  self: C
): Mapped<C, Noop> => {
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- self is already the Command union the guard discriminates; the guard takes unknown by design.
  if (isUnmatched(self)) {
    throw new Error(
      "Command.asNoop takes an issued Command, never an Unmatched one: map the typed failure with Command.match first"
    );
  }
  // SAFETY: the Command is issued (never Unmatched, checked above), so replacing messages keeps its requirements; the cast only names the caller's mapped type.
  return as(self, noop) as Mapped<C, Noop>;
};

/**
 * Maps both channels of an `Unmatched` Command to messages. `onSuccess` maps
 * the body's success or each Stream element; `onFailure` maps the typed
 * failure, which ends a Stream Command. Defects and interrupts are not
 * mapped. Using `match` on a Command that can't fail doesn't compile.
 */
export const match: {
  <A, E, B, C, K extends Kind, S>(options: {
    readonly onSuccess: (success: A) => B;
    readonly onFailure: (error: E) => C;
  }): <R>(self: Unmatched<A, E, R, K, S>) => Issued<B | C, R, K, S>;
  <A, E, R, B, C, K extends Kind, S>(
    self: Unmatched<A, E, R, K, S>,
    options: {
      readonly onSuccess: (success: A) => B;
      readonly onFailure: (error: E) => C;
    }
  ): Issued<B | C, R, K, S>;
} = dual(
  2,
  (
    self: Unmatched<unknown, unknown, unknown>,
    options: {
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- the dual impl seam is untyped by design; the overloads above state the contract.
      readonly onSuccess: (success: never) => unknown;
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- the dual impl seam is untyped by design; the overloads above state the contract.
      readonly onFailure: (error: never) => unknown;
    }
  ): Issued<unknown, unknown> => {
    // SAFETY: an Unmatched Command carries the full fields record; the cast only recovers the erased record the mapping rebuilds.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the unmatched Command shape has no single-step assertion to the erased fields record.
    const fields = self as unknown as IssuedFields;
    return makeIssued(
      {
        ...fields,
        // SAFETY: onFailure maps the typed failure the match contract names; the cast only recovers the failure value.
        reject: (error) => options.onFailure(error as never),
        // SAFETY: onSuccess maps the delivered result through the stored resolve; the cast only names the success value the contract maps.
        resolve: (result) => options.onSuccess(fields.resolve(result) as never),
      },
      false
    );
  }
);
/**
 * Holds a Command's success message until the entries its run invalidated
 * have refetched, or until `budget` runs out. Only for an Effect-kind
 * `Service` Command, on either side of `map` and `match`; a Stream or
 * `make` Command doesn't compile. Applying it twice replaces the first.
 *
 * The wait covers everything the run invalidated (declared targets plus
 * those implied by patches), minus the entries its own `writes` stored
 * fresh. Of those, it waits for the entries that have a watcher, and an
 * entry's wait ends when it has no refetch in flight and none owed. A
 * typed failure is delivered at once; a run cut by the budget, by `switch`
 * or by `Command.interrupt` delivers its success at once, and its refetches
 * run on. `h.isRunning` stays true through the wait.
 */
export const afterRefetch: {
  (
    budget: Duration.Input
  ): <C extends Awaitable>(self: C & AwaitsRefetch<C>) => C;
  <C extends Awaitable>(self: C & AwaitsRefetch<C>, budget: Duration.Input): C;
} = dual(
  2,
  (self: Awaitable, budget: Duration.Input): Awaitable =>
    // SAFETY: holding the success only swaps the delivery timing, not the Command; the cast only names the caller's awaitable type.
    makeIssued(
      {
        // SAFETY: spreading the issued record preserves every field afterRefetch leaves untouched; the cast only recovers the erased fields record.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the awaitable shape has no single-step assertion to the erased fields record.
        ...(self as unknown as IssuedFields),
        afterRefetch: Duration.fromInputUnsafe(budget),
      },
      // oxlint-disable-next-line anti-slop/no-known-value-widening -- self is already the awaitable union the guard discriminates; the guard takes unknown by design.
      isUnmatched(self)
    ) as Awaitable
);

/**
 * An issued or unmatched Effect-kind Command of a `Service`: what
 * `Command.afterRefetch` takes.
 */
export type Awaitable =
  | Issued<unknown, unknown, Kind, unknown>
  | Unmatched<unknown, unknown, unknown, Kind, unknown>;

/**
 * Passes when `C` is an issued or unmatched Effect-kind `Service` Command,
 * and otherwise says why `Command.afterRefetch` doesn't take it.
 */
export type AwaitsRefetch<C> =
  C extends Unmatched<infer _A, infer _E, infer _R, infer K, infer S>
    ? AwaitsRefetchOf<K, S>
    : C extends Issued<infer _Msg, infer _R, infer K, infer S>
      ? AwaitsRefetchOf<K, S>
      : never;

type AwaitsRefetchOf<K, S> = [K] extends ["Effect"]
  ? [S] extends [never]
    ? {
        readonly "Command.afterRefetch takes a Command.Service Command. A Command.make Command invalidates nothing": never;
      }
    : unknown
  : {
      readonly "Command.afterRefetch takes an Effect Command. A Stream Command has no final message to hold": never;
    };

/**
 * Interrupts the instance's running, queued and awaiting runs of a Command
 * name, only those of the group when a pick is given. Produces no message.
 * An interrupted run dispatches nothing but still holds its group until its
 * fiber exits.
 */
export const interrupt = (
  definition: Definition.Any,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- interrupt takes the caller's group pick; unknown is the honest input.
  group?: unknown
): Interrupt => ({
  [TypeId]: TypeId,
  _tag: "Interrupt",
  groupKey: groupKeyOf(definition, group),
  mode: definition.mode,
  name: nameOf(definition),
});

/** Whether a Command result was explicitly silenced with `asNoop`. */
export const isSilent = (message: unknown): message is Noop => isNoop(message);
