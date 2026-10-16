// @jsxImportSource ilha
import { expect, it } from "bun:test";

import type { View } from "ilha";
import { parseCacheFor } from "void/pages-prefetch";
import type { PageObject } from "void/pages-protocol";

import { startPages } from "./client";
import { Form } from "./form";
import { createPageRenderer } from "./server";
import { pageModule, parseDocument, setLocation, settle } from "./test-helpers";
import { useForm } from "./use-form";

const Todos = ({ todos }: { todos: string[] }): View => {
  const form = useForm("/", { text: "" });
  return (
    <section>
      <ul>
        {todos.map((todo) => (
          <li key={todo}>{todo}</li>
        ))}
      </ul>
      <Form form={form}>
        <input
          name="text"
          value={form.data.text}
          oninput={(event) => form.setData("text", event.currentTarget.value)}
        />
        <button type="submit" disabled={form.pending}>
          Add
        </button>
      </Form>
    </section>
  );
};

const components = { index: pageModule(Todos) };
const page = (todos: string[]): PageObject => ({
  component: "index",
  errors: null,
  params: {},
  props: { todos },
  shared: {},
  url: "/",
});

const realFetch = globalThis.fetch;
let todos: string[] = ["a"];

/** Submit the page's form and assert the router, not the browser, handled it. */
const submitAndCheck = async (): Promise<void> => {
  const form = document.querySelector("form");
  if (!form) {
    throw new Error("form missing");
  }
  const event = new Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  await settle();
  expect(event.defaultPrevented).toBe(true);
};

it("form submit stays prevented after hydration and router rerenders", async () => {
  const html = await createPageRenderer({ components, layoutTree: {} })(
    page(todos),
    { body: "", css: "", preloads: "" }
  );
  setLocation("http://localhost:3000/");
  document.body.replaceChildren(
    ...[...parseDocument(html).body.childNodes].map((node) =>
      document.importNode(node, true)
    )
  );
  // SAFETY: the mock answers the calls Void makes; `preconnect` is unused.
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") {
      todos = [...todos, "b"];
    }
    return Promise.resolve(
      Response.json(page(todos), { headers: { "X-VoidPages": "true" } })
    );
  }) as typeof fetch;
  await startPages({
    components,
    layoutTree: {},
    matchRoute: () => "index",
    prefetchDefaultCacheFor: parseCacheFor("30s"),
    prefetchHoverDelay: 75,
    routeMeta: {},
    staticPageData: false,
    staticPageDataFastPath: false,
    viewTransitions: false,
  });
  await settle();
  await submitAndCheck();
  await submitAndCheck();
  expect(document.querySelectorAll("li").length).toBe(3);
  globalThis.fetch = realFetch;
});
