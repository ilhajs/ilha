// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { mount } from "ilha";
import {
  createSsrRouter,
  idleNavigationState,
  VoidActionError,
} from "void/pages-client";
import type { VisitOptions, VoidRouter } from "void/pages-client";

import { createPageState, VoidContext } from "./context";
import { settle } from "./test-helpers";
import { useForm } from "./use-form";
import type { PageForm } from "./use-form";

interface VisitCall {
  options: VisitOptions;
  url: string;
}

/** Holds the probe form for the in-flight behavior stub. */
interface PendingProbe {
  form?: PageForm<{ text: string }>;
}

/** What a stubbed `visit` resolves with: page data, or validation errors. */
interface VisitResult {
  errors?: Record<string, string>;
}

type VisitBehavior = (
  url: string,
  options: VisitOptions
) => Promise<VisitResult>;

/** A recording router: the SSR shape with `visit` swapped for the stub. */
const stubRouter = (
  visits: VisitCall[],
  behavior: VisitBehavior
): VoidRouter => {
  const router = createSsrRouter("/");
  router.visit = (next, options) => {
    const target = String(next);
    const request = options ?? {};
    visits.push({ options: request, url: target });
    return behavior(target, request);
  };
  return router;
};

const callSiteError = (): VoidActionError =>
  new VoidActionError({
    body: "taken",
    status: 409,
    statusText: "Conflict",
    url: "/form",
  });

const boundaryError = (): VoidActionError =>
  new VoidActionError({
    body: "boom",
    status: 500,
    statusText: "Server Error",
    url: "/form",
  });

/** Mount a probe holding one `useForm` bound to a recording router. */
const mountForm = async (
  url: string,
  defaults: { text: string },
  formOptions?: { params?: Record<string, string> },
  behavior: VisitBehavior = () => Promise.resolve({})
) => {
  const visits: VisitCall[] = [];
  const router = stubRouter(visits, behavior);
  const host = document.createElement("div");
  let captured: PageForm<{ text: string }> | undefined;
  const Probe = (): null => {
    captured = useForm(url, defaults, formOptions);
    return null;
  };
  const dispose = mount(host, () => (
    <VoidContext.Provider
      value={createPageState({
        errors: {},
        navigation: idleNavigationState(),
        params: {},
        router,
        shared: {},
      })}
    >
      <Probe />
    </VoidContext.Provider>
  ));
  // Child probes paint a tick after mount; wait for the capture.
  await settle();
  if (!captured) {
    throw new Error("useForm probe did not render");
  }
  return { dispose, form: captured, visits };
};

describe("useForm", () => {
  it("posts the current data and marks success", async () => {
    const { form, visits } = await mountForm("/form", { text: "" });
    form.setData("text", "milk");
    await form.post();
    expect(visits).toHaveLength(1);
    expect(visits[0]?.url).toBe("/form");
    expect(visits[0]?.options).toMatchObject({
      data: { text: "milk" },
      method: "POST",
    });
    expect(form.wasSuccessful).toBe(true);
    expect(form.errors).toEqual({});
    expect(form.error).toBeNull();
    expect(form.pending).toBe(false);
  });

  it("writes router validation errors without setting a form error", async () => {
    const { form } = await mountForm("/form", { text: "" }, undefined, () =>
      Promise.resolve({ errors: { text: "Required" } })
    );
    await form.post();
    expect(form.errors).toEqual({ text: "Required" });
    expect(form.error).toBeNull();
    expect(form.wasSuccessful).toBe(false);
    expect(form.pending).toBe(false);
  });

  it("stores call-site failures on the form instead of throwing", async () => {
    const expected = callSiteError();
    const { form } = await mountForm("/form", { text: "" }, undefined, () =>
      Promise.reject(expected)
    );
    await form.post();
    expect(form.error).toBe(expected);
    expect(form.errors).toEqual({});
    expect(form.wasSuccessful).toBe(false);
    expect(form.pending).toBe(false);
  });

  it("rethrows boundary failures and resets pending", async () => {
    const expected = boundaryError();
    const { form } = await mountForm("/form", { text: "" }, undefined, () =>
      Promise.reject(expected)
    );
    let thrown: unknown;
    try {
      await form.post();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(expected);
    expect(form.error).toBeNull();
    expect(form.pending).toBe(false);
    expect(form.wasSuccessful).toBe(false);
  });

  it("swallows abort errors from a superseded navigation", async () => {
    const { form } = await mountForm("/form", { text: "" }, undefined, () =>
      Promise.reject(new DOMException("superseded", "AbortError"))
    );
    await form.post();
    expect(form.pending).toBe(false);
    expect(form.error).toBeNull();
    expect(form.wasSuccessful).toBe(false);
  });

  it("lets submit options override the request data", async () => {
    const { form, visits } = await mountForm("/form", { text: "typed" });
    await form.post({ data: { text: "override" } });
    expect(visits[0]?.options).toMatchObject({
      data: { text: "override" },
    });
    expect(form.data.text).toBe("typed");
    expect(form.wasSuccessful).toBe(true);
  });

  it("interpolates route params at submit time", async () => {
    const { form, visits } = await mountForm(
      "/users/:id",
      { text: "" },
      { params: { id: "7" } }
    );
    await form.post();
    expect(visits[0]?.url).toBe("/users/7");
  });

  it("rejects dangerous route params and resets pending", async () => {
    const { form } = await mountForm(
      "/users/:id",
      { text: "" },
      { params: { id: ".." } }
    );
    let thrown: unknown;
    try {
      await form.post();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(form.pending).toBe(false);
    expect(form.wasSuccessful).toBe(false);
  });

  it("clears stale errors on the next successful submit", async () => {
    let failNext = true;
    const { form } = await mountForm("/form", { text: "" }, undefined, () =>
      failNext
        ? Promise.resolve({ errors: { text: "Required" } })
        : Promise.resolve({})
    );
    await form.post();
    expect(form.errors).toEqual({ text: "Required" });
    failNext = false;
    await form.post();
    expect(form.errors).toEqual({});
    expect(form.wasSuccessful).toBe(true);
  });

  it("sends the verb for each helper", async () => {
    const { form, visits } = await mountForm("/form", { text: "" });
    await form.put();
    await form.patch();
    await form.delete();
    expect(visits.map((visit) => visit.options.method)).toEqual([
      "PUT",
      "PATCH",
      "DELETE",
    ]);
  });

  it("marks pending during an in-flight submit", async () => {
    const seen: boolean[] = [];
    const box: PendingProbe = {};
    const { form } = await mountForm("/form", { text: "" }, undefined, () => {
      if (box.form) {
        seen.push(box.form.pending);
      }
      return Promise.resolve({});
    });
    box.form = form;
    await form.post();
    expect(seen).toEqual([true]);
    expect(form.pending).toBe(false);
    expect(form.wasSuccessful).toBe(true);
  });
});
