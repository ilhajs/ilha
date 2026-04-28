// =============================================================================
// @ilha/store/form — test suite
// =============================================================================

import { describe, it, expect } from "bun:test";

import { z } from "zod";

import {
  extractFormData,
  validateWithSchema,
  validateWithSchemaAsync,
  issuesToErrors,
} from "./form";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function form(markup: string): HTMLFormElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = markup;
  const formEl = wrapper.querySelector("form");
  if (!formEl) throw new Error("fixture markup did not contain a <form>");
  document.body.appendChild(formEl);
  return formEl;
}

function fd(entries: Array<[string, FormDataEntryValue]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

// ---------------------------------------------------------------------------
// extractFormData()
// ---------------------------------------------------------------------------

describe("extractFormData()", () => {
  it("extracts a single text input as a scalar string", () => {
    const f = form(`<form><input name="email" value="ada@example.com" /></form>`);
    expect(extractFormData(f)).toEqual({ email: "ada@example.com" });
  });

  it("extracts multiple distinct fields", () => {
    const f = form(`
      <form>
        <input name="email" value="ada@example.com" />
        <input name="name" value="Ada" />
      </form>
    `);
    expect(extractFormData(f)).toEqual({ email: "ada@example.com", name: "Ada" });
  });

  it("collapses checkbox groups into a string array", () => {
    const f = form(`
      <form>
        <input type="checkbox" name="role" value="admin" checked />
        <input type="checkbox" name="role" value="editor" checked />
        <input type="checkbox" name="role" value="viewer" />
      </form>
    `);
    expect(extractFormData(f)).toEqual({ role: ["admin", "editor"] });
  });

  it("returns a single-checked checkbox as a scalar (single value)", () => {
    const f = form(`
      <form>
        <input type="checkbox" name="role" value="admin" checked />
        <input type="checkbox" name="role" value="editor" />
      </form>
    `);
    expect(extractFormData(f)).toEqual({ role: "admin" });
  });

  it("omits unchecked checkboxes entirely", () => {
    const f = form(`
      <form>
        <input type="checkbox" name="terms" value="yes" />
      </form>
    `);
    expect(extractFormData(f)).toEqual({});
  });

  it("extracts a checked radio as a scalar", () => {
    const f = form(`
      <form>
        <input type="radio" name="plan" value="free" />
        <input type="radio" name="plan" value="pro" checked />
      </form>
    `);
    expect(extractFormData(f)).toEqual({ plan: "pro" });
  });

  it("collapses multi-value entries (e.g. <select multiple>) into a string array", () => {
    // Note: happy-dom's `new FormData(form)` constructor has a bug where it
    // only serializes the first selected option of a <select multiple>, even
    // when multiple options have .selected === true. Real browsers handle
    // this correctly. We test the underlying behavior — extractFormData
    // collapsing repeated keys — by constructing FormData directly, which
    // is what a browser would hand us at runtime.
    const data = new FormData();
    data.append("tags", "a");
    data.append("tags", "c");
    expect(extractFormData(data)).toEqual({ tags: ["a", "c"] });
  });

  it("extracts <textarea> as a scalar string", () => {
    const f = form(`<form><textarea name="bio">hello</textarea></form>`);
    expect(extractFormData(f)).toEqual({ bio: "hello" });
  });

  it("extracts hidden inputs", () => {
    const f = form(`
      <form>
        <input type="hidden" name="step" value="requestOtp" />
        <input name="email" value="ada@example.com" />
      </form>
    `);
    expect(extractFormData(f)).toEqual({ step: "requestOtp", email: "ada@example.com" });
  });

  it("preserves File values from file inputs", () => {
    const data = fd([["avatar", new File(["x"], "x.png", { type: "image/png" })]]);
    const result = extractFormData(data);
    expect(result.avatar).toBeInstanceOf(File);
    expect((result.avatar as File).name).toBe("x.png");
  });

  it("collapses multiple files on the same name into an array", () => {
    const data = fd([
      ["files", new File(["a"], "a.txt")],
      ["files", new File(["b"], "b.txt")],
    ]);
    const result = extractFormData(data);
    expect(Array.isArray(result.files)).toBe(true);
    expect((result.files as File[]).map((f) => f.name)).toEqual(["a.txt", "b.txt"]);
  });

  it("accepts a FormData instance directly", () => {
    const data = fd([
      ["email", "ada@example.com"],
      ["role", "admin"],
      ["role", "editor"],
    ]);
    expect(extractFormData(data)).toEqual({
      email: "ada@example.com",
      role: ["admin", "editor"],
    });
  });

  it("returns an empty object for an empty form", () => {
    const f = form(`<form></form>`);
    expect(extractFormData(f)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// validateWithSchema()
// ---------------------------------------------------------------------------

describe("validateWithSchema()", () => {
  const SignInSchema = z.object({
    email: z.email(),
    password: z.string().min(8),
  });

  it("returns ok:true with parsed data on success", () => {
    const result = validateWithSchema(SignInSchema, {
      email: "ada@example.com",
      password: "supersecret",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.email).toBe("ada@example.com");
      expect(result.data.password).toBe("supersecret");
    }
  });

  it("returns ok:false with issues on failure", () => {
    const result = validateWithSchema(SignInSchema, {
      email: "not-an-email",
      password: "short",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("issues carry path information for nested fields", () => {
    const Nested = z.object({ user: z.object({ email: z.email() }) });
    const result = validateWithSchema(Nested, { user: { email: "bad" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((i) =>
        i.path?.map((p) => (typeof p === "object" ? p.key : p)).join("."),
      );
      expect(paths).toContain("user.email");
    }
  });

  it("supports Zod's transform / coerce — output type differs from input", () => {
    const schema = z.object({ count: z.coerce.number() });
    const result = validateWithSchema(schema, { count: "42" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.count).toBe(42);
  });

  it("supports discriminated unions", () => {
    const Schema = z.discriminatedUnion("step", [
      z.object({ step: z.literal("requestOtp"), email: z.email() }),
      z.object({ step: z.literal("verifyOtp"), email: z.email(), otp: z.string().length(6) }),
    ]);

    const ok = validateWithSchema(Schema, { step: "requestOtp", email: "ada@example.com" });
    expect(ok.ok).toBe(true);

    const bad = validateWithSchema(Schema, {
      step: "verifyOtp",
      email: "ada@example.com",
      otp: "123",
    });
    expect(bad.ok).toBe(false);
  });

  it("does not throw on invalid input", () => {
    expect(() => validateWithSchema(SignInSchema, null)).not.toThrow();
    expect(() => validateWithSchema(SignInSchema, "garbage")).not.toThrow();
    expect(() => validateWithSchema(SignInSchema, undefined)).not.toThrow();
  });

  it("warns and returns a failure when the schema is async", () => {
    const asyncSchema = z.object({
      email: z.string().refine(async (v) => v === "ada@example.com", "must be ada"),
    });

    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    try {
      const result = validateWithSchema(asyncSchema, { email: "ada@example.com" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues[0]?.message).toContain("Async");
      }
      expect(warned).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("composes with extractFormData end-to-end", () => {
    const f = form(`
      <form>
        <input name="email" value="ada@example.com" />
        <input name="password" value="supersecret" />
      </form>
    `);
    const result = validateWithSchema(SignInSchema, extractFormData(f));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.email).toBe("ada@example.com");
  });
});

// ---------------------------------------------------------------------------
// validateWithSchemaAsync()
// ---------------------------------------------------------------------------

describe("validateWithSchemaAsync()", () => {
  it("resolves ok:true on success with a sync schema", async () => {
    const schema = z.object({ name: z.string().min(1) });
    const result = await validateWithSchemaAsync(schema, { name: "Ada" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe("Ada");
  });

  it("resolves ok:false on failure with a sync schema", async () => {
    const schema = z.object({ name: z.string().min(1) });
    const result = await validateWithSchemaAsync(schema, { name: "" });
    expect(result.ok).toBe(false);
  });

  it("supports async refinements", async () => {
    const schema = z.object({
      email: z.string().refine(async (v) => v === "ada@example.com", "email already in use"),
    });

    const ok = await validateWithSchemaAsync(schema, { email: "ada@example.com" });
    expect(ok.ok).toBe(true);

    const bad = await validateWithSchemaAsync(schema, { email: "grace@example.com" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues.some((i) => i.message === "email already in use")).toBe(true);
    }
  });

  it("does not warn for async schemas (unlike the sync variant)", async () => {
    const schema = z.object({
      email: z.string().refine(async (v) => v.length > 0, "required"),
    });

    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    try {
      await validateWithSchemaAsync(schema, { email: "ada@example.com" });
      expect(warned).toBe(false);
    } finally {
      console.warn = originalWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// issuesToErrors()
// ---------------------------------------------------------------------------

describe("issuesToErrors()", () => {
  it("returns an empty object for no issues", () => {
    expect(issuesToErrors([])).toEqual({});
  });

  it("flattens a single-level path into a string key", () => {
    const errors = issuesToErrors([{ message: "Required", path: ["email"] }]);
    expect(errors).toEqual({ email: ["Required"] });
  });

  it("joins nested paths with dots", () => {
    const errors = issuesToErrors([{ message: "Invalid", path: ["user", "email"] }]);
    expect(errors).toEqual({ "user.email": ["Invalid"] });
  });

  it("supports PathSegment objects with a `key`", () => {
    const errors = issuesToErrors([
      { message: "Invalid", path: [{ key: "user" }, { key: "email" }] },
    ]);
    expect(errors).toEqual({ "user.email": ["Invalid"] });
  });

  it("groups multiple issues on the same path into one array", () => {
    const errors = issuesToErrors([
      { message: "Required", path: ["email"] },
      { message: "Must be a valid email", path: ["email"] },
    ]);
    expect(errors).toEqual({
      email: ["Required", "Must be a valid email"],
    });
  });

  it("issues without a path land under the empty-string key", () => {
    const errors = issuesToErrors([{ message: "Form-level error" }]);
    expect(errors).toEqual({ "": ["Form-level error"] });
  });

  it("preserves message order", () => {
    const errors = issuesToErrors([
      { message: "first", path: ["x"] },
      { message: "second", path: ["x"] },
      { message: "third", path: ["x"] },
    ]);
    expect(errors.x).toEqual(["first", "second", "third"]);
  });

  it("handles array index paths (numeric keys) as strings", () => {
    const errors = issuesToErrors([{ message: "Invalid", path: ["items", 0, "name"] }]);
    expect(errors).toEqual({ "items.0.name": ["Invalid"] });
  });

  it("composes with validateWithSchema for a full pipeline", () => {
    const schema = z.object({
      email: z.email(),
      password: z.string().min(8),
    });
    const result = validateWithSchema(schema, { email: "bad", password: "short" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const errors = issuesToErrors(result.issues);
      expect(errors.email?.length).toBeGreaterThanOrEqual(1);
      expect(errors.password?.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration — the canonical sign-in flow
// ---------------------------------------------------------------------------

describe("integration", () => {
  const SignInSchema = z.discriminatedUnion("step", [
    z.object({
      step: z.literal("requestOtp"),
      email: z.email(),
      otp: z.string().optional(),
    }),
    z.object({
      step: z.literal("verifyOtp"),
      email: z.email(),
      otp: z.string().min(6).max(6),
    }),
  ]);

  it("full pipeline: form → extract → validate → on success", () => {
    const f = form(`
      <form>
        <input type="hidden" name="step" value="requestOtp" />
        <input name="email" value="ada@example.com" />
      </form>
    `);
    const data = extractFormData(f);
    const result = validateWithSchema(SignInSchema, data);
    expect(result.ok).toBe(true);
    if (result.ok && result.data.step === "requestOtp") {
      expect(result.data.email).toBe("ada@example.com");
    }
  });

  it("full pipeline: form → extract → validate → issuesToErrors", () => {
    const f = form(`
      <form>
        <input type="hidden" name="step" value="verifyOtp" />
        <input name="email" value="not-an-email" />
        <input name="otp" value="123" />
      </form>
    `);
    const result = validateWithSchema(SignInSchema, extractFormData(f));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const errors = issuesToErrors(result.issues);
      expect(errors.email).toBeDefined();
      expect(errors.otp).toBeDefined();
    }
  });

  it("hidden discriminator routes to the correct schema branch", () => {
    const f = form(`
      <form>
        <input type="hidden" name="step" value="verifyOtp" />
        <input name="email" value="ada@example.com" />
        <input name="otp" value="123456" />
      </form>
    `);
    const result = validateWithSchema(SignInSchema, extractFormData(f));
    expect(result.ok).toBe(true);
    if (result.ok && result.data.step === "verifyOtp") {
      expect(result.data.otp).toBe("123456");
    }
  });
});
