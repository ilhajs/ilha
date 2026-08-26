/**
 * Ilha internals — consumed by the JSX runtime and first-party integrations
 * (@ilha/router, @ilha/astro). Not public API: anything here may change in
 * any release.
 */

import type { NativeEventHandler, NativeEventModifier, RawHtml } from "./index";

export type ServerAction<A extends unknown[] = unknown[], R = unknown> = ((...args: A) => R) & {
  with: (...args: unknown[]) => (...runtimeArgs: unknown[]) => unknown;
};

type ServerActionBinder = <A extends unknown[], R>(
  fn: (...args: A) => R,
  manifestId?: string,
) => ServerAction<A, R>;

let serverActionBinder: ServerActionBinder | undefined;

/** @internal Register core's action branding implementation. */
export function setServerActionBinder(binder: ServerActionBinder): void {
  serverActionBinder = binder;
}

/** @internal Brand an external server action for hydration-manifest replay. */
export function bindServerAction<A extends unknown[], R>(
  fn: (...args: A) => R,
  manifestId?: string,
): ServerAction<A, R> {
  if (!serverActionBinder) throw new Error("ilha: server action binder is unavailable");
  return serverActionBinder(fn, manifestId);
}

/** Registry of live island mount handles keyed by host element. */
export const ISLAND_MOUNT_HANDLES: WeakMap<
  Element,
  {
    unmount: () => void | Promise<void>;
    updateProps: (props?: Record<string, unknown>) => void;
  }
> = new WeakMap();

/** Hook a parent's mountSlots uses to mount a child island and keep a handle
 * for pushing updated props on later parent re-renders. */
export const ISLAND_MOUNT_INTERNAL = Symbol.for("ilha.islandMountInternal");

export interface JsxEventRegistration {
  type: string;
  handler: NativeEventHandler;
  modifier?: NativeEventModifier;
}

/**
 * Bridge between the framework-agnostic JSX runtime and the active render.
 * The core registers an implementation at module init; before that (or
 * outside an island render) event registration yields no sentinel.
 */
export interface JsxRuntimeBridge {
  registerEvent(registration: JsxEventRegistration): number | undefined;
  /** Compose a child-island slot marker for direct `<Island />` calls. */
  slot(options: {
    island: unknown;
    props: Record<string, unknown> | undefined;
    key: string | undefined;
  }): RawHtml;
}

let bridge: JsxRuntimeBridge | null = null;

/** Register the core's bridge implementation. Internal — called once by ilha. */
export function setJsxRuntimeBridge(implementation: JsxRuntimeBridge): void {
  bridge = implementation;
}

/** @internal Register a native event handler with the active render context. */
export function __ilhaJsxEvent(registration: JsxEventRegistration): number | undefined {
  return bridge?.registerEvent(registration);
}

/** @internal Preserve island slot composition from the JSX runtime. */
export function __ilhaJsxSlot(options: {
  island: unknown;
  props: Record<string, unknown> | undefined;
  key: string | undefined;
}): RawHtml {
  return (
    bridge?.slot(options) ?? ({ [Symbol.for("ilha.raw")]: true, value: "" } as unknown as RawHtml)
  );
}

/** A hydration-manifest entry: sentinel key → action id or captured payload. */
export type ManifestEntry = string | { k: string; a: unknown[] };

export interface ServerManifestSerializer {
  /**
   * Serialize one island's event→action manifest into markup hoisted ahead of
   * the island HTML (e.g. a `<template data-ilha-actions>` element).
   */
  template(manifest: Map<string, ManifestEntry>): string;
}

let serverManifestSerializer: ServerManifestSerializer | null = null;

/**
 * Register the server-manifest serializer. Owned by @ilha/router — core only
 * collects manifest data and delegates all markup serialization to the
 * registered adapter (no-op until one registers).
 */
export function setServerManifestSerializer(serializer: ServerManifestSerializer | null): void {
  serverManifestSerializer = serializer;
}

/** @internal Used by island rendering to serialize nested child manifests. */
export function serializeServerManifest(manifest: Map<string, ManifestEntry>): string {
  if (!serverManifestSerializer || manifest.size === 0) return "";
  return serverManifestSerializer.template(manifest);
}
