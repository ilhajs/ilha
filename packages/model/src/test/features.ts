import type * as Schema from "effect/Schema";

/**
 * Feature identity for test cursors: `childEmit`, `childFailure` and
 * `childPending` name a child by model component, stub component, provided
 * copy, lazy component or feature service. Feature children never render
 * in the pure engine (resolving them needs a live fiber and record), and
 * render for real under `TestHost` through `TestHost.stub(feature).layer`.
 */
import { isService } from "../feature.ts";
import type * as Feature from "../feature.ts";

/** Whether `value` is a string. */
const isString = (value: unknown): value is string => typeof value === "string";

/** Whether `child` declares a string `definitionName`. */
const hasDefinitionName = <T extends object>(
  child: T
): child is T & { readonly definitionName: string } => {
  if (!("definitionName" in child)) {
    return false;
  }
  return isString(child.definitionName);
};

/** The service key `feature/<name>` of a feature service class. */
const featureKeyOf = (service: Feature.Any): string | undefined => {
  if ("key" in service && isString(service.key)) {
    return service.key;
  }
  return undefined;
};

/** The props schema of a feature service, when it declares one. */
export const featurePropsOf = (
  service: Feature.Any
): Schema.Codec<never, unknown> => service.props;

/** The events schema of a feature service, when it declares one. */
export const featureEventsOf = (
  service: Feature.Any
): Schema.Codec<never, unknown> => service.events;

/** The props of a feature service's contract. */
export type FeatureProps<F> =
  F extends Feature.Service<unknown, infer P, infer _E> ? P : never;

/** The events of a feature service's contract. */
export type FeatureEvents<F> =
  F extends Feature.Service<unknown, infer _P, infer E> ? E : never;

/**
 * The name a child is declared under: a model component's definition
 * name, or a feature service's feature name. Throws for anything else.
 */
// oxlint-disable-next-line anti-slop/no-object-parameters -- child is a model component or feature service; narrowed below with hasDefinitionName/isService.
export const childNameOf = (step: string, child: object): string => {
  if (hasDefinitionName(child)) {
    return child.definitionName;
  }
  if (isService(child)) {
    const key = featureKeyOf(child);
    if (key !== undefined) {
      return key.startsWith("feature/") ? key.slice("feature/".length) : key;
    }
  }
  throw new Error(
    `${step}: the child isn't a model component or feature service`
  );
};
