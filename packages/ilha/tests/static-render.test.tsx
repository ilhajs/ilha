// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";

const Row = ({ label }: { label?: unknown }) => <li>{String(label)}</li>;

const List = () => {
  const n = atom(3);
  return (
    <ul>
      <Row label="a" />
      <Row label="b" />
      <li>{n}</li>
    </ul>
  );
};

test("static renders omit hole hosts", async () => {
  const html = await renderToString(List, { markers: false, snapshot: false });
  expect(html).toBe("<ul><li>a</li><li>b</li><li>3</li></ul>");
});

test("hydratable renders keep hole hosts", async () => {
  const full = await renderToString(List);
  expect(full).toContain("data-ilha-slot");
  const bare = await renderToString(List, { markers: false });
  expect(bare).toContain("data-ilha-slot");
});

test("a markers:false render with a snapshot still hydrates", async () => {
  const html = await renderToString(List, { markers: false });
  const host = document.createElement("div");
  host.append(
    ...new DOMParser().parseFromString(html, "text/html").body.childNodes
  );
  document.body.append(host);
  mount(host, List, { hydrate: true });
  await Bun.sleep(15);
  expect(host.textContent).toBe("ab3");
  host.remove();
});
