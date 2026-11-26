import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
/**
 * Features: components a parent refers to by service instead of by value, so
 * the implementation can be swapped with a Layer.
 *
 * A feature service holds the contract: the Props and Events Schemas. The
 * app provides an implementation with `Todos.toLayer(TodoList)`, a test
 * provides a fake the same way. A parent renders it with
 * `Todos.render(h, ...)` and requires `Todos` only: the implementation's
 * requirements close where the feature's Layer is built.
 */
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import type { View } from "ilha";
import { getFiber } from "ilha/internal";

import type { ModelComponent } from "./component.ts";
import { TypeId as ComponentTypeId } from "./component.ts";
import {
  recordOfCaller,
  renderModelComponent,
  resolveEnv,
} from "./internal/kernel.ts";
import {
  FailedLayer,
  PendingLayer,
  ProvideSpecs,
} from "./internal/layer-run.ts";
import type { ProvideSpec } from "./internal/layer-run.ts";

/**
 * Identifies a feature service.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const TypeId = "~@ilha/model/Feature" as const;

/**
 * Identifies a feature service.
 */
export type TypeId = typeof TypeId;

/**
 * The value behind a feature service: a closed component.
 *
 * `context` is the Context the feature's Layer was built with, minus `Scope`,
 * which closes the implementation's requirements. It isn't an instance, so
 * Layer memoisation is harmless and every child still gets its own instance,
 * Model and Scope.
 */
export interface Implementation<Props, Events> {
  readonly component: ModelComponent<Props, never, never, Events>;
  readonly context: Context.Context<never>;
}

/**
 * Options for `Service.render`: a child of the feature in a parent's view.
 * `fallback` is required: the service may be building (`Initial`) or failed
 * (`Failure`).
 */
export interface RenderOptions<Props, Events> {
  readonly key?: string | undefined;
  readonly props: Props;
  readonly onEmit?:
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- emit callbacks' returns are ignored; unknown is the honest type.
    | ((event: Events) => unknown)
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- emit callbacks' returns are ignored; unknown is the honest type.
    | Readonly<Record<string, (event: never) => unknown>>
    | undefined;
  readonly onFailure?:
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- failure callbacks' returns are ignored; unknown is the honest type.
    ((failure: AsyncResult.Failure<never, unknown>) => unknown) | undefined;
  readonly fallback: (
    result:
      | AsyncResult.Initial<never, unknown>
      | AsyncResult.Failure<never, unknown>
  ) => View;
  /** A feature takes no slots: its implementation may not declare them. */
  readonly slots?: never | undefined;
}

/**
 * A feature service class, as returned by `Service`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+const pair: the interface is the service contract, the const its factory.
export interface Service<
  in out Self,
  in out Props,
  in out Events,
> extends Context.Key<Self, Implementation<Props, Events>> {
  readonly [TypeId]: { readonly name: string };
  /** The Props Schema. The log encodes a feature's props with it. */
  readonly props: Schema.Codec<Props, unknown>;
  /** The Events Schema. */
  readonly events: Schema.Codec<Events, unknown>;
  /**
   * Declares a child of this feature in a parent's view, from the parent's
   * `h`. The parent requires the service only. `fallback` is required.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- render takes the parent's h helper; its exact type varies by host, so the seam is untyped.
  render: (h: unknown, options: RenderOptions<Props, Events>) => View;
  /**
   * Provides this feature with `component`. The Layer requires whatever the
   * component requires, and closes it where the Layer is built.
   */
  toLayer: <Msg, R>(
    component: ModelComponent<Props, Msg, R, Events>
  ) => Layer.Layer<Self, never, R>;
}

/**
 * Any feature service.
 */
export type Any = Service<never, never, never>;

/**
 * Returns `true` if `u` is a feature service.
 */
export const isService = (u: unknown): u is Any =>
  Predicate.hasProperty(u, TypeId);

/**
 * One wrapper per feature value: each Layer build resolves to a fresh
 * `{ component, context }` object, so a second build gets its own wrapper
 * closing over its own context instead of reusing the first build's. A
 * `WeakMap` drops wrappers whose feature value is gone, so the table cannot
 * grow without bound.
 */
const wrappers = new WeakMap<
  object,
  ModelComponent<never, never, never, never>
>();

const wrapperFor = (
  feature: Any,
  impl: Implementation<never, never>
): ModelComponent<never, never, never, never> => {
  const found = wrappers.get(impl);
  if (found !== undefined) {
    return found;
  }
  type HolderByTypeId = Record<
    string | symbol,
    { readonly name: string } | undefined
  >;
  // SAFETY: holders only reads the brand's name to name the wrapper; the service class always carries it (thrown otherwise).
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the service class shape has no single-step assertion to the brand record.
  const holders = feature as unknown as HolderByTypeId;
  const holder = holders[TypeId];
  if (holder === undefined) {
    throw new Error("A feature service needs its type id to name its wrapper");
  }
  const { name } = holder;
  // SAFETY: component is the impl's closed ModelComponent; the cast only recovers its definition/implementation records for wrapping.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the closed component shape has no single-step assertion to the definition record.
  const component = impl.component as unknown as {
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the wrapped definition record is heterogeneous; the component's own Definition states the contract.
    readonly definition: Record<string, unknown>;
    readonly definitionName: string;
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the wrapped implementation record is heterogeneous; the component's own types state the contract.
    readonly implementation: Record<string | symbol, unknown>;
  };
  // SAFETY: definition spreads the impl's own definition and only overrides the wrapper name.
  const definition = { ...(component.definition as object), name };
  const spec: ProvideSpec = {
    // SAFETY: impl.context is the built Layer's Context minus Scope; the erased Layer type only pins the ProvideSpec record.
    build: () =>
      Layer.succeedContext(
        impl.context as Context.Context<unknown>
      ) as Layer.Layer<unknown, unknown, unknown>,
    key: undefined,
    layerOfKey: undefined,
    local: true,
    onFailure: undefined,
  };
  // SAFETY: implementation spreads the impl's own implementation and only appends the feature's ProvideSpec.
  const implementation = {
    ...(component.implementation as object),
    // SAFETY: the existing ProvideSpecs entry is read structurally and extended with the feature's spec; both casts only recover the record shapes.
    [ProvideSpecs]: [
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the existing ProvideSpecs entry is read structurally; ProvideSpec states the contract.
      ...(((component.implementation as Record<string | symbol, unknown>)[
        ProvideSpecs
      ] as readonly ProvideSpec[]) ?? []),
      spec,
    ],
  };
  // SAFETY: the wrapper only re-invokes the impl's component on its own fiber; the casts recover the erased records the kernel runtime consumes untyped.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- the closure shape has no single-step assertion to the closed component type, and callProps is the heterogeneous props bag the painter supplies.
  const wrapped = ((callProps: Record<string, unknown>): View =>
    // The painter runs the wrapper on its own hole fiber, so the feature
    // mounts as a real child of the consumer: its own fiber, its own
    // record, and a path under the consumer.
    renderModelComponent(
      getFiber() as never,
      definition as never,
      implementation as never,
      callProps as never
    )) as unknown as ModelComponent<never, never, never, never>;
  Object.assign(wrapped, {
    [ComponentTypeId]: ComponentTypeId,
    definition,
    definitionName: name,
    implementation,
  });
  wrappers.set(impl, wrapped);
  return wrapped;
};

/**
 * Declares a feature service from its Props and Events Schemas.
 */
export const Service: <Self>() => <
  const Name extends string,
  // oxlint-disable-next-line typescript/no-explicit-any -- Codec variance erasure: the factory accepts any Props codec, as in Effect's own Context.Service overloads.
  Props extends Schema.Codec<any, any>,
  // oxlint-disable-next-line typescript/no-explicit-any -- Codec variance erasure: the factory accepts any Events codec, as in Effect's own Context.Service overloads.
  Events extends Schema.Codec<any, any> = Schema.Never,
>(
  name: Name,
  schemas: {
    readonly props: Props;
    readonly events?: Events | undefined;
  }
) => Context.ServiceClass<
  Self,
  `feature/${Name}`,
  Implementation<Props["Type"], Events["Type"]>
> &
  Service<Self, Props["Type"], Events["Type"]> & {
    readonly props: Props;
    readonly events: Events;
  } =
  () =>
  (
    name: string,
    schemas: {
      // oxlint-disable-next-line typescript/no-explicit-any -- Codec variance erasure: the impl accepts any Props codec, as in Effect's own Context.Service overloads.
      readonly props: Schema.Codec<any, any>;
      // oxlint-disable-next-line typescript/no-explicit-any -- Codec variance erasure: the impl accepts any Events codec, as in Effect's own Context.Service overloads.
      readonly events?: Schema.Codec<any, any> | undefined;
    }
    // `any` here is the documented boundary: a generic class-based factory
    // implementation satisfying a generic call signature, as in Effect's own
    // `Context.Service` overloads.
    // oxlint-disable-next-line typescript/no-explicit-any -- the documented class-factory boundary: the impl satisfies the generic call signature above.
  ): any => {
    const Base = Context.Service<unknown, Implementation<unknown, unknown>>()(
      `feature/${name}`
    );
    class FeatureService extends Base {
      static readonly [TypeId] = { name };
      static readonly props = schemas.props;
      static readonly events = schemas.events ?? Schema.Never;
      static render(
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the static is invoked unbound; unknown reflects any receiver before the isService check.
        this: unknown,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- render takes the parent's h helper; its exact type varies by host, so the seam is untyped.
        h: unknown,
        options: RenderOptions<unknown, unknown>
      ): View {
        // SAFETY: the service class carries the brand (set just above); the cast only recovers the service type for the isService fallback.
        const feature = isService(this)
          ? this
          : // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the class shape has no single-step assertion to the service type.
            (FeatureService as unknown as Any);
        const caller = recordOfCaller();
        const path = caller?.path ?? "/";
        const key = `feature/${name}`;
        const env = caller === undefined ? Context.empty() : resolveEnv(caller);
        // SAFETY: feature is the isService-narrowed service (or the class itself); the cast only recovers the Context.Key interface for the lookup.
        const found = Context.getOption(
          env,
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the service shape has no single-step assertion to the Context.Key interface.
          feature as unknown as Context.Key<
            unknown,
            Implementation<unknown, unknown>
          >
        );
        if (found._tag === "Some") {
          // SAFETY: found.value is the stored Implementation from toLayer; never closes over any concrete instantiation for the wrapper.
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the stored value shape has no single-step assertion to the closed Implementation.
          const impl = found.value as unknown as Implementation<never, never>;
          // A real child vnode: the painter gives the wrapper its own hole
          // fiber, so the feature mounts under the consumer with its own
          // record and path instead of on the consumer's fiber.
          // SAFETY: h is the parent's helper invoked with the wrapper and its props; the cast recovers the vnode-factory signature the painter implements.
          // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- h takes the untyped vnode type and props bag the painter supplies; RenderOptions states the contract.
          return (h as (type: unknown, props: Record<string, unknown>) => View)(
            wrapperFor(feature, impl),
            {
              key: options.key,
              onEmit: options.onEmit,
              onFailure: options.onFailure,
              props: options.props,
            }
          );
        }
        const failed = Context.getOption(env, FailedLayer);
        if (failed._tag === "Some") {
          if (options.fallback === undefined) {
            throw new Error(
              `${path}: ${key} isn't available, because a Layer above it failed. Pass \`fallback\`.`
            );
          }
          // SAFETY: failed.value is the stored layer error; the casts recover the Failure branch for the required fallback and its View.
          return options.fallback(
            AsyncResult.failure(failed.value) as AsyncResult.Failure<
              never,
              unknown
            >
          ) as View;
        }
        const pending = Context.getOption(env, PendingLayer);
        const server = caller?.fiber.runtime.ssr === true;
        if (pending._tag === "Some" || server) {
          if (options.fallback === undefined) {
            throw new Error(
              `${path}: ${key} isn't available, because a Layer above it is still building or failed. Pass \`fallback\`.`
            );
          }
          // SAFETY: a pending or server build shows Initial; the casts recover the Initial branch for the required fallback and its View.
          return options.fallback(
            AsyncResult.initial(true) as AsyncResult.Initial<never, unknown>
          ) as View;
        }
        throw new Error(`${path}: nothing provides ${key}`);
      }
      static toLayer<R>(
        component: ModelComponent<unknown, unknown, R, unknown>
      ): Layer.Layer<unknown, never, R> {
        return Layer.effect(
          Base,
          Effect.map(
            Effect.context<R>(),
            (context): Implementation<unknown, unknown> => ({
              // SAFETY: the component's own contract is preserved by construction; the cast only recovers the erased Implementation record shape.
              // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the component shape has no single-step assertion to the erased Implementation record.
              component: component as unknown as Implementation<
                unknown,
                unknown
              >["component"],
              // The implementation's requirements close with the build site's
              // Context. The Layer's own Scope isn't part of that contract: the
              // runtime gives every instance its own.
              // SAFETY: omitting Scope closes the requirements where the Layer is built; the erased Context type pins the Implementation record.
              context: Context.omit(Scope.Scope)(
                context
              ) as Context.Context<never>,
            })
          )
        );
      }
    }
    return FeatureService;
  };
