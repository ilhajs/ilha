/**
 * `@ilha/model/test`: Story, Scene, Play, Locators, fakes, `ssr()` and the
 * shared step vocabulary. `Story` and `Scene` run the pure engine;
 * `Play` mounts with the real renderer under `TestHost.layer`.
 */
// oxlint-disable-next-line no-barrel-file -- test entrypoint barrel over the sibling slice namespaces by design.
export * as DomLocator from "./dom-locator.ts";
export * as Engine from "./engine.ts";
export * as Locator from "./locator.ts";
export * as Play from "./play.ts";
export * as Scene from "./scene.ts";
export * as Steps from "./steps.ts";
export * as Story from "./story.ts";
export * as Ssr from "./ssr.ts";
export * as TestFiles from "./test-files.ts";
export * as TestHost from "./test-host.ts";
export * as TestImages from "./test-images.ts";
export * as TestQuery from "./test-query.ts";
