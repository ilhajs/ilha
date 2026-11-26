/**
 * The call options a parent wrote for a model child: the vnode's key plus
 * the props the painter kept in the fiber's props box. The child's author is
 * its nearest model ancestor (see `kernel.md`): `onEmit`, `onFailure` and
 * `fallback` resolve against that instance wherever the vnode was written.
 *
 * @internal
 */
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import type { PropBag, View } from "ilha";

import type { CallOptions } from "../component.ts";

/** The props bag the painter hands a model child, minus the vnode key. */
export interface ChildProps {
  readonly props?: unknown | undefined;
  readonly onEmit?: CallOptions<unknown, never>["onEmit"] | undefined;
  readonly onFailure?: CallOptions<unknown, never>["onFailure"] | undefined;
  readonly fallback?:
    | ((result: AsyncResult.Failure<never, unknown>) => View)
    | undefined;
  readonly children?: View | undefined;
  /** Slot content by declared name, for components declaring `slots`. */
  readonly slots?: Record<string, View> | undefined;
  /** The consumer's `view` closure, for headless children. */
  readonly view?: ((parts: unknown) => View) | undefined; // oxlint-disable-line anti-slop/no-unknown-parameters -- headless children receive arbitrary parts; the consumer decodes them.
  /** Placed slot content, for internal slot outlets. */
  readonly slotContent?: View | undefined;
}

/**
 * Dispatch an emitted event through the author's `onEmit`: a per-tag record
 * dispatches on `event._tag`, a function takes the whole event. Returns the
 * parent message, or `undefined` when the author ignores the event.
 *
 * @internal
 */
export const routeEmit = (
  onEmit: CallOptions<unknown, never>["onEmit"],
  event: unknown // oxlint-disable-line anti-slop/no-unknown-parameters -- events are author values dispatched below; the CallOptions contract leaves them unchecked.
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- returns the author's unchecked ParentMsg per the CallOptions contract.
): unknown => {
  if (onEmit === undefined) {
    return undefined;
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- branches the two onEmit forms; both are typed domain values.
  if (typeof onEmit === "function") {
    // SAFETY: the function form takes the whole event; never is its contravariant event parameter.
    return onEmit(event as never) ?? undefined;
  }
  const tag =
    typeof event === "object" && event !== null && "_tag" in event // oxlint-disable-line anti-slop/no-runtime-typeof -- validates the event shape before reading its dispatch tag.
      ? event._tag
      : undefined;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates the dispatch tag before the record lookup.
  if (typeof tag !== "string") {
    return undefined;
  }
  const handler = onEmit[tag];
  // SAFETY: narrowed above to the per-tag record; the handler takes the whole event with a contravariant never parameter.
  return handler === undefined
    ? undefined
    : (handler(event as never) ?? undefined);
};

// oxlint-disable-next-line anti-slop/no-known-value-widening -- the keys are the fixed call-option set; the dictionary documents which props never become onEmit handlers.
const passthroughKeys: Record<string, true> = {
  children: true,
  fallback: true,
  key: true,
  onEmit: true,
  onFailure: true,
  props: true,
  slots: true,
  view: true,
};

const foldOnHandlers = (
  props: PropBag,
  onEmit: ChildProps["onEmit"]
): ChildProps["onEmit"] => {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- collected handlers produce the author's unchecked ParentMsg per the contract.
  const found: (readonly [tag: string, handler: (event: never) => unknown])[] =
    [];
  for (const key of Object.keys(props)) {
    if (passthroughKeys[key] === true || !/^on[A-Z]/u.test(key)) {
      continue;
    }
    const handler = props[key];
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- selects the function props of the bag.
    if (typeof handler !== "function") {
      continue;
    }
    found.push([key.slice(2), handler]);
  }
  if (found.length === 0) {
    return onEmit;
  }
  if (onEmit === undefined) {
    return Object.fromEntries(found);
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- branches the two onEmit forms; both are typed domain values.
  if (typeof onEmit === "function") {
    const fallback = onEmit;
    // SAFETY: handlers take the whole event; never is their contravariant event parameter.
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the folded handler receives any author event and dispatches on its _tag.
    return (event: unknown) => {
      if (
        typeof event === "object" && // oxlint-disable-line anti-slop/no-runtime-typeof -- validates the dispatched event before reading its tag.
        event !== null &&
        "_tag" in event &&
        typeof event._tag === "string" // oxlint-disable-line anti-slop/no-runtime-typeof -- validates the dispatch tag before the handler lookup.
      ) {
        for (const [name, handler] of found) {
          if (name === event._tag) {
            // SAFETY: handlers take the whole event; never is their contravariant event parameter.
            return handler(event as never);
          }
        }
      }
      // SAFETY: the fallback takes the whole event; never is its contravariant event parameter.
      return fallback(event as never);
    };
  }
  return { ...Object.fromEntries(found), ...onEmit };
};
/**
 * Read a model child's call options out of the props bag the painter passed.
 * Unknown props are ignored; a missing `props` entry decodes against the
 * component's props Schema at mount. `on<Event>` handlers (every function
 * prop shaped `onX` besides the known options) fold into `onEmit`: an
 * explicit `onEmit` record wins per tag, an `on<Event>` wins over a
 * function `onEmit` for its tag.
 *
 * @internal
 */
export const readCallProps = (props: PropBag): ChildProps => {
  // SAFETY: the explicit onEmit keeps the author's per-tag record or function form; the fold preserves whichever it is.
  const folded = foldOnHandlers(props, props["onEmit"] as ChildProps["onEmit"]);
  return {
    // SAFETY: the painter's bag holds PropValue entries; each read re-establishes the call-option contract and ignores the rest.
    children: props["children"] as View | undefined,
    // SAFETY: the fallback entry is the component's FallbackFailure closure when present.
    fallback: props["fallback"] as ChildProps["fallback"],
    onEmit: folded,
    // SAFETY: the onFailure entry is the author's failure closure when present.
    onFailure: props["onFailure"] as ChildProps["onFailure"],
    // SAFETY: the props entry is unchecked; the component's Schema decodes it at mount.
    props: props["props"] as unknown,
    // SAFETY: the slotContent entry is a placed vnode when present.
    slotContent: props["slotContent"] as View | undefined,
    // SAFETY: the slots entry maps declared names to placed vnodes when present.
    slots: props["slots"] as Record<string, View> | undefined,
    // SAFETY: the view entry is the consumer's closure for headless children when present.
    view: props["view"] as ((parts: unknown) => View) | undefined, // oxlint-disable-line anti-slop/no-unknown-parameters -- headless children receive arbitrary parts; the consumer decodes them.
  };
};
