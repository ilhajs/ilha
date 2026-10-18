import { inspect } from "./debug.ts";
import type { IlhaInspectNode } from "./debug.ts";
import { mountWithRuntime, renderToString } from "./mount.ts";
import type { RenderToStringOptions } from "./mount.ts";
import { isString, toError } from "./shared.ts";
import type { SnapshotValue } from "./snapshot.ts";
import type { Component, IlhaRuntime } from "./types.ts";

export type { IlhaInspectNode } from "./debug.ts";

export interface RenderOptions {
  /** Render on the server first and inject the HTML into the container. Default `false`. */
  ssr?: boolean;
  /**
   * Hydrate the container instead of mounting fresh. Default: the value of
   * `ssr`. With `hydrate: true` alone, the container must already hold
   * server markup.
   */
  hydrate?: boolean;
  /** Mount into this element. Default: a new `<div>` appended to `document.body`. */
  container?: Element;
  /** Called for a failing root component and for uncaught nested failures. */
  onError?: (error: Error) => void;
}

export interface AtomEntry {
  /** Name of the component that owns the atom. */
  component: string;
  /** Slot index, in registration order. */
  index: number;
  value: SnapshotValue | string;
}

export interface TestUi {
  /** Errors reported through `onError` so far. */
  readonly errors: readonly Error[];
  /** Resolves when the mount has no pending work left. Never uses timers. */
  settled: () => Promise<void>;
  click: (selector: string) => Promise<void>;
  /** Set `value` on the element, then fire a bubbling `input` event. */
  input: (selector: string, value: string) => Promise<void>;
  /** Set `value` (or `checked` for a boolean), then fire a bubbling `change` event. */
  change: (selector: string, value: string | boolean) => Promise<void>;
  /** Fire a bubbling, cancelable `submit` event. */
  submit: (selector: string) => Promise<void>;
  /** Dispatch any event on the first element that matches `selector`. */
  dispatch: (selector: string, event: Event) => Promise<void>;
  /** The container's `innerHTML`. */
  html: () => string;
  /** The container's `textContent`. */
  text: () => string;
  query: <E extends Element = Element>(selector: string) => E | null;
  queryAll: <E extends Element = Element>(selector: string) => E[];
  /** Live component tree from `ilha/debug`. */
  tree: () => IlhaInspectNode[];
  /** Every atom in the tree, in render order. */
  atoms: () => AtomEntry[];
  /** Stop the mount and remove a container the harness created. */
  unmount: () => void;
}

const MICROTASK_TURNS = 4;
const SNIPPET_LENGTH = 400;

const requireDocument = (): void => {
  if (!("document" in globalThis)) {
    throw new Error(
      "ilha/test needs a DOM. Preload happy-dom (bunfig.toml: [test] preload = ['./happydom.ts'] with GlobalRegistrator.register()), or use renderHtml() for DOM-free assertions."
    );
  }
};

const turn = async (left = MICROTASK_TURNS): Promise<void> => {
  await Promise.resolve();
  if (left > 1) {
    await turn(left - 1);
  }
};

const snippet = (html: string): string =>
  html.length > SNIPPET_LENGTH ? `${html.slice(0, SNIPPET_LENGTH)}…` : html;

/** Write `value` (or `checked`) onto a form control; false when it has no such field. */
const assign = (el: Element, value: string | boolean): boolean => {
  if (isString(value)) {
    if (!("value" in el)) {
      return false;
    }
    el.value = value;
    return true;
  }
  if (!("checked" in el)) {
    return false;
  }
  el.checked = value;
  return true;
};

const flatten = (nodes: IlhaInspectNode[]): AtomEntry[] =>
  nodes.flatMap((node) => [
    ...node.atoms.map(({ index, value }) => ({
      component: node.component,
      index,
      value,
    })),
    ...flatten(node.children),
  ]);

/**
 * Render `fn` to HTML without a DOM. Same output as `renderToString`, kept
 * here so tests import both helpers from `ilha/test`.
 */
export const renderHtml = (
  fn: Component,
  opts?: RenderToStringOptions
): Promise<string> => renderToString(fn, opts);

/**
 * Mount `fn` into a DOM container and return a handle that drives it.
 * Needs a DOM global (happy-dom). With `ssr`, the server render is async:
 * `await ui.settled()` before reading `html()`.
 */
export const render = (fn: Component, opts: RenderOptions = {}): TestUi => {
  requireDocument();
  const ssr = opts.ssr === true;
  const hydrate = opts.hydrate ?? ssr;
  const ownsContainer = opts.container === undefined;
  const container = opts.container ?? document.createElement("div");
  if (ownsContainer) {
    document.body.append(container);
  }

  const errors: Error[] = [];
  let pending = 0;
  let closed = false;
  let started = false;
  let failure: Error | undefined;
  let stop: (() => void) | undefined;
  let host: Element = container;
  let waiters: (() => void)[] = [];

  const wake = (): void => {
    const woken = waiters;
    waiters = [];
    for (const resolve of woken) {
      resolve();
    }
  };

  // Count begin/end ourselves: the runtime only reports the idle edge, and an
  // action that changes nothing never produces one.
  const track = (runtime: IlhaRuntime): void => {
    const { begin, end } = runtime;
    runtime.begin = () => {
      pending += 1;
      begin();
    };
    runtime.end = () => {
      pending -= 1;
      end();
      if (pending === 0) {
        wake();
      }
    };
  };

  const boot = async (): Promise<void> => {
    try {
      if (ssr) {
        container.innerHTML = await renderToString(fn);
      }
      if (hydrate || !ssr) {
        // renderToString wraps its output in a `[data-ilha]` host; hydrate that.
        host =
          (hydrate ? container.querySelector("[data-ilha]") : null) ??
          container;
        stop = mountWithRuntime(
          host,
          fn,
          {
            hydrate,
            onError: (error) => {
              errors.push(error);
              opts.onError?.(error);
            },
          },
          track
        );
      }
    } catch (error) {
      failure = toError(error);
    }
    started = true;
  };
  const ready = boot();

  const ensureStarted = (): void => {
    if (failure) {
      throw failure;
    }
    if (!started) {
      throw new Error(
        "ilha/test: the server render is still running. `await ui.settled()` before reading the DOM."
      );
    }
  };

  const nextIdle = (): Promise<null> => {
    const { promise, resolve } = Promise.withResolvers<null>();
    waiters.push(() => resolve(null));
    return promise;
  };

  // Yield a few microtask turns so queued rerenders register as pending, then
  // wait for the idle edge; work started by that rerender repeats the check.
  const quiesce = async (): Promise<void> => {
    await turn();
    if (pending === 0 || closed) {
      return;
    }
    await nextIdle();
    await quiesce();
  };

  const settled = async (): Promise<void> => {
    await ready;
    ensureStarted();
    await quiesce();
  };

  const requireElement = (selector: string): Element => {
    const el = container.querySelector(selector);
    if (!el) {
      throw new Error(
        `ilha/test: no element matches "${selector}". Current HTML: ${snippet(container.innerHTML)}`
      );
    }
    return el;
  };

  const dispatch = async (selector: string, event: Event): Promise<void> => {
    await settled();
    requireElement(selector).dispatchEvent(event);
    await settled();
  };

  const setField = async (
    selector: string,
    type: "input" | "change",
    value: string | boolean
  ): Promise<void> => {
    await settled();
    const el = requireElement(selector);
    if (!assign(el, value)) {
      throw new Error(
        `ilha/test: "${selector}" is not a form control that takes ${isString(value) ? "a value" : "checked"}.`
      );
    }
    el.dispatchEvent(new Event(type, { bubbles: true }));
    await settled();
  };

  const inspectRoot = (): IlhaInspectNode[] => {
    ensureStarted();
    return inspect(host);
  };

  return {
    atoms: () => flatten(inspectRoot()),
    change: (selector, value) => setField(selector, "change", value),
    click: (selector) =>
      dispatch(
        selector,
        new MouseEvent("click", { bubbles: true, cancelable: true })
      ),
    dispatch,
    get errors() {
      return errors;
    },
    html: () => {
      ensureStarted();
      return container.innerHTML;
    },
    input: (selector, value) => setField(selector, "input", value),
    query: <E extends Element = Element>(selector: string): E | null => {
      ensureStarted();
      return container.querySelector<E>(selector);
    },
    queryAll: <E extends Element = Element>(selector: string): E[] => {
      ensureStarted();
      return [...container.querySelectorAll<E>(selector)];
    },
    settled,
    submit: (selector) =>
      dispatch(
        selector,
        new Event("submit", { bubbles: true, cancelable: true })
      ),
    text: () => {
      ensureStarted();
      return container.textContent ?? "";
    },
    tree: inspectRoot,
    unmount: () => {
      if (closed) {
        return;
      }
      closed = true;
      stop?.();
      if (ownsContainer) {
        container.remove();
      }
      wake();
    },
  };
};
