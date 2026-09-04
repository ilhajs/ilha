import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { renderToString, when } from "../src/index.ts";

test("renderToString renders when() children without document", async () => {
  const doc = globalThis.document;
  // SAFETY: test temporarily deletes document; globalThis is the runtime host.
  const g = globalThis as { document?: Document };
  delete g.document;
  try {
    const html = await renderToString(function* app() {
      yield* when(Stream.fromIterable(["q"]), function* search(q) {
        yield `searching ${q}`;
        yield Effect.sleep(1);
        yield `result for ${q}`;
      });
    });
    expect(html).toContain("result for q");
    expect(html).not.toContain("searching");
  } finally {
    g.document = doc;
  }
});
