// @jsxImportSource ilha
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { atom } from "ilha";
import type { View } from "ilha";
import type { VoidRouter } from "void/pages-client";
import { parseCacheFor } from "void/pages-prefetch";
import type { PageObject } from "void/pages-protocol";

import { startPages } from "./client";
import { Form } from "./form";
import { useParams } from "./hooks";
import { mountIsland } from "./islands";
import { Link } from "./link";
import { createIsland, createPageRenderer } from "./server";
import { pageModule, parseDocument, setLocation, settle } from "./test-helpers";
import { useForm } from "./use-form";

/** Seed for page atoms: SSR and hydration see different values on purpose. */
let visitsSeed = 3;

const Layout = ({ children }: { children?: View }): View => {
  const clicks = atom(0);
  return (
    <div class="layout">
      <button class="layout-clicks" onclick={() => clicks.update((n) => n + 1)}>
        {clicks}
      </button>
      <Link class="to-nine" href="/users/9">
        nine
      </Link>
      {children}
    </div>
  );
};

const UserPage = ({ name }: { name: string }): View => {
  const { id } = useParams<{ id: string }>();
  const visits = atom(visitsSeed);
  return (
    <p class="user">
      <span class="who">{`${name} #${id}`}</span>
      <span class="visits">{visits}</span>
    </p>
  );
};

const FormPage = (): View => {
  const form = useForm("/form", { text: "" });
  return (
    <Form class="todo" form={form}>
      <input
        value={form.data.text}
        oninput={(event) => form.setData("text", event.currentTarget.value)}
      />
      <span class="field-error">{form.errors.text ?? ""}</span>
      <span class="success">{String(form.wasSuccessful)}</span>
      <button type="submit">Add</button>
    </Form>
  );
};

const Counter = ({ start }: { start: number }): View => {
  const count = atom(start);
  return (
    <button type="button" onclick={() => count.update((n) => n + 1)}>
      {count}
    </button>
  );
};

const components = {
  form: pageModule(FormPage),
  "layout:root": pageModule(Layout),
  "users/[id]": pageModule(UserPage),
};

const layoutTree = { form: ["layout:root"], "users/[id]": ["layout:root"] };

const matchRoute = (url: string): string | null => {
  const { pathname } = new URL(url, "http://x");
  if (pathname === "/form") {
    return "form";
  }
  return pathname.startsWith("/users/") ? "users/[id]" : null;
};

const noAssets = { body: "", css: "", preloads: "" };

const userPage = (id: string): PageObject => ({
  component: "users/[id]",
  errors: null,
  params: { id },
  props: { name: `User ${id}` },
  shared: {},
  url: `/users/${id}`,
});

const formPage = (errors: Record<string, string> | null): PageObject => ({
  component: "form",
  errors,
  params: {},
  props: {},
  shared: {},
  url: "/form",
});

interface RecordedRequest {
  method: string;
  url: string;
  body?: string;
}

const requests: RecordedRequest[] = [];

const respond = (page: PageObject): Response =>
  Response.json(page, { headers: { "X-VoidPages": "true" } });

/** Answer like Void's page endpoint: page data for GETs and actions. */
const pageEndpoint = (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const url = new URL(String(input), window.location.origin);
  const method = init?.method ?? "GET";
  // Void sends JSON bodies as strings; multipart bodies don't occur here.
  const body = String(init?.body ?? "") || undefined;
  requests.push({ body, method, url: url.pathname });
  if (url.pathname === "/form") {
    const submitted: { text?: string } = body ? JSON.parse(body) : {};
    return Promise.resolve(
      respond(formPage(submitted.text ? null : { text: "Required" }))
    );
  }
  return Promise.resolve(
    respond(userPage(url.pathname.split("/").at(-1) ?? ""))
  );
};

const text = (selector: string): string | null | undefined =>
  document.querySelector(selector)?.textContent;

const realFetch = globalThis.fetch;
let router: VoidRouter | undefined;

describe("startPages", () => {
  beforeAll(async () => {
    const html = await createPageRenderer({ components, layoutTree })(
      userPage("7"),
      noAssets
    );
    setLocation("http://localhost:3000/users/7");
    document.body.replaceChildren(
      ...[...parseDocument(html).body.childNodes].map((node) =>
        document.importNode(node, true)
      )
    );
    // SAFETY: the mock answers the calls Void makes; tests never use `preconnect`.
    globalThis.fetch = pageEndpoint as typeof fetch;
    visitsSeed = 99;
    router = await startPages({
      components,
      layoutTree,
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

  it("hydrates the server render and restores atom state", () => {
    expect(document.querySelector<HTMLElement>("#app")?.dataset.hydrated).toBe(
      "true"
    );
    expect(text(".who")).toBe("User 7 #7");
    // The snapshot wins over the client seed.
    expect(text(".visits")).toBe("3");
  });

  it("navigates without reloading and keeps layout state", async () => {
    document.querySelector<HTMLButtonElement>(".layout-clicks")?.click();
    await settle();
    expect(text(".layout-clicks")).toBe("1");

    await router?.visit("/users/8");
    await settle();

    expect(window.location.pathname).toBe("/users/8");
    expect(text(".who")).toBe("User 8 #8");
    expect(text(".layout-clicks")).toBe("1");
    // A new route remounts the page, so its atoms start from the seed.
    expect(text(".visits")).toBe("99");
    expect(requests.at(-1)).toMatchObject({ method: "GET", url: "/users/8" });
  });

  it("routes <Link> clicks through the Void Router", async () => {
    const before = requests.length;
    document.querySelector<HTMLAnchorElement>("a.to-nine")?.click();
    await settle();

    expect(window.location.pathname).toBe("/users/9");
    expect(text(".who")).toBe("User 9 #9");
    expect(text(".layout-clicks")).toBe("1");
    expect(requests.slice(before)).toEqual([
      { body: undefined, method: "GET", url: "/users/9" },
    ]);
  });

  it("paints the new page before a view transition captures it", async () => {
    const seen: (string | null | undefined)[] = [];
    // SAFETY: happy-dom has no View Transitions API; the stub mimics the
    // part Void uses: run the callback, then settle `updateCallbackDone`.
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => Promise<void> | void) => ({
        updateCallbackDone: (async () => {
          await update();
          seen.push(text(".who"));
        })(),
      }),
    });
    try {
      await router?.visit("/users/10", { viewTransition: true });
    } finally {
      Reflect.deleteProperty(document, "startViewTransition");
    }
    expect(seen).toEqual(["User 10 #10"]);
  });

  it("submits useForm through the router and shows validation errors", async () => {
    await router?.visit("/form");
    await settle();
    document.querySelector<HTMLFormElement>("form.todo")?.requestSubmit();
    await settle();

    expect(requests.at(-1)).toMatchObject({ method: "POST", url: "/form" });
    expect(text(".field-error")).toBe("Required");
    expect(text("[data-void-form-error]")).toBe("Required");
    expect(text(".layout-clicks")).toBe("1");
  });

  it("marks a successful submit and clears errors", async () => {
    const input = document.querySelector<HTMLInputElement>("form.todo input");
    if (!input) {
      throw new Error("form input missing");
    }
    input.value = "milk";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    document.querySelector<HTMLFormElement>("form.todo")?.requestSubmit();
    await settle();

    expect(JSON.parse(requests.at(-1)?.body ?? "{}")).toEqual({ text: "milk" });
    expect(text(".field-error")).toBe("");
    expect(text(".success")).toBe("true");
  });
});

describe("mountIsland", () => {
  it("hydrates an island from its marker and snapshot", async () => {
    const Island = createIsland(Counter, { hydrate: "load", id: "counter" });
    const html = await createPageRenderer({
      components: { page: pageModule(() => <Island start={4} />) },
      layoutTree: {},
    })(
      {
        component: "page",
        errors: null,
        params: {},
        props: {},
        shared: {},
        url: "/",
      },
      noAssets
    );
    const marker =
      parseDocument(html).querySelector<HTMLElement>("[data-island]");
    if (!marker) {
      throw new Error("island marker missing");
    }
    const host = document.importNode(marker, true);
    document.body.replaceChildren(host);

    mountIsland(
      host,
      { default: Counter },
      JSON.parse(host.dataset.props ?? "{}")
    );
    await settle();
    host.querySelector("button")?.click();
    await settle();

    expect(host.dataset.hydrated).toBe("true");
    expect(host.querySelector("button")?.textContent).toBe("5");
    expect(host.querySelectorAll("[data-ilha]")).toHaveLength(1);
  });
});
