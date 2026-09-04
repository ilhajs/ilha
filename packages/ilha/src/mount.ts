import { paint, paintError } from "./paint.ts";
import { closeFiber, makeFiber, makeRuntime } from "./runtime.ts";
import { decodeSnapshot, encodeSnapshot } from "./snapshot.ts";
import type { SnapshotValue } from "./snapshot.ts";
import { escapeAttr } from "./ssr-dom.ts";
import { attachSsr } from "./ssr-paint.ts";
import { runSetup } from "./start.ts";
import type { Component, IlhaRuntime } from "./types.ts";

export interface RenderToStringOptions {
  snapshot?: boolean;
  markers?: boolean;
  timeout?: number;
  captureActions?: boolean;
}

export interface MountOptions {
  hydrate?: boolean;
  onError?: <E>(error: E) => void;
}

export interface MountHandle {
  unmount: () => void;
  ready: Promise<null>;
  runtime: IlhaRuntime;
}

interface Deferred {
  promise: Promise<null>;
  resolve: () => void;
}

const defer = (): Deferred => {
  const { promise, resolve } = Promise.withResolvers<null>();
  return {
    promise,
    resolve: () => {
      resolve(null);
    },
  };
};

const readHydrate = (el: Element): SnapshotValue[] | undefined => {
  const host = el.matches("[data-ilha]") ? el : el.querySelector("[data-ilha]");
  const raw = host?.dataset.ilhaState;
  if (raw) {
    return decodeSnapshot(raw);
  }
  const first = el.firstElementChild;
  if (first?.tagName === "TEMPLATE" && first.matches("[data-ilha-state]")) {
    const tplRaw = first.dataset.ilhaState;
    first.remove();
    return tplRaw ? decodeSnapshot(tplRaw) : undefined;
  }
  return undefined;
};

const delay = (ms: number): Promise<null> => {
  const { promise, resolve } = defer();
  setTimeout(resolve, ms);
  return promise;
};

const attach = (
  el: Element,
  fn: Component,
  opts?: MountOptions
): MountHandle => {
  if (!opts?.hydrate) {
    el.innerHTML = "";
  }
  const runtime = makeRuntime({
    hydrate: opts?.hydrate ? readHydrate(el) : undefined,
  });
  const { promise: ready, resolve } = defer();
  const fiber = makeFiber(runtime, el, paint, {
    onFail: (e) => {
      opts?.onError?.(e);
      paintError(fiber, e);
      resolve();
    },
  });
  if (opts?.hydrate) {
    fiber.hydrate = true;
  }
  runtime.begin();
  runtime.setIdle(resolve);
  runSetup(fiber, fn);
  runtime.end();
  return {
    ready,
    runtime,
    unmount: () => {
      closeFiber(fiber);
      runtime.close();
      if (!opts?.hydrate) {
        el.innerHTML = "";
      }
    },
  };
};

export const mount = (
  el: Element,
  fn: Component,
  opts?: MountOptions
): (() => void) => attach(el, fn, opts).unmount;

export const renderToString = async (
  fn: Component,
  opts?: RenderToStringOptions
): Promise<string> => {
  const snapshot = opts?.snapshot !== false;
  const markers = opts?.markers !== false;
  const { unmount, ready, runtime, root } = attachSsr(fn, {
    ssrCapture: opts?.captureActions === true,
  });
  const timeout = opts?.timeout;
  await (timeout === undefined ? ready : Promise.race([ready, delay(timeout)]));
  let inner = root.innerHTML;
  const actions = runtime.ssrActions;
  if (Object.keys(actions).length > 0) {
    inner = `<template data-ilha-actions="${escapeAttr(JSON.stringify(actions))}"></template>${inner}`;
  }
  // SAFETY: ssrValues are JSON-serializable snapshot seeds collected during SSR.
  const snap = snapshot
    ? encodeSnapshot(runtime.ssrValues as SnapshotValue[])
    : undefined;
  unmount();
  if (!markers) {
    return snap
      ? `<template data-ilha-state="${escapeAttr(snap)}"></template>${inner}`
      : inner;
  }
  const stateAttr = snap ? ` data-ilha-state="${escapeAttr(snap)}"` : "";
  return `<div data-ilha${stateAttr}>${inner}</div>`;
};
