import { expect, test } from "bun:test";

import { renderHtml } from "ilha/test";

import Counter from "./_counter.tsx";

test("renders the counter with its start value", async () => {
  // Without markers and snapshot the HTML has no hole hosts, so text reads plainly.
  const html = await renderHtml(() => <Counter start={3} />, {
    markers: false,
    snapshot: false,
  });
  expect(html).toContain("Clicked 3 times");
});
