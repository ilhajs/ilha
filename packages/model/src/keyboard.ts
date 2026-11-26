/**
 * Pure keyboard helpers over {@link KeyPayload}: turn a table of single-key
 * shortcuts into a handler for a document listener or an element's
 * `keydown` handler.
 *
 * Build the payload from a real event with {@link keyPayload}; the matcher
 * itself ({@link shortcuts}) is pure and testable without a DOM.
 */
export interface KeyPayload {
  /** The key pressed, compared with `===` (case-sensitive). */
  readonly key: string;
  /** Whether Shift was held. */
  readonly shift: boolean;
  /** Whether Ctrl was held. */
  readonly ctrl: boolean;
  /** Whether Alt was held. */
  readonly alt: boolean;
  /** Whether Meta (Cmd/Win) was held. */
  readonly meta: boolean;
  /** True while an input method composes text, including for the key that ends the composition. */
  readonly composing: boolean;
  /** True while a held key fires auto-repeats. */
  readonly repeat: boolean;
  /**
   * True when the event's innermost target (through open shadow roots) takes
   * typed characters: a `textarea`, a `select`, an `input` other than
   * `button`, `checkbox`, `color`, `file`, `image`, `radio`, `range`,
   * `reset` or `submit`, or an element with `isContentEditable` true. A
   * `readonly` field still counts.
   */
  readonly editable: boolean;
  /**
   * The caret or selection of the event's target, as the key finds it, when
   * the target is a `textarea` or an `input` whose type has a selection
   * (such as `text` or `search`). `null` for any other target, including an
   * `email` or `number` input, which browsers don't report a selection for.
   */
  readonly selectionStart: number | null;
  /** The end of the selection; see {@link KeyPayload.selectionStart}. */
  readonly selectionEnd: number | null;
}

/**
 * Input types that never take typed characters, so they are never
 * {@link KeyPayload.editable}.
 */
type NonTextInputTypes = Record<string, true>;
// oxlint-disable-next-line anti-slop/no-known-value-widening -- indexed by input `type` strings; the key union is never enumerated.
const nonTextInputTypes: NonTextInputTypes = {
  button: true,
  checkbox: true,
  color: true,
  file: true,
  image: true,
  radio: true,
  range: true,
  reset: true,
  submit: true,
};

/** No caret or selection: the target is not a text field. */
const noSelection = { selectionEnd: null, selectionStart: null } as const;
/** Whether `target` takes typed characters. Only XHTML elements count. */
const isEditable = (target: EventTarget | null): boolean => {
  // SAFETY: key events target elements; non-elements fall through the optional chain.
  const element = target as HTMLElement | null;
  if (element?.namespaceURI === "http://www.w3.org/1999/xhtml") {
    const tag = element.localName;
    if (tag === "textarea" || tag === "select") {
      return true;
    }
    if (tag === "input") {
      // SAFETY: reached only for `input`, so the element is an `HTMLInputElement`.
      return nonTextInputTypes[(element as HTMLInputElement).type] !== true;
    }
  }
  return element?.isContentEditable === true;
};
/** Whether `value` is a real number (a set selection bound, not `null`). */
const isNumber = (value: unknown): value is number => typeof value === "number";

/** The caret or selection of an editable target, or nulls when it has none. */
interface CaretSelection {
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
}

/** The caret or selection of `target`, or nulls when it has none. */
const selectionOf = (target: EventTarget | null): CaretSelection => {
  // SAFETY: `selectionStart`/`selectionEnd` exist on editable elements; other targets return early with `noSelection`.
  const field = target as HTMLInputElement | null;
  const tag = field?.localName;
  if (tag !== "input" && tag !== "textarea") {
    return noSelection;
  }
  try {
    const start = field?.selectionStart ?? null;
    const end = field?.selectionEnd ?? null;
    return isNumber(start) && isNumber(end)
      ? { selectionEnd: end, selectionStart: start }
      : noSelection;
  } catch {
    // Older browsers throw, rather than return `null`, for an input type without a selection.
    return noSelection;
  }
};

/**
 * Build a {@link KeyPayload} from a DOM `keydown` or `keyup` event. The
 * innermost target is read through open shadow roots (`composedPath`),
 * and `editable` describes the event's target, not the element holding the
 * handler.
 *
 * @example
 * ```ts
 * import { Keyboard } from "@ilha/model";
 *
 * window.addEventListener("keydown", (event) => {
 *   const message = handle(Keyboard.keyPayload(event));
 * });
 * ```
 */
export const keyPayload = (event: KeyboardEvent): KeyPayload => {
  const target = event.composedPath()[0] ?? event.target ?? null;
  const { selectionStart, selectionEnd } = selectionOf(target);
  return {
    alt: event.altKey,
    // Safari reports the key that ends a composition with `isComposing` false and `keyCode` 229.
    composing:
      event.isComposing === true ||
      ("keyCode" in event && event.keyCode === 229),
    ctrl: event.ctrlKey,
    editable: isEditable(target),
    key: event.key,
    meta: event.metaKey,
    repeat: event.repeat === true,
    selectionEnd,
    selectionStart,
    shift: event.shiftKey,
  };
};

/**
 * One row of a table for {@link shortcuts}: a key to match, the message to
 * produce, and optional modifier and guard overrides.
 *
 * **Details**
 *
 * `ctrl`, `alt` and `meta` default to `false`. `mod: true` matches a
 * cross-platform primary shortcut — either `ctrl` or `meta` pressed, but not
 * both — and takes precedence over `ctrl` and `meta`. `shift` is ignored
 * unless set, so a character key such as `"?"` or `"G"` matches regardless of
 * whether the user's keyboard layout requires Shift to type it. `whileTyping`
 * defaults to `false` (ignored when `editable` is true), and `repeat`
 * defaults to `false` (ignored while the key auto-repeats).
 */
export interface Shortcut<Message> {
  /** The key to match, compared with `===` (case-sensitive). */
  readonly key: string;
  /** The message a match produces. */
  readonly message: Message;
  /** When true, exactly one of `ctrl`/`meta` must be pressed. */
  readonly mod?: boolean | undefined;
  /** Checked only when set. */
  readonly shift?: boolean | undefined;
  /** Defaults to `false`; ignored when `mod` is true. */
  readonly ctrl?: boolean | undefined;
  /** Defaults to `false`. */
  readonly alt?: boolean | undefined;
  /** Defaults to `false`; ignored when `mod` is true. */
  readonly meta?: boolean | undefined;
  /** Defaults to `false`; the row is skipped in an editable target unless true. */
  readonly whileTyping?: boolean | undefined;
  /** Defaults to `false`; the row is skipped on auto-repeat unless true. */
  readonly repeat?: boolean | undefined;
}

/**
 * A `keydown` or `keyup` payload as a document listener sees it: the
 * {@link KeyPayload} plus whether another handler already called
 * `preventDefault`.
 */
export type DocumentKeyPayload = KeyPayload & {
  /** True when another handler already prevented the browser default. */
  readonly defaultPrevented: boolean;
};

/**
 * Turn a table of single-key {@link Shortcut} rows into a pure `keydown` or
 * `keyup` handler usable with a document listener or an element's `keydown`
 * handler.
 *
 * **Details**
 *
 * Events with `composing` are always ignored, and on document payloads
 * events with `defaultPrevented` are ignored as well (element payloads carry
 * no `defaultPrevented`). Each row is checked in order and the first match
 * returns its `message`. Unmatched events return `undefined`, so
 * `preventDefault: true` cancels the browser's default only for matched
 * shortcuts.
 */
export const shortcuts =
  <const Rows extends readonly Shortcut<unknown>[]>(
    table: Rows
  ): ((
    payload: KeyPayload | DocumentKeyPayload
  ) => Rows[number]["message"] | undefined) =>
  (payload) => {
    if (
      ("defaultPrevented" in payload && payload.defaultPrevented) ||
      payload.composing
    ) {
      return;
    }
    for (const shortcut of table) {
      if (
        shortcut.key === payload.key &&
        (shortcut.mod === true
          ? payload.ctrl !== payload.meta
          : payload.ctrl === (shortcut.ctrl ?? false) &&
            payload.meta === (shortcut.meta ?? false)) &&
        payload.alt === (shortcut.alt ?? false) &&
        (shortcut.shift === undefined || payload.shift === shortcut.shift) &&
        (!payload.editable || shortcut.whileTyping === true) &&
        (!payload.repeat || shortcut.repeat === true)
      ) {
        return shortcut.message;
      }
    }
  };
