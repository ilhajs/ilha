// @jsxImportSource ilha
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { atom } from "ilha";
import type { View } from "ilha";
import type { VoidRouter } from "void/pages-client";
import { parseCacheFor } from "void/pages-prefetch";
import type { PageObject } from "void/pages-protocol";

import { startPages } from "./client";
import { createPageRenderer } from "./server";
import { pageModule, parseDocument, setLocation, settle } from "./test-helpers";

const CounterPage = ({ name }: { name: string }): View => {
  const count = atom(0);
  return (
    <div class="counter">
      <span class="name">{name}</span>
      <button class="bump" onclick={() => count.update((value) => value + 1)}>
        {count}
      </button>
    </div>
  );
};

const components = { "users/[id]": pageModule(CounterPage) };

const matchRoute = (url: string): string | null => {
  const { pathname } = new URL(url, "http://x");
  return pathname.startsWith("/users/") ? "users/[id]" : null;
};

const userPage = (id: string, search: string): PageObject => ({
  component: "users/[id]",
  errors: null,
  params: { id },
  props: { name: `User ${id}${search}` },
  shared: {},
  url: `/users/${id}${search}`,
});

const respond = (page: PageObject): Response =>
  Response.json(page, { headers: { "X-VoidPages": "true" } });

/** Answer like Void's page endpoint, echoing the query into the name. */
const pageEndpoint = (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(String(input), window.location.origin);
  const id = url.pathname.split("/").at(-1) ?? "";
  return Promise.resolve(respond(userPage(id, url.search)));
};

const text = (selector: string): string | null | undefined =>
  document.querySelector(selector)?.textContent;

const realFetch = globalThis.fetch;
let router: VoidRouter | undefined;

describe("startPages preserveState", () => {
  beforeAll(async () => {
    const html = await createPageRenderer({ components, layoutTree: {} })(
      userPage("7", ""),
      { body: "", css: "", preloads: "" }
    );
    setLocation("http://localhost:3000/users/7");
    document.body.replaceChildren(
      ...[...parseDocument(html).body.childNodes].map((node) =>
        document.importNode(node, true)
      )
    );
    // SAFETY: the mock answers the calls Void makes; tests never use `preconnect`.
    globalThis.fetch = pageEndpoint as typeof fetch;
    router = await startPages({
      components,
      layoutTree: {},
      matchRoute,
      prefetchDefaultCacheFor: parseCacheFor("30s"),
      prefetchHoverDelay: 75,
      routeMeta: {},
      staticPageData: false,
      staticPageDataFastPath: false,
      viewTransitions: false,
    });
    await settle();
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    document.body.replaceChildren();
  });

  it("remounts the page on a plain visit", async () => {
    document.querySelector<HTMLButtonElement>(".bump")?.click();
    document.querySelector<HTMLButtonElement>(".bump")?.click();
    document.querySelector<HTMLButtonElement>(".bump")?.click();
    await settle();
    expect(text(".bump")).toBe("3");

    await router?.visit("/users/8?x=1");
    await settle();

    expect(window.location.pathname + window.location.search).toBe(
      "/users/8?x=1"
    );
    expect(text(".name")).toBe("User 8?x=1");
    expect(text(".bump")).toBe("0");
  });

  it("keeps page state when preserving on the same page and params", async () => {
    document.querySelector<HTMLButtonElement>(".bump")?.click();
    document.querySelector<HTMLButtonElement>(".bump")?.click();
    await settle();
    expect(text(".bump")).toBe("2");

    await router?.visit("/users/8?x=2", { preserveState: true });
    await settle();

    // The new props painted, so the visit was real — yet the counter
    // survived, so the page kept its key instead of remounting.
    expect(text(".name")).toBe("User 8?x=2");
    expect(text(".bump")).toBe("2");
  });

  it("remounts when params change even with preserveState", async () => {
    await router?.visit("/users/9", { preserveState: true });
    await settle();

    expect(text(".name")).toBe("User 9");
    expect(text(".bump")).toBe("0");
  });

  it("remounts the same page without preserveState", async () => {
    document.querySelector<HTMLButtonElement>(".bump")?.click();
    await settle();
    expect(text(".bump")).toBe("1");

    await router?.visit("/users/9?y=1");
    await settle();

    expect(text(".name")).toBe("User 9?y=1");
    expect(text(".bump")).toBe("0");
  });
});
