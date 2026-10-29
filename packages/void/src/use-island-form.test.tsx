// @jsxImportSource ilha
import { afterEach, describe, expect, it } from "bun:test";

import { mount } from "ilha";
import { VoidActionError } from "void/pages-client";

import { setLocation, settle } from "./test-helpers";
import { useIslandForm } from "./use-island-form";
import type { IslandForm } from "./use-island-form";

interface FetchCall {
  body: unknown;
  headers: Headers;
  method: string;
  url: string;
}

/** Holds the probe form for the in-flight behavior stub. */
interface PendingProbe {
  form?: IslandForm<{ text: string }>;
}

const realFetch = globalThis.fetch;
const calls: FetchCall[] = [];
let behavior: (url: string) => Promise<Response> = () =>
  Promise.resolve(Response.json({}));

/** Mount a probe holding one `useIslandForm`. */
const mountIslandForm = async (defaults?: { text: string }) => {
  const host = document.createElement("div");
  let captured: IslandForm<{ text: string }> | undefined;
  const dispose = mount(host, () => {
    captured = useIslandForm(defaults ?? { text: "" });
    return null;
  });
  // The probe paints a tick after mount; wait for the capture.
  await settle();
  if (!captured) {
    throw new Error("useIslandForm probe did not render");
  }
  return { dispose, form: captured };
};

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
  behavior = () => Promise.resolve(Response.json({}));
  setLocation("http://localhost:3000/");
});

const stubFetch = (): void => {
  // SAFETY: the stub records what the form sends and answers from `behavior`.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: String(input),
    });
    return behavior(String(input));
  }) as typeof fetch;
};

const redirectTo = (url: string): Response => {
  const response = Response.json({});
  Object.defineProperty(response, "redirected", { value: true });
  Object.defineProperty(response, "url", { value: url });
  return response;
};

describe("useIslandForm", () => {
  it("posts JSON and marks success", async () => {
    stubFetch();
    const { form } = await mountIslandForm();
    form.setData("text", "hi");
    await form.post("/todos");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      body: { text: "hi" },
      method: "POST",
      url: "/todos",
    });
    expect(calls[0]?.headers.get("content-type")).toContain("application/json");
    expect(form.wasSuccessful).toBe(true);
    expect(form.errors).toEqual({});
    expect(form.error).toBeNull();
    expect(form.pending).toBe(false);
  });

  it("sends the verb for each helper", async () => {
    stubFetch();
    const { form } = await mountIslandForm();
    await form.put("/todos");
    await form.patch("/todos");
    await form.delete("/todos");
    expect(calls.map((call) => call.method)).toEqual([
      "PUT",
      "PATCH",
      "DELETE",
    ]);
  });

  it("follows redirects through location", async () => {
    stubFetch();
    behavior = () =>
      Promise.resolve(redirectTo("http://localhost:3000/elsewhere"));
    const { form } = await mountIslandForm();
    await form.post("/todos");
    expect(window.location.href).toBe("http://localhost:3000/elsewhere");
    expect(form.pending).toBe(false);
  });

  it("sets field errors for 422 validation responses", async () => {
    stubFetch();
    behavior = () =>
      Promise.resolve(
        Response.json({ errors: { text: "Required" } }, { status: 422 })
      );
    const { form } = await mountIslandForm();
    await form.post("/todos");
    expect(form.errors).toEqual({ text: "Required" });
    expect(form.error).toBeNull();
    expect(form.wasSuccessful).toBe(false);
    expect(form.pending).toBe(false);
  });

  it("treats non-validation 422 bodies as form errors", async () => {
    stubFetch();
    behavior = () =>
      Promise.resolve(Response.json({ message: "nope" }, { status: 422 }));
    const { form } = await mountIslandForm();
    await form.post("/todos");
    expect(form.errors).toEqual({});
    expect(form.error).toBeInstanceOf(VoidActionError);
    expect(form.error?.status).toBe(422);
  });

  it("ignores error-shaped bodies on other statuses for field errors", async () => {
    stubFetch();
    behavior = () =>
      Promise.resolve(
        Response.json({ errors: { text: "Required" } }, { status: 400 })
      );
    const { form } = await mountIslandForm();
    await form.post("/todos");
    // Only 422 responses carry validation errors; a 400 is a form error.
    expect(form.errors).toEqual({});
    expect(form.error).toBeInstanceOf(VoidActionError);
    expect(form.error?.status).toBe(400);
  });

  it("stores call-site failures on the form instead of throwing", async () => {
    stubFetch();
    behavior = () =>
      Promise.resolve(Response.json({ message: "taken" }, { status: 409 }));
    const { form } = await mountIslandForm();
    await form.post("/todos");
    expect(form.error).toBeInstanceOf(VoidActionError);
    expect(form.error?.status).toBe(409);
    expect(form.errors).toEqual({});
    expect(form.pending).toBe(false);
  });

  it("throws boundary failures and leaves the form error unset", async () => {
    stubFetch();
    behavior = () =>
      Promise.resolve(
        new Response("boom", {
          headers: { "content-type": "text/plain" },
          status: 500,
          statusText: "Server Error",
        })
      );
    const { form } = await mountIslandForm();
    let thrown: unknown;
    try {
      await form.post("/todos");
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof VoidActionError)) {
      throw new TypeError("expected a VoidActionError");
    }
    expect(thrown.body).toBe("boom");
    expect(form.error).toBeNull();
    expect(form.pending).toBe(false);
  });

  it("reads empty error bodies as null", async () => {
    stubFetch();
    behavior = () => Promise.resolve(new Response(null, { status: 500 }));
    const { form } = await mountIslandForm();
    let thrown: unknown;
    try {
      await form.post("/todos");
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof VoidActionError)) {
      throw new TypeError("expected a VoidActionError");
    }
    expect(thrown.body).toBeNull();
  });

  it("reads malformed JSON error bodies as null", async () => {
    stubFetch();
    behavior = () =>
      Promise.resolve(
        new Response("{oops", {
          headers: { "content-type": "application/json" },
          status: 500,
        })
      );
    const { form } = await mountIslandForm();
    let thrown: unknown;
    try {
      await form.post("/todos");
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof VoidActionError)) {
      throw new TypeError("expected a VoidActionError");
    }
    expect(thrown.body).toBeNull();
  });

  it("propagates network failures and resets pending", async () => {
    stubFetch();
    const expected = new Error("offline");
    behavior = () => Promise.reject(expected);
    const { form } = await mountIslandForm();
    let thrown: unknown;
    try {
      await form.post("/todos");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(expected);
    expect(form.pending).toBe(false);
  });

  it("clears stale errors before submitting", async () => {
    stubFetch();
    let failNext = true;
    behavior = () =>
      failNext
        ? Promise.resolve(Response.json({ message: "taken" }, { status: 409 }))
        : Promise.resolve(Response.json({}));
    const { form } = await mountIslandForm();
    await form.post("/todos");
    expect(form.error?.status).toBe(409);
    failNext = false;
    await form.post("/todos");
    expect(form.error).toBeNull();
    expect(form.wasSuccessful).toBe(true);
  });

  it("marks pending during an in-flight submit", async () => {
    stubFetch();
    const seen: boolean[] = [];
    const box: PendingProbe = {};
    behavior = () => {
      if (box.form) {
        seen.push(box.form.pending);
      }
      return Promise.resolve(Response.json({}));
    };
    const { form } = await mountIslandForm({ text: "" });
    box.form = form;
    await form.post("/todos");
    expect(seen).toEqual([true]);
    expect(form.pending).toBe(false);
    expect(form.wasSuccessful).toBe(true);
  });
});
