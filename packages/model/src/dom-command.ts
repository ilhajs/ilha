/**
 * Commands that take a rendered element's ref, from `Dom.ref` or `h.mount`,
 * and report what the browser did with it. Each resolves the ref within the
 * issuing instance after the commit of the issuing update: `Refs.lookup`
 * waits for the commit, then returns the element or nothing. Ported from
 * Effect UI's `html-command.ts`.
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Command from "./command.ts";
import * as Dom from "./dom.ts";

/**
 * Whether `u` is a `Dom.Ref`: same shape as the `Schema.declare` inside
 * `Dom.RefSchema`, which is not exported.
 */
const isRefInstance = (u: unknown): u is Dom.Ref<Element> =>
  typeof u === "object" &&
  u !== null &&
  "key" in u &&
  "name" in u &&
  "at" in u &&
  typeof u.key === "string" &&
  typeof u.at === "function";

/** Whether the element exposes a `showPicker` method (newer browsers and `select` elements). */
const hasShowPicker = (
  element: Element
): element is Element & { readonly showPicker: () => void } =>
  "showPicker" in element && typeof element.showPicker === "function";
/** Widen an element ref to the `Ref<Element>` factories take (refs only carry their key). */
const asElementRef = <N extends Element>(ref: Dom.Ref<N>): Dom.Ref<Element> =>
  // SAFETY: factories only read the ref's key; the element type is carried by the caller's bound.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- `Ref` is invariant in its element, so the widening routes through `unknown`.
  ref as unknown as Dom.Ref<Element>;

/**
 * The `ref` args Schema: `Dom.RefSchema` encodes a ref to its key for the
 * log, but it only decodes keys. Factories take `Ref` objects (as the
 * helpers below pass them), so the union also accepts a `Ref` through a
 * `declare` of the same shape. Encoding still goes through `RefSchema`
 * first, so the log keeps the key.
 */
const RefArg = Schema.Union([
  Dom.RefSchema,
  Schema.declare(isRefInstance, { expected: "Dom.Ref" }),
]);

/**
 * What `focus`, `blur`, `scrollIntoView` and `select` report: whether the
 * ref was rendered. A Command issued from the update the render caused
 * always finds its own elements.
 */
export interface Found {
  /** Whether the ref was rendered. */
  readonly found: boolean;
}

/**
 * An element's box, from `measure`, in CSS pixels relative to the viewport.
 */
export interface Rect {
  /** The x coordinate. */
  readonly x: number;
  /** The y coordinate. */
  readonly y: number;
  /** The width. */
  readonly width: number;
  /** The height. */
  readonly height: number;
  /** The top edge. */
  readonly top: number;
  /** The right edge. */
  readonly right: number;
  /** The bottom edge. */
  readonly bottom: number;
  /** The left edge. */
  readonly left: number;
}

/**
 * The options of `focus`.
 */
export interface FocusOptions {
  /** Don't scroll the element into view. */
  readonly preventScroll?: boolean | undefined;
}

/**
 * The options of `scrollIntoView`.
 */
export interface ScrollOptions {
  /** How the scroll moves: at once, instantly, or smoothly. */
  readonly behavior?: "auto" | "instant" | "smooth" | undefined;
  /** Where the element lands vertically. */
  readonly block?: "start" | "center" | "end" | "nearest" | undefined;
  /** Where the element lands horizontally. */
  readonly inline?: "start" | "center" | "end" | "nearest" | undefined;
}

const withElement = <A>(
  ref: Dom.Ref<Element>,
  f: (element: Element) => A
): Effect.Effect<Option.Option<A>, never, Dom.Refs> =>
  Effect.flatMap(
    Dom.Refs.use((refs) => refs.lookup(ref)),
    (node) =>
      Option.isNone(node)
        ? Effect.succeed(Option.none<A>())
        : Effect.map(
            Effect.sync(() => f(node.value)),
            Option.some
          )
  );

const found = (
  ref: Dom.Ref<Element>,
  f: (element: Element) => void
): Effect.Effect<Found, never, Dom.Refs> =>
  Effect.map(withElement(ref, f), (done): Found => ({
    found: Option.isSome(done),
  }));

const FocusOptionsSchema = Schema.Struct({
  preventScroll: Schema.optional(Schema.Boolean),
});

const ScrollOptionsSchema = Schema.Struct({
  behavior: Schema.optional(Schema.Literals(["auto", "instant", "smooth"])),
  block: Schema.optional(
    Schema.Literals(["start", "center", "end", "nearest"])
  ),
  inline: Schema.optional(
    Schema.Literals(["start", "center", "end", "nearest"])
  ),
});

/**
 * The Command behind `focus`.
 */
export const Focus: Command.Factory<
  "DomCommand.focus",
  {
    readonly ref: Dom.Ref<Element>;
    readonly options?: FocusOptions | undefined;
  },
  Found,
  Dom.Refs
> = Command.make(
  "DomCommand.focus",
  // SAFETY: each field is a Schema for its option; the record bridges them to `ArgsInput` for the log encoder.
  {
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- the per-field schemas need no `unknown` stopover for the checker, but `ArgsInput`'s variance does; each field keeps its precise schema.
    args: {
      options: Schema.optional(FocusOptionsSchema),
      ref: RefArg,
    } as unknown as Record<string, Schema.Any>,
  },
  ({ options, ref }) =>
    found(ref, (element) => {
      // SAFETY: focus is only issued for focusable refs; the cast recovers the element interface `Refs` erases.
      (element as HTMLElement).focus(options ?? {});
    })
);

/**
 * The Command behind `blur`.
 */
export const Blur: Command.Factory<
  "DomCommand.blur",
  { readonly ref: Dom.Ref<Element> },
  Found,
  Dom.Refs
> = Command.make(
  "DomCommand.blur",
  // SAFETY: each field is a Schema for its option; the record bridges them to `ArgsInput` for the log encoder.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- the per-field schemas need no `unknown` stopover for the checker, but `ArgsInput`'s variance does; each field keeps its precise schema.
  { args: { ref: RefArg } as unknown as Record<string, Schema.Any> },
  ({ ref }) =>
    found(ref, (element) => {
      // SAFETY: blur is only issued for focusable refs; the cast recovers the element interface `Refs` erases.
      (element as HTMLElement).blur();
    })
);

/**
 * The Command behind `scrollIntoView`.
 */
export const ScrollIntoView: Command.Factory<
  "DomCommand.scrollIntoView",
  {
    readonly ref: Dom.Ref<Element>;
    readonly options?: ScrollOptions | undefined;
  },
  Found,
  Dom.Refs
> = Command.make(
  "DomCommand.scrollIntoView",
  // SAFETY: each field is a Schema for its option; the record bridges them to `ArgsInput` for the log encoder.
  {
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- the per-field schemas need no `unknown` stopover for the checker, but `ArgsInput`'s variance does; each field keeps its precise schema.
    args: {
      options: Schema.optional(ScrollOptionsSchema),
      ref: RefArg,
    } as unknown as Record<string, Schema.Any>,
  },
  ({ options, ref }) =>
    found(ref, (element) => {
      // SAFETY: `ScrollOptions` mirrors `ScrollIntoViewOptions` field for field; the cast bridges the option bags.
      element.scrollIntoView(options as ScrollIntoViewOptions | undefined);
    })
);

/**
 * The Command behind `measure`.
 */
export const Measure: Command.Factory<
  "DomCommand.measure",
  { readonly ref: Dom.Ref<Element> },
  Option.Option<Rect>,
  Dom.Refs
> = Command.make(
  "DomCommand.measure",
  // SAFETY: each field is a Schema for its option; the record bridges them to `ArgsInput` for the log encoder.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- the per-field schemas need no `unknown` stopover for the checker, but `ArgsInput`'s variance does; each field keeps its precise schema.
  { args: { ref: RefArg } as unknown as Record<string, Schema.Any> },
  ({ ref }) =>
    withElement(ref, (element): Rect => {
      const box = element.getBoundingClientRect();
      return {
        bottom: box.bottom,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        width: box.width,
        x: box.x,
        y: box.y,
      };
    })
);

/**
 * The Command behind `select`.
 */
export const Select: Command.Factory<
  "DomCommand.select",
  { readonly ref: Dom.Ref<Element> },
  Found,
  Dom.Refs
> = Command.make(
  "DomCommand.select",
  // SAFETY: each field is a Schema for its option; the record bridges them to `ArgsInput` for the log encoder.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- the per-field schemas need no `unknown` stopover for the checker, but `ArgsInput`'s variance does; each field keeps its precise schema.
  { args: { ref: RefArg } as unknown as Record<string, Schema.Any> },
  ({ ref }) =>
    found(ref, (element) => {
      // SAFETY: select is only issued for text-field refs; the cast recovers the input interface `Refs` erases.
      (element as HTMLInputElement).select();
    })
);

/**
 * What `requestSubmit` reports: whether the ref was rendered, and whether
 * the browser took the submission.
 */
export interface Submitted extends Found {
  /** Whether the form submitted: false when there is no form. */
  readonly submitted: boolean;
}

/**
 * The Command behind `requestSubmit`.
 */
export const RequestSubmit: Command.Factory<
  "DomCommand.requestSubmit",
  { readonly ref: Dom.Ref<Element> },
  Submitted,
  Dom.Refs
> = Command.make(
  "DomCommand.requestSubmit",
  // SAFETY: each field is a Schema for its option; the record bridges them to `ArgsInput` for the log encoder.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- the per-field schemas need no `unknown` stopover for the checker, but `ArgsInput`'s variance does; each field keeps its precise schema.
  { args: { ref: RefArg } as unknown as Record<string, Schema.Any> },
  ({ ref }) =>
    Effect.map(
      withElement(ref, (element) => {
        if (element instanceof HTMLFormElement) {
          element.requestSubmit();
          return true;
        }
        // SAFETY: only form-associated elements reach the owner lookup; others fall through to the closest form.
        const owner =
          (element as HTMLInputElement).form ?? element.closest("form");
        if (owner === null) {
          return false;
        }
        owner.requestSubmit();
        return true;
      }),
      (done): Submitted => ({
        found: Option.isSome(done),
        submitted: Option.getOrElse(done, () => false),
      })
    )
);

/**
 * Focuses the element `ref` names, once the render the issuing `update`
 * caused commits, and sends `f`'s message with whether it was rendered.
 */
export const focus = <N extends HTMLElement | SVGElement, Msg>(
  ref: Dom.Ref<N>,
  f: (result: Found) => Msg,
  options?: FocusOptions
): Command.Mapped<Command.Issued<Found, Dom.Refs>, Msg> =>
  Command.map(
    Focus(
      options === undefined
        ? { ref: asElementRef(ref) }
        : { options, ref: asElementRef(ref) }
    ),
    f
  );

/**
 * Takes focus away from the element `ref` names, and sends `f`'s message.
 */
export const blur = <N extends HTMLElement | SVGElement, Msg>(
  ref: Dom.Ref<N>,
  f: (result: Found) => Msg
): Command.Mapped<Command.Issued<Found, Dom.Refs>, Msg> =>
  Command.map(Blur({ ref: asElementRef(ref) }), f);

/**
 * Scrolls the element `ref` names into view, and sends `f`'s message.
 */
export const scrollIntoView = <N extends Element, Msg>(
  ref: Dom.Ref<N>,
  f: (result: Found) => Msg,
  options?: ScrollOptions
): Command.Mapped<Command.Issued<Found, Dom.Refs>, Msg> =>
  Command.map(
    ScrollIntoView(
      options === undefined
        ? { ref: asElementRef(ref) }
        : { options, ref: asElementRef(ref) }
    ),
    f
  );

/**
 * Measures the element `ref` names, and sends `f`'s message with its box,
 * or `none` when the ref isn't rendered.
 */
export const measure = <N extends Element, Msg>(
  ref: Dom.Ref<N>,
  f: (rect: Option.Option<Rect>) => Msg
): Command.Mapped<Command.Issued<Option.Option<Rect>, Dom.Refs>, Msg> =>
  Command.map(Measure({ ref: asElementRef(ref) }), f);

/**
 * Selects all the text in the `input` or `textarea` `ref` names, and sends
 * `f`'s message. It doesn't move focus.
 */
export const select = <N extends HTMLInputElement | HTMLTextAreaElement, Msg>(
  ref: Dom.Ref<N>,
  f: (result: Found) => Msg
): Command.Mapped<Command.Issued<Found, Dom.Refs>, Msg> =>
  Command.map(Select({ ref: asElementRef(ref) }), f);

/**
 * Submits the form of the element `ref` names: `ref` is a form, or a
 * control belonging to one (by nesting or the `form` attribute). The
 * browser validates unless `novalidate`, then fires `submit` on the form.
 * `submitted` is false when there is no form. Sends `f`'s message.
 */
export const requestSubmit = <N extends HTMLElement, Msg>(
  ref: Dom.Ref<N>,
  f: (result: Submitted) => Msg
): Command.Mapped<Command.Issued<Submitted, Dom.Refs>, Msg> =>
  Command.map(RequestSubmit({ ref: asElementRef(ref) }), f);

/**
 * What `showPicker` reports: whether the ref was rendered, and whether the
 * browser opened the picker.
 */
export interface Opened extends Found {
  /** Whether the browser opened the picker. */
  readonly opened: boolean;
}

/**
 * The Command behind `showPicker`.
 */
export const ShowPicker: Command.Factory<
  "DomCommand.showPicker",
  { readonly ref: Dom.Ref<Element> },
  Opened,
  Dom.Refs
> = Command.make(
  "DomCommand.showPicker",
  // SAFETY: each field is a Schema for its option; the record bridges them to `ArgsInput` for the log encoder.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- the per-field schemas need no `unknown` stopover for the checker, but `ArgsInput`'s variance does; each field keeps its precise schema.
  { args: { ref: RefArg } as unknown as Record<string, Schema.Any> },
  ({ ref }) =>
    Effect.map(
      withElement(ref, (element) => {
        // SAFETY: only form controls open pickers; the cast recovers the input interface `Refs` erases.
        if ((element as HTMLInputElement).disabled) {
          return false;
        }
        try {
          if (hasShowPicker(element)) {
            element.showPicker();
          } else {
            // SAFETY: `click` is only issued for clickable refs; the cast recovers the element interface `Refs` erases.
            (element as HTMLElement).click();
          }
          return true;
        } catch {
          return false;
        }
      }),
      (done): Opened => ({
        found: Option.isSome(done),
        opened: Option.getOrElse(done, () => false),
      })
    )
);

/**
 * Opens the picker of the `input` or `select` `ref` names, as a click on
 * it. `opened` is false on a disabled element or when the browser refuses.
 * A Command issued from a click or keypress runs within that user action.
 * Sends `f`'s message.
 */
export const showPicker = <N extends HTMLInputElement | HTMLSelectElement, Msg>(
  ref: Dom.Ref<N>,
  f: (result: Opened) => Msg
): Command.Mapped<Command.Issued<Opened, Dom.Refs>, Msg> =>
  Command.map(ShowPicker({ ref: asElementRef(ref) }), f);
