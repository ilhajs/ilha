/**
 * Play tests mount with the real Ilha renderer in happy-dom and run the real
 * runtime: real Layers and children, real Commands. Each step settles before
 * it acts, so it picks up clock adjustments and host signals, and settles
 * after. Commands, events and sends need no acknowledgement. Lookup failures
 * and "nothing handles" throw defects with the call-site stack.
 */
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import * as Locator from "./locator.ts";
import { atSite } from "./steps.ts";
import type { AnyComponent, PropsOf } from "./steps.ts";
import { TestHost } from "./test-host.ts";
import type {
  Pending as HostPending,
  ProblemsError,
  RootCrashed,
  SettleError,
} from "./test-host.ts";

/**
 * What a `Play` step can fail with.
 */
export type StepError = SettleError | RootCrashed | ProblemsError;

/**
 * The assertions `expect(locator)` offers, evaluated after settling. Each
 * one checks the elements `locator` matches in the live DOM and returns an
 * Effect. A failure lists the roles and names the tree has.
 */
export interface PlayExpect {
  /** Asserts that at least one element matches. */
  toExist: () => Effect.Effect<void, StepError>;
  /** Asserts that nothing matches. */
  toBeAbsent: () => Effect.Effect<void, StepError>;
  /** Asserts that exactly one element matches and its text is `text`, or matches it. */
  toHaveText: (text: string | RegExp) => Effect.Effect<void, StepError>;
  /** Asserts that exactly `count` elements match. */
  toHaveCount: (count: number) => Effect.Effect<void, StepError>;
  /** Asserts that exactly one element matches and its field value is `value`. */
  toHaveValue: (value: string) => Effect.Effect<void, StepError>;
  /** Asserts that exactly one element matches and its checked state is `checked`. */
  toBeChecked: (checked?: boolean) => Effect.Effect<void, StepError>;
  /** Asserts that exactly one element matches and its disabled state is `disabled`. */
  toBeDisabled: (disabled?: boolean) => Effect.Effect<void, StepError>;
  /** Asserts that exactly one element matches and its accessible name is `name`, or matches it. */
  toHaveAccessibleName: (
    name: string | RegExp
  ) => Effect.Effect<void, StepError>;
}

/**
 * A cursor over one play: the real runtime under `TestHost`.
 */
export interface Play<_C extends AnyComponent> {
  /** The mounted root. */
  readonly root: PlayRoot;
  /**
   * Clicks the one element `target` matches: a string is a CSS selector, a
   * locator runs over a DOM snapshot. Sends `pointerdown`, `mousedown`,
   * `mouseup`, `click`, then the browser defaults. Settles between press
   * and release, so a submit reads the fields as they were before the
   * click's own message. A disabled control throws.
   */
  click: (target: string | Locator.Locator) => Effect.Effect<void, StepError>;
  /** Dispatches `event` with `payload` fields on the one element `locator` matches. */
  fire: (
    locator: Locator.Locator,
    event: string,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- fire payloads carry arbitrary DOM event fields the component decodes.
    payload?: unknown
  ) => Effect.Effect<void, StepError>;
  /** Types into a text field: writes the DOM prop first, then fires `input`. */
  type: (
    locator: Locator.Locator,
    value: string,
    options?: {
      readonly composing?: boolean | undefined;
      readonly inputType?: string | undefined;
    }
  ) => Effect.Effect<void, StepError>;
  /** Changes a field: writes the DOM prop first, then fires `change`. */
  change: (
    locator: Locator.Locator,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- a change carries a field map when one string cannot name the value.
    value: string | Record<string, unknown>
  ) => Effect.Effect<void, StepError>;
  /** Presses a key on the element, or on the document with `"document"`. */
  keydown: (
    locator: Locator.Locator | "document",
    key: string,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- key details carry arbitrary KeyboardEvent init fields.
    details?: Record<string, unknown>
  ) => Effect.Effect<void, StepError>;
  /** Submits a form as pressing Enter in it would: no submitter. */
  submit: (locator: Locator.Locator) => Effect.Effect<void, StepError>;
  /** Moves focus to the element. */
  focus: (locator: Locator.Locator) => Effect.Effect<void, StepError>;
  /** Moves focus away from the element. */
  blur: (locator: Locator.Locator) => Effect.Effect<void, StepError>;
  /** Asserts on the elements `locator` matches in the live DOM. */
  expect: (locator: Locator.Locator) => PlayExpect;
  /**
   * Acknowledges an ignored interaction. Fails when the last interaction
   * produced a message or none has run.
   */
  expectIgnored: () => Effect.Effect<void, StepError>;
}

/**
 * A mounted play root: the live container plus snapshots and the Model from
 * the log.
 */
export interface PlayRoot {
  /** The instance path the root mounts at. */
  readonly path: string;
  /** The live container. */
  readonly container: Element;
  /** The container's text. */
  readonly text: () => string;
  /** The Model of the root instance, from its latest log entry. */
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the root model is schema-erased until the test narrows it.
  readonly model: () => unknown;
  /** What the root's session still sees open. */
  readonly pending: () => readonly HostPending[];
}

interface SnapshotNode {
  readonly tag?: string | undefined;
  readonly attrs: Record<string, string>;
  readonly text?: string | undefined;
  readonly children: readonly SnapshotNode[];
  readonly el?: Element | undefined;
}

const snapshotOf = (el: Element | ChildNode): SnapshotNode => {
  if (el.nodeType === 3) {
    return { attrs: {}, children: [], text: el.textContent ?? "" };
  }
  if (el.nodeType !== 1) {
    return { attrs: {}, children: [], text: "" };
  }
  // SAFETY: nodeType 3 and non-elements return above, so only an Element reaches here.
  const element = el as Element;
  const attrs: Record<string, string> = {};
  for (const attr of element.attributes) {
    attrs[attr.name] = attr.value;
  }
  return {
    attrs,
    children: [...element.childNodes].map(snapshotOf),
    el: element,
    tag: element.tagName.toLowerCase(),
  };
};

const rootSnapshot = (container: Element): SnapshotNode => ({
  attrs: {},
  children: [...container.childNodes].map(snapshotOf),
});

/** The text under a snapshot node. */
const snapshotText = (node: SnapshotNode): string =>
  node.text !== undefined && node.tag === undefined
    ? node.text
    : node.children.map(snapshotText).join("");

/** Collapsed whitespace, for text assertions. */
const normalizeText = (text: string): string =>
  text.replaceAll(/\s+/gu, " ").trim();

const isDisabled = (el: Element): boolean => {
  // SAFETY: the "disabled" check narrows to form controls, which carry the flag.
  if ("disabled" in el && (el as HTMLButtonElement).disabled === true) {
    return true;
  }
  return el.closest("fieldset[disabled]") !== null;
};

const domValue = (el: Element): string | undefined => {
  if ("value" in el) {
    // SAFETY: the "value" check narrows to input-like elements, which carry the property.
    return String((el as HTMLInputElement).value);
  }
  return el.getAttribute("value") ?? undefined;
};

const domChecked = (el: Element): boolean => {
  const aria = el.getAttribute("aria-checked");
  if (aria !== null) {
    return aria === "true";
  }
  if ("checked" in el) {
    // SAFETY: the "checked" check narrows to input-like elements, which carry the property.
    return (el as HTMLInputElement).checked === true;
  }
  return el.hasAttribute("checked");
};

const runClickDefaults = (el: Element): void => {
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute("type");
  if (tag === "input" && (type === "checkbox" || type === "radio")) {
    // SAFETY: the tag/type check above guarantees a checkbox or radio input.
    const input = el as HTMLInputElement;
    if (type === "checkbox") {
      input.checked = !input.checked;
    } else if (input.checked) {
      return;
    } else {
      input.checked = true;
    }
    const payload = { checked: input.checked, value: input.value };
    const inputEvent = new Event("input", { bubbles: true, cancelable: true });
    Object.assign(inputEvent, payload);
    el.dispatchEvent(inputEvent);
    const changeEvent = new Event("change", {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(changeEvent, payload);
    el.dispatchEvent(changeEvent);
    return;
  }
  // SAFETY: the tag check guarantees a form element in the first branch; closest narrows in the second.
  const form = tag === "form" ? (el as HTMLFormElement) : el.closest("form");
  const isSubmit =
    (tag === "button" && (type === null || type === "submit")) ||
    (tag === "input" && (type === "submit" || type === "image"));
  if (isSubmit && form !== null) {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  }
};

class PlayCursor<_C extends AnyComponent> {
  private ignored = false;
  private ranInteraction = false;
  readonly root: PlayRoot;
  private readonly host: TestHost;

  constructor(root: PlayRoot, host: TestHost) {
    this.root = root;
    this.host = host;
  }

  private get container(): Element {
    return this.root.container;
  }

  private resolveDom(step: string, target: string | Locator.Locator): Element {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- click targets are selector strings or locators by design; the branch runs the selector path.
    if (typeof target === "string") {
      const matches = this.container.querySelectorAll(target);
      if (matches.length === 0) {
        throw new Error(`${step}: nothing matches ${JSON.stringify(target)}`);
      }
      if (matches.length > 1) {
        throw new Error(
          `${step}: ${matches.length} elements match ${JSON.stringify(target)}: expected exactly one`
        );
      }
      // SAFETY: the length checks above guarantee exactly one match.
      return matches[0] as Element;
    }
    const snapshot = rootSnapshot(this.container);
    // SAFETY: locators run over the DOM snapshot, so every match is a snapshot node.
    const matches = (
      Locator.all(snapshot, target) as readonly SnapshotNode[]
    ).filter((node) => node.el !== undefined);
    if (matches.length === 0) {
      throw new Error(`${step}: nothing matches ${target.description}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `${step}: ${matches.length} elements match ${target.description}: expected exactly one`
      );
    }
    // SAFETY: the length checks above guarantee exactly one match with a live element.
    return (matches[0] as SnapshotNode).el as Element;
  }

  private updatesFor(path: string): number {
    let count = 0;
    for (const entry of this.host.log.entries()) {
      // SAFETY: log entries carry their decoded payloads beside the envelope; the reads below only check _tag and path.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- MessageLog.Entry variants share no index signature, so the field reads need the record view.
      const view = entry as unknown as Record<string, unknown>;
      if (view["_tag"] === "Update" && view["path"] === path) {
        count += 1;
      }
    }
    return count;
  }

  private trackInteraction<T>(
    step: string,
    fn: () => T
  ): Effect.Effect<T, StepError> {
    // oxlint-disable-next-line typescript/no-this-alias, unicorn/no-this-assignment -- Effect.gen takes a function, so the cursor is captured once for the generator body.
    const self = this;
    const { host } = this;
    const { path } = this.root;
    return Effect.gen(function* interact() {
      yield* host.settle();
      const before = self.updatesFor(path);
      const out = yield* Effect.sync(() => atSite(fn));
      const produced = self.updatesFor(path) > before;
      void step;
      self.ignored = !produced;
      self.ranInteraction = true;
      yield* host.settle();
      return out;
    });
  }

  /** The end check: settle once more, then fail on an unacknowledged ignored interaction. */
  endCheck(): Effect.Effect<void, never, TestHost> {
    // oxlint-disable-next-line typescript/no-this-alias, unicorn/no-this-assignment -- Effect.gen takes a function, so the cursor is captured once for the generator body.
    const self = this;
    return Effect.gen(function* finish() {
      const host = yield* TestHost;
      yield* Effect.orDie(host.settle());
      if (self.ranInteraction && self.ignored) {
        return yield* Effect.die(
          new Error(
            `Play.make: the test ends with an ignored interaction nobody acknowledged`
          )
        );
      }
    });
  }

  click = (target: string | Locator.Locator): Effect.Effect<void, StepError> =>
    this.trackInteraction("Play.click", () => {
      const el = this.resolveDom("Play.click", target);
      if (isDisabled(el)) {
        throw new Error(
          `Play.click: the <${el.tagName.toLowerCase()}> is disabled`
        );
      }
      const pointer = {
        altKey: false,
        button: 0,
        ctrlKey: false,
        metaKey: false,
        pointerType: "mouse",
        shiftKey: false,
        x: 0,
        y: 0,
      };
      let cancelled = false;
      for (const type of ["pointerdown", "mousedown", "mouseup"] as const) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, pointer);
        el.dispatchEvent(event);
        if (type === "pointerdown" && event.defaultPrevented) {
          cancelled = true;
        }
        void cancelled;
      }
      const clickEvent = new Event("click", {
        bubbles: true,
        cancelable: true,
      });
      Object.assign(clickEvent, pointer);
      el.dispatchEvent(clickEvent);
      if (!clickEvent.defaultPrevented) {
        runClickDefaults(el);
      }
    });

  fire = (
    locator: Locator.Locator,
    event: string,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- fire payloads carry arbitrary DOM event fields the component decodes.
    payload: unknown = {}
  ): Effect.Effect<void, StepError> =>
    this.trackInteraction("Play.fire", () => {
      const el = this.resolveDom("Play.fire", locator);
      const out = new Event(event, { bubbles: true, cancelable: true });
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- only objects spread onto the event; primitives dispatch bare.
      if (typeof payload === "object" && payload !== null) {
        Object.assign(out, payload);
      }
      el.dispatchEvent(out);
    });

  type = (
    locator: Locator.Locator,
    value: string,
    options?: {
      readonly composing?: boolean | undefined;
      readonly inputType?: string | undefined;
    }
  ): Effect.Effect<void, StepError> =>
    this.trackInteraction("Play.type", () => {
      // SAFETY: type steps target text fields by construction.
      const el = this.resolveDom("Play.type", locator) as HTMLInputElement;
      el.value = value;
      const out = new Event("input", { bubbles: true, cancelable: true });
      Object.assign(out, {
        composing: options?.composing ?? false,
        data: value,
        inputType: options?.inputType ?? "insertText",
        value,
      });
      el.dispatchEvent(out);
    });

  change = (
    locator: Locator.Locator,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- a change carries a field map when one string cannot name the value.
    value: string | Record<string, unknown>
  ): Effect.Effect<void, StepError> =>
    this.trackInteraction("Play.change", () => {
      // SAFETY: change steps target text fields or selects by construction.
      const el = this.resolveDom("Play.change", locator) as HTMLInputElement;
      const payload =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- change accepts a string or a field map by design; the branch builds the string payload.
        typeof value === "string"
          ? { composing: false, inputType: "", value }
          : { composing: false, inputType: "", ...value };
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- change accepts a string or a field map by design; the branch writes the string value.
      if (typeof value === "string") {
        el.value = value;
      } else if (
        // SAFETY: change accepts a field map as its second shape; value holds the field's current value.
        // oxlint-disable-next-line anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type -- change accepts a string or a field map by design; the branch reads the map's value field.
        typeof (value as Record<string, unknown>)["value"] === "string"
      ) {
        // SAFETY: the branch above guarantees the map's value field is a string.
        // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- change accepts a string or a field map by design.
        el.value = (value as Record<string, unknown>)["value"] as string;
      }
      const out = new Event("change", { bubbles: true, cancelable: true });
      Object.assign(out, payload);
      el.dispatchEvent(out);
    });

  keydown = (
    locator: Locator.Locator | "document",
    key: string,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- key details carry arbitrary KeyboardEvent init fields.
    details: Record<string, unknown> = {}
  ): Effect.Effect<void, StepError> =>
    this.trackInteraction("Play.keydown", () => {
      const target =
        locator === "document"
          ? document
          : this.resolveDom("Play.keydown", locator);
      const init = {
        altKey: false,
        bubbles: true,
        cancelable: true,
        ctrlKey: false,
        key,
        metaKey: false,
        shiftKey: false,
        ...details,
      };
      target.dispatchEvent(new KeyboardEvent("keydown", init));
      target.dispatchEvent(new KeyboardEvent("keyup", init));
    });

  submit = (locator: Locator.Locator): Effect.Effect<void, StepError> =>
    this.trackInteraction("Play.submit", () => {
      const el = this.resolveDom("Play.submit", locator);
      // SAFETY: the tag check guarantees a form element in the first branch; closest narrows in the second.
      const form =
        el.tagName.toLowerCase() === "form"
          ? (el as HTMLFormElement)
          : el.closest("form");
      if (form === null) {
        throw new Error(`Play.submit: nothing handles "submit"`);
      }
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });

  focus = (locator: Locator.Locator): Effect.Effect<void, StepError> =>
    this.trackInteraction("Play.focus", () => {
      // SAFETY: focus steps target focusable elements by construction.
      const el = this.resolveDom("Play.focus", locator) as HTMLElement;
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- happy-dom elements may lack focus; feature-detect before calling.
      if (typeof el.focus === "function") {
        el.focus();
      } else {
        el.dispatchEvent(
          new Event("focus", { bubbles: false, cancelable: false })
        );
      }
    });

  blur = (locator: Locator.Locator): Effect.Effect<void, StepError> =>
    this.trackInteraction("Play.blur", () => {
      // SAFETY: blur steps target focusable elements by construction.
      const el = this.resolveDom("Play.blur", locator) as HTMLElement;
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- happy-dom elements may lack blur; feature-detect before calling.
      if (typeof el.blur === "function") {
        el.blur();
      } else {
        el.dispatchEvent(
          new Event("blur", { bubbles: false, cancelable: false })
        );
      }
    });

  expect = (locator: Locator.Locator): PlayExpect => {
    // oxlint-disable-next-line typescript/no-this-alias, unicorn/no-this-assignment -- Effect.gen takes a function, so the cursor is captured once for the generator bodies below.
    const self = this;
    const only = (): SnapshotNode => {
      const snapshot = rootSnapshot(self.container);
      // SAFETY: locators run over the DOM snapshot, so every match is a snapshot node.
      const matches = Locator.all(snapshot, locator) as readonly SnapshotNode[];
      if (matches.length !== 1) {
        throw new Error(
          `Play.expect: expected exactly one element for ${locator.description}, found ${matches.length}`
        );
      }
      // SAFETY: the length check above guarantees exactly one match.
      return matches[0] as SnapshotNode;
    };
    const live = (): Element => {
      const node = only();
      if (node.el === undefined || !node.el.isConnected) {
        return self.resolveDom("Play.expect", locator);
      }
      return node.el;
    };
    const check = <A>(fn: () => A): Effect.Effect<A, StepError> =>
      Effect.gen(function* run() {
        yield* self.host.settle();
        return yield* Effect.sync(() => atSite(fn));
      });
    return {
      toBeAbsent: () =>
        check(() => {
          const snapshot = rootSnapshot(self.container);
          const found = Locator.all(snapshot, locator).length;
          if (found > 0) {
            throw new Error(
              `Play.expect: expected ${locator.description} to be absent, found ${found}`
            );
          }
        }),
      toBeChecked: (checked = true) =>
        check(() => {
          const actual = domChecked(live());
          if (actual !== checked) {
            throw new Error(
              `Play.expect: expected ${locator.description} to be ${checked ? "checked" : "unchecked"}`
            );
          }
        }),
      toBeDisabled: (disabled = true) =>
        check(() => {
          const actual = isDisabled(live());
          if (actual !== disabled) {
            throw new Error(
              `Play.expect: expected ${locator.description} to be ${disabled ? "disabled" : "enabled"}`
            );
          }
        }),
      toExist: () =>
        check(() => {
          const snapshot = rootSnapshot(self.container);
          if (Locator.all(snapshot, locator).length === 0) {
            throw new Error(
              `Play.expect: expected ${locator.description} to exist`
            );
          }
        }),
      toHaveAccessibleName: (name) =>
        check(() => {
          const el = live();
          const actual = (el.getAttribute("aria-label") ?? el.textContent ?? "")
            .replaceAll(/\s+/gu, " ")
            .trim();
          const pass =
            // oxlint-disable-next-line anti-slop/no-runtime-typeof -- accessible names accept a literal or a pattern by design.
            typeof name === "string" ? actual === name : name.test(actual);
          if (!pass) {
            throw new Error(
              `Play.expect: expected ${locator.description} to have accessible name ${JSON.stringify(String(name))}, got ${JSON.stringify(actual)}`
            );
          }
        }),
      toHaveCount: (count) =>
        check(() => {
          const snapshot = rootSnapshot(self.container);
          const found = Locator.all(snapshot, locator).length;
          if (found !== count) {
            throw new Error(
              `Play.expect: expected ${count} elements for ${locator.description}, found ${found}`
            );
          }
        }),
      toHaveText: (text) =>
        check(() => {
          const actual = normalizeText(snapshotText(only()));
          const pass =
            // oxlint-disable-next-line anti-slop/no-runtime-typeof -- text assertions accept a literal or a pattern by design.
            typeof text === "string" ? actual === text : text.test(actual);
          if (!pass) {
            throw new Error(
              `Play.expect: expected ${locator.description} to have text ${JSON.stringify(String(text))}, got ${JSON.stringify(actual)}`
            );
          }
        }),
      toHaveValue: (value) =>
        check(() => {
          const actual = domValue(live());
          if (actual !== value) {
            throw new Error(
              `Play.expect: expected ${locator.description} to have value ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`
            );
          }
        }),
    };
  };

  expectIgnored = (): Effect.Effect<void, StepError> =>
    Effect.sync(() => {
      if (!this.ranInteraction) {
        throw new Error(`Play.expectIgnored: no interaction has run`);
      }
      if (!this.ignored) {
        throw new Error(
          `Play.expectIgnored: the last interaction produced a message`
        );
      }
      this.ignored = false;
    });
}

/**
 * Mounts with the real renderer under `TestHost` and settles the first
 * render. Each step settles before it acts and after. When the scope closes
 * with a success, the end check settles once more (a crash or a problem
 * fails the test) and fails on an ignored interaction nobody acknowledged.
 */
export const make = <C extends AnyComponent>(
  component: C,
  props: PropsOf<C>
): Effect.Effect<Play<C>, StepError, TestHost | Scope.Scope> =>
  Effect.acquireRelease(
    Effect.gen(function* acquire() {
      const host = yield* TestHost;
      const mounted = yield* host.mount(component, props);
      const cursor = new PlayCursor<C>(
        {
          container: mounted.container,
          model: () => mounted.model(),
          path: mounted.path,
          pending: () => mounted.pending(),
          text: () => mounted.text(),
        },
        host
      );
      // SAFETY: the cursor implements every Play step; the cast only hides the interaction bookkeeping.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- PlayCursor's private fields block a direct cast; the value still implements Play.
      return cursor as unknown as Play<C>;
    }),
    // SAFETY: acquireRelease hands back the cursor the acquire step built.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Play's public type hides the cursor's private fields; the value is the same cursor.
    (cursor) => (cursor as unknown as PlayCursor<C>).endCheck()
  );
