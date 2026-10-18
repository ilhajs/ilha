import { paint } from "./paint.ts";
import { decodeSnapshot, encodeSnapshot } from "./snapshot.ts";
import type { SnapshotValue } from "./snapshot.ts";
import { escapeAttr, serializeNode, SsrEl } from "./ssr-dom.ts";
import { paint as ssrPaint } from "./ssr-paint.ts";
import { startRoot } from "./start.ts";
import type { Component, IlhaRuntime, MountOptions } from "./types.ts";

export type { MountOptions } from "./types.ts";

export interface RenderToStringOptions {
  /** Embed atom state for hydration. Default `true`. */
  snapshot?: boolean;
  /** Wrap the output in a `<div data-ilha>` host. Default `true`. */
  markers?: boolean;
  /** Serialize after this many ms even if work is still pending. */
  timeout?: number;
}

const readSnapshot = (el: Element): SnapshotValue[] | undefined => {
  const host = el.matches("[data-ilha]") ? el : el.querySelector("[data-ilha]");
  // oxlint-disable-next-line unicorn/prefer-dom-node-dataset -- hosts may be non-HTML Elements
  const raw = host?.getAttribute("data-ilha-state");
  if (raw) {
    return decodeSnapshot(raw);
  }
  const first = el.firstElementChild;
  if (first?.matches("template[data-ilha-state]")) {
    first.remove();
    // oxlint-disable-next-line unicorn/prefer-dom-node-dataset -- hosts may be non-HTML Elements
    return decodeSnapshot(first.getAttribute("data-ilha-state") ?? "");
  }
  return undefined;
};

/** Mount with access to the root runtime; `ilha/test` uses it to see pending work. */
export const mountWithRuntime = (
  el: Element,
  fn: Component,
  opts?: MountOptions,
  onRuntime?: (runtime: IlhaRuntime) => void
): (() => void) => {
  const hydrate = opts?.hydrate === true;
  if (!hydrate) {
    el.innerHTML = "";
  }
  const { close } = startRoot({
    fn,
    hydrate,
    onError: opts?.onError,
    onIdle: opts?.onIdle,
    onRuntime,
    paint,
    root: el,
    snapshot: hydrate ? readSnapshot(el) : undefined,
  });
  return () => {
    close();
    if (!hydrate) {
      el.innerHTML = "";
    }
  };
};

export const mount = (
  el: Element,
  fn: Component,
  opts?: MountOptions
): (() => void) => mountWithRuntime(el, fn, opts);

export const renderToString = async (
  fn: Component,
  opts?: RenderToStringOptions
): Promise<string> => {
  const root = new SsrEl("");
  const { close, ready, runtime } = startRoot({
    fn,
    paint: ssrPaint,
    // SAFETY: the SSR root element stands in for ParentNode on the fiber.
    root: root as never,
    ssr: true,
  });
  const { timeout, snapshot = true, markers = true } = opts ?? {};
  if (timeout === undefined) {
    await ready;
  } else {
    const late = Promise.withResolvers<null>();
    const timer = setTimeout(late.resolve, timeout, null);
    await Promise.race([ready, late.promise]);
    clearTimeout(timer);
  }
  // Nothing can hydrate output without markers or snapshot: drop hole hosts.
  const inner = serializeNode(root, !markers && !snapshot);
  // SAFETY: ssrValues are JSON-serializable snapshot seeds collected during SSR.
  const state = snapshot
    ? ` data-ilha-state="${escapeAttr(encodeSnapshot(runtime.ssrValues as SnapshotValue[]))}"`
    : "";
  close();
  if (markers) {
    return `<div data-ilha${state}>${inner}</div>`;
  }
  return state ? `<template${state}></template>${inner}` : inner;
};
