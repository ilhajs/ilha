// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { mount } from "ilha";
import type { Component, View } from "ilha";
import {
  createSsrRouter,
  idleNavigationState,
  VoidActionError,
} from "void/pages-client";
import type { FormModel } from "void/pages-client";

import { createPageState, VoidContext } from "./context";
import { Form } from "./form";
import { setLocation, settle } from "./test-helpers";
import { useForm } from "./use-form";
import type { PageForm } from "./use-form";

interface FakeModel {
  calls: () => number;
  form: FormModel;
}

/** A structural form: `Form` only reads status fields plus one method. */
const fakeModel = (options: {
  error?: VoidActionError | null;
  errors?: Record<string, string>;
  pending?: boolean;
}): FakeModel => {
  let calls = 0;
  // SAFETY: `Form` reads `error`/`errors`/`pending` and calls one method.
  const form = {
    delete: () => Promise.resolve(),
    error: options.error ?? null,
    errors: options.errors ?? {},
    patch: () => Promise.resolve(),
    pending: options.pending ?? false,
    post: () => {
      calls += 1;
      return Promise.resolve();
    },
    put: () => Promise.resolve(),
  } as FormModel;
  return { calls: () => calls, form };
};

const fakeError = (message: string, retryAt?: string): VoidActionError =>
  // SAFETY: `Form` only reads `message` and `limit.retryAt` off the error.
  ({
    limit: retryAt ? { retryAt } : null,
    message,
  }) as VoidActionError;

const submit = async (host: HTMLElement): Promise<void> => {
  const form = host.querySelector("form");
  if (!form) {
    throw new Error("form element missing");
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
};

const mountFormView = async (view: Component): Promise<HTMLElement> => {
  const host = document.createElement("div");
  mount(host, view);
  await settle();
  return host;
};

describe("Form", () => {
  it("blocks resubmits while pending and marks busy", async () => {
    const { calls, form } = fakeModel({ pending: true });
    const host = await mountFormView(() => <Form form={form} />);
    expect(host.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    await submit(host);
    expect(calls()).toBe(0);
  });

  it("shows field errors and submits when idle", async () => {
    const { calls, form } = fakeModel({ errors: { text: "Required" } });
    const host = await mountFormView(() => <Form form={form} />);
    expect(host.querySelector("form")?.getAttribute("aria-busy")).toBe("false");
    expect(host.querySelector("[data-void-form-error]")?.textContent).toContain(
      "Required"
    );
    await submit(host);
    expect(calls()).toBe(1);
  });

  it("prefers a custom renderError over the message", async () => {
    const { form } = fakeModel({ error: fakeError("Slow") });
    const host = await mountFormView(() => (
      <Form form={form} renderError={(error) => `Custom: ${error.message}`} />
    ));
    expect(host.querySelector("[data-void-form-error]")?.textContent).toContain(
      "Custom: Slow"
    );
  });

  it("blocks submits inside a rate-limit window", async () => {
    const retryAt = new Date(Date.now() + 60_000).toISOString();
    const { calls, form } = fakeModel({ error: fakeError("Slow", retryAt) });
    const host = await mountFormView(() => <Form form={form} />);
    expect(host.querySelector("[data-void-form-error]")?.textContent).toContain(
      "Try again after"
    );
    await submit(host);
    expect(calls()).toBe(0);
  });

  it("allows submits once the window has passed", async () => {
    const retryAt = new Date(Date.now() - 1000).toISOString();
    const { calls, form } = fakeModel({ error: fakeError("Slow", retryAt) });
    const host = await mountFormView(() => <Form form={form} />);
    await submit(host);
    expect(calls()).toBe(1);
  });

  it("unblocks a rate-limited form after the retry window", async () => {
    setLocation("http://localhost:3000/form");
    const visits: string[] = [];
    let first = true;
    const router = createSsrRouter("/form");
    router.visit = (url) => {
      const target = String(url);
      visits.push(target);
      if (first) {
        first = false;
        throw new VoidActionError({
          body: {
            code: "usage_limit",
            message: "Slow down",
            reason: "rate_limit",
            resource: "requests",
            retryAt: new Date(Date.now() + 100).toISOString(),
          },
          status: 429,
          statusText: "Too Many Requests",
          url: target,
        });
      }
      return Promise.resolve({});
    };
    let captured: PageForm<{ text: string }> | undefined;
    const Probe = (): View => {
      captured = useForm("/form", { text: "" });
      return <Form class="todo" form={captured} />;
    };
    const host = document.createElement("div");
    mount(host, () => (
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
    await settle();
    if (!captured) {
      throw new Error("form probe did not render");
    }
    await submit(host);
    expect(captured.error?.status).toBe(429);
    expect(host.querySelector("[data-void-form-error]")?.textContent).toContain(
      "Try again after"
    );
    // The retry window lapses with no rerender in between; the next attempt
    // must read a fresh clock instead of the mount-time one.
    await Bun.sleep(250);
    await submit(host);
    expect(visits).toHaveLength(2);
    expect(captured.wasSuccessful).toBe(true);
    setLocation("http://localhost:3000/");
  });
});
