import { paint, paintError } from "./paint.ts";
import { closeFiber, makeFiber, makeRuntime } from "./runtime.ts";
import { decodeSnapshot, encodeSnapshot } from "./snapshot.ts";
import { escapeAttr } from "./ssr-dom.ts";
import { attachSsr } from "./ssr-paint.ts";
import { runSetup } from "./start.ts";
import type { Component, IlhaRuntime } from "./types.ts";

export type RenderToStringOptions = {
  snapshot?: boolean;
  markers?: boolean;
  timeout?: number;
  captureActions?: boolean;
};

export type MountOptions = {
  hydrate?: boolean;
  onError?: (error: unknown) => void;
};

function readHydrate(el: Element): unknown[] | undefined {
  const host = el.hasAttribute("data-ilha") ? el : el.querySelector("[data-ilha]");
  const raw = host?.getAttribute("data-ilha-state");
  if (raw) return decodeSnapshot(raw);
  const first = el.firstElementChild;
  if (first?.tagName === "TEMPLATE" && first.hasAttribute("data-ilha-state")) {
    const tplRaw = first.getAttribute("data-ilha-state");
    first.remove();
    return tplRaw ? decodeSnapshot(tplRaw) : undefined;
  }
  return undefined;
}

function attach(
  el: Element,
  fn: Component,
  opts?: MountOptions,
): { unmount: () => void; ready: Promise<void>; runtime: IlhaRuntime } {
  if (!opts?.hydrate) el.innerHTML = "";
  const runtime = makeRuntime({
    hydrate: opts?.hydrate ? readHydrate(el) : undefined,
  });
  let resolve!: () => void;
  const ready = new Promise<void>((r) => {
    resolve = r;
  });
  const fiber = makeFiber(runtime, el, paint, {
    onFail: (e) => {
      opts?.onError?.(e);
      paintError(fiber, e);
      resolve();
    },
  });
  if (opts?.hydrate) fiber.hydrate = true;
  runtime.begin();
  runtime.setIdle(resolve);
  runSetup(fiber, fn);
  runtime.end();
  return {
    ready,
    runtime,
    unmount() {
      closeFiber(fiber);
      runtime.close();
      if (!opts?.hydrate) el.innerHTML = "";
    },
  };
}

export function mount(el: Element, fn: Component, opts?: MountOptions): () => void {
  return attach(el, fn, opts).unmount;
}

export async function renderToString(fn: Component, opts?: RenderToStringOptions): Promise<string> {
  const snapshot = opts?.snapshot !== false;
  const markers = opts?.markers !== false;
  const { unmount, ready, runtime, root } = attachSsr(fn, {
    ssrCapture: opts?.captureActions === true,
  });
  if (opts?.timeout == null) await ready;
  else {
    await Promise.race([ready, new Promise<void>((r) => setTimeout(r, opts.timeout))]);
  }
  let inner = root.innerHTML;
  const actions = runtime.ssrActions;
  if (Object.keys(actions).length > 0) {
    inner = `<template data-ilha-actions="${escapeAttr(JSON.stringify(actions))}"></template>${inner}`;
  }
  const snap = snapshot ? encodeSnapshot(runtime.ssrValues) : undefined;
  unmount();
  if (!markers) {
    return snap ? `<template data-ilha-state="${escapeAttr(snap)}"></template>${inner}` : inner;
  }
  const stateAttr = snap ? ` data-ilha-state="${escapeAttr(snap)}"` : "";
  return `<div data-ilha${stateAttr}>${inner}</div>`;
}
