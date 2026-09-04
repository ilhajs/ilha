import { describe, expect, test } from "bun:test";

import type { HeadStore } from "./head";
import {
  __setHeadAlsBypassForTests,
  __setHeadInWebcontainerForTests,
  head,
  serializeHead,
  withHeadStore,
} from "./head";

describe("withHeadStore WebContainer fallback", () => {
  test("serialized overlapping page and frame renders keep separate entries", async () => {
    __setHeadInWebcontainerForTests(true);
    __setHeadAlsBypassForTests(true);
    try {
      const pageGate = Promise.withResolvers<null>();

      const pageStore: HeadStore = { entries: [] };
      const frameStore: HeadStore = { entries: [] };

      const page = withHeadStore(pageStore, async () => {
        head({ title: "Page Home" });
        head({ meta: [{ content: "page", name: "x-ilha-render" }] });
        await pageGate.promise;
        return serializeHead(pageStore.entries);
      });

      // Queued behind `page` while it holds the sync fallback store.
      const frame = withHeadStore(frameStore, async () => {
        head({ title: "Frame Island" });
        head({ meta: [{ content: "frame", name: "x-ilha-render" }] });
        await Promise.resolve();
        return serializeHead(frameStore.entries);
      });

      pageGate.resolve(null);
      const [pageHead, frameHead] = await Promise.all([page, frame]);

      expect(pageHead.headTags).toContain("<title>Page Home</title>");
      expect(pageHead.headTags).toContain('content="page"');
      expect(pageHead.headTags).not.toContain("Frame Island");
      expect(pageHead.headTags).not.toContain('content="frame"');

      expect(frameHead.headTags).toContain("<title>Frame Island</title>");
      expect(frameHead.headTags).toContain('content="frame"');
      expect(frameHead.headTags).not.toContain("Page Home");
      expect(frameHead.headTags).not.toContain('content="page"');
    } finally {
      __setHeadAlsBypassForTests(false);
      __setHeadInWebcontainerForTests(null);
    }
  });
});
