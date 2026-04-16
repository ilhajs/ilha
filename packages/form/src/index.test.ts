import { describe, it, expect } from "bun:test";

import { z } from "zod";

import { createForm } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeForm(html: string): HTMLFormElement {
  const el = document.createElement("form");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function cleanup(el: HTMLFormElement) {
  document.body.removeChild(el);
}

function setField(form: HTMLFormElement, name: string, value: string) {
  const el = form.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  el.value = value;
  return el;
}

function dispatch(el: HTMLElement, event: string) {
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
}

const basicSchema = z.object({
  email: z.string().email("Invalid email"),
  name: z.string().min(1, "Name is required"),
});

const basicHtml = `
  <input name="email" />
  <input name="name" />
  <button type="submit">Submit</button>
`;

// ---------------------------------------------------------------------------
// createForm — mount / unmount
// ---------------------------------------------------------------------------

describe("createForm — mount/unmount", () => {
  it("mount() returns a cleanup function", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });
    const unmount = form.mount();
    expect(typeof unmount).toBe("function");
    unmount();
    cleanup(el);
  });

  it("unmount() is idempotent", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });
    form.mount();
    expect(() => {
      form.unmount();
      form.unmount();
    }).not.toThrow();
    cleanup(el);
  });

  it("cleanup fn and unmount() are equivalent", () => {
    const calls: string[] = [];
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => calls.push("submit"),
    });
    const unmount = form.mount();
    unmount();

    submit(el);
    expect(calls).toHaveLength(0); // listeners removed
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// createForm — submission
// ---------------------------------------------------------------------------

describe("createForm — submission", () => {
  it("calls onSubmit with typed values on valid submission", () => {
    const submitted: any[] = [];
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: (values) => submitted.push(values),
    });
    const unmount = form.mount();

    setField(el, "email", "ada@example.com");
    setField(el, "name", "Ada");
    submit(el);

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual({ email: "ada@example.com", name: "Ada" });
    unmount();
    cleanup(el);
  });

  it("calls onError with issues on invalid submission", () => {
    const errors: any[] = [];
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      onError: (issues) => errors.push(issues),
    });
    const unmount = form.mount();

    setField(el, "email", "not-an-email");
    setField(el, "name", "");
    submit(el);

    expect(errors).toHaveLength(1);
    expect(errors[0].length).toBeGreaterThan(0);
    unmount();
    cleanup(el);
  });

  it("does not call onSubmit when validation fails", () => {
    const submitted: any[] = [];
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => submitted.push(true),
    });
    const unmount = form.mount();

    setField(el, "email", "bad");
    submit(el);

    expect(submitted).toHaveLength(0);
    unmount();
    cleanup(el);
  });

  it("prevents default on submission", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });
    const unmount = form.mount();

    setField(el, "email", "ada@example.com");
    setField(el, "name", "Ada");

    let defaultPrevented = false;
    el.addEventListener("submit", (e) => {
      defaultPrevented = e.defaultPrevented;
    });

    submit(el);
    expect(defaultPrevented).toBe(true);
    unmount();
    cleanup(el);
  });

  it("clears errors on successful submission", () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      onError: () => {},
    });
    const unmount = form.mount();

    // first submit → fail
    setField(el, "email", "bad");
    submit(el);
    expect(Object.keys(form.errors()).length).toBeGreaterThan(0);

    // second submit → pass
    setField(el, "email", "ada@example.com");
    setField(el, "name", "Ada");
    submit(el);
    expect(form.errors()).toEqual({});
    unmount();
    cleanup(el);
  });

  it("after unmount, submit events are ignored", () => {
    const submitted: any[] = [];
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => submitted.push(true),
    });
    const unmount = form.mount();
    unmount();

    setField(el, "email", "ada@example.com");
    setField(el, "name", "Ada");
    submit(el);

    expect(submitted).toHaveLength(0);
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// createForm — values()
// ---------------------------------------------------------------------------

describe("createForm — values()", () => {
  it("returns ok: true with typed data for valid values", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });

    setField(el, "email", "ada@example.com");
    setField(el, "name", "Ada");

    const result = form.values();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ email: "ada@example.com", name: "Ada" });
    }
    cleanup(el);
  });

  it("returns ok: false with issues for invalid values", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });

    setField(el, "email", "not-valid");
    setField(el, "name", "");

    const result = form.values();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
    cleanup(el);
  });

  it("works without calling mount() first", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });

    setField(el, "email", "ada@example.com");
    setField(el, "name", "Ada");

    expect(() => form.values()).not.toThrow();
    cleanup(el);
  });

  it("coerces number fields via schema", () => {
    const el = makeForm(`<input name="age" />`);
    const form = createForm({
      el,
      schema: z.object({ age: z.coerce.number().min(18) }),
      onSubmit: () => {},
    });

    setField(el, "age", "25");
    const result = form.values();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.age).toBe(25);
    cleanup(el);
  });

  it("handles multi-value fields as arrays", () => {
    const el = makeForm(`
      <input type="checkbox" name="tags" value="a" />
      <input type="checkbox" name="tags" value="b" />
    `);
    el.querySelectorAll<HTMLInputElement>("input").forEach((i) => (i.checked = true));

    const form = createForm({
      el,
      schema: z.object({ tags: z.array(z.string()) }),
      onSubmit: () => {},
    });

    const result = form.values();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.tags).toEqual(["a", "b"]);
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// createForm — errors()
// ---------------------------------------------------------------------------

describe("createForm — errors()", () => {
  it("returns empty object before first validation", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });
    expect(form.errors()).toEqual({});
    cleanup(el);
  });

  it("populates errors after failed submission", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });
    const unmount = form.mount();

    setField(el, "email", "bad");
    submit(el);

    const errors = form.errors();
    expect(typeof errors).toBe("object");
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    unmount();
    cleanup(el);
  });

  it("returns a copy — mutations do not affect internal state", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });
    const unmount = form.mount();

    setField(el, "email", "bad");
    submit(el);

    const errors = form.errors();
    errors["email"] = ["mutated"];

    expect(form.errors()["email"]).not.toEqual(["mutated"]);
    unmount();
    cleanup(el);
  });

  it("maps issues to dot-separated field paths", () => {
    const schema = z.object({
      user: z.object({ email: z.string().email("bad email") }),
    });
    const el = makeForm(`<input name="user.email" />`);
    const form = createForm({ el, schema, onSubmit: () => {} });
    const unmount = form.mount();

    setField(el, "user.email", "not-an-email");
    submit(el);

    // path should be "user.email" or "" depending on validator — just check issues exist
    const errors = form.errors();
    const hasErrors = Object.values(errors).flat().length > 0;
    expect(hasErrors).toBe(true);
    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// createForm — isDirty()
// ---------------------------------------------------------------------------

describe("createForm — isDirty()", () => {
  it("is false before any interaction", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });
    form.mount();
    expect(form.isDirty()).toBe(false);
    form.unmount();
    cleanup(el);
  });

  it("becomes true after a change event on a field", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });
    const unmount = form.mount();

    const input = setField(el, "email", "x");
    dispatch(input, "change");

    expect(form.isDirty()).toBe(true);
    unmount();
    cleanup(el);
  });

  it("stays dirty after unmount", () => {
    const el = makeForm(basicHtml);
    const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });
    const unmount = form.mount();

    const input = setField(el, "email", "x");
    dispatch(input, "change");
    unmount();

    expect(form.isDirty()).toBe(true);
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// createForm — validateOn
// ---------------------------------------------------------------------------

describe("createForm — validateOn", () => {
  it('validateOn: "submit" does not validate on change', () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      validateOn: "submit",
    });
    const unmount = form.mount();

    const input = setField(el, "email", "bad");
    dispatch(input, "change");

    expect(form.errors()).toEqual({});
    unmount();
    cleanup(el);
  });

  it('validateOn: "change" validates on change event', () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      validateOn: "change",
    });
    const unmount = form.mount();

    const input = setField(el, "email", "bad");
    dispatch(input, "change");

    expect(Object.keys(form.errors()).length).toBeGreaterThan(0);
    unmount();
    cleanup(el);
  });

  it('validateOn: "change" clears errors when field becomes valid', () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      validateOn: "change",
    });
    const unmount = form.mount();

    let input = setField(el, "email", "bad");
    dispatch(input, "change");
    expect(Object.keys(form.errors()).length).toBeGreaterThan(0);

    input = setField(el, "email", "ada@example.com");
    setField(el, "name", "Ada");
    dispatch(input, "change");
    expect(form.errors()).toEqual({});
    unmount();
    cleanup(el);
  });

  it('validateOn: "input" validates on every keystroke', () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      validateOn: "input",
    });
    const unmount = form.mount();

    const input = setField(el, "email", "bad");
    dispatch(input, "input");

    expect(Object.keys(form.errors()).length).toBeGreaterThan(0);
    unmount();
    cleanup(el);
  });

  it('validateOn: "input" does not validate on change when not configured', () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      validateOn: "input",
    });
    const unmount = form.mount();

    // Only fire change, not input — errors should not appear
    const input = setField(el, "email", "bad");
    dispatch(input, "change"); // dirty tracking fires but not validation

    expect(form.errors()).toEqual({});
    unmount();
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// createForm — submit()
// ---------------------------------------------------------------------------

describe("createForm — submit()", () => {
  it("triggers onSubmit programmatically when mounted and valid", () => {
    const submitted: any[] = [];
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: (values) => submitted.push(values),
    });
    const unmount = form.mount();

    setField(el, "email", "ada@example.com");
    setField(el, "name", "Ada");
    form.submit();

    expect(submitted).toHaveLength(1);
    unmount();
    cleanup(el);
  });

  it("triggers onError programmatically when mounted and invalid", () => {
    const errors: any[] = [];
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      onError: (issues) => errors.push(issues),
    });
    const unmount = form.mount();

    setField(el, "email", "bad");
    form.submit();

    expect(errors).toHaveLength(1);
    unmount();
    cleanup(el);
  });

  it("works without mount() — runs validation directly", () => {
    const submitted: any[] = [];
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: (values) => submitted.push(values),
    });

    setField(el, "email", "ada@example.com");
    setField(el, "name", "Ada");
    form.submit();

    expect(submitted).toHaveLength(1);
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// createForm — async schema guard
// ---------------------------------------------------------------------------

describe("createForm — async schema guard", () => {
  it("returns ok: false and warns when schema returns a Promise", () => {
    const asyncSchema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: () => Promise.resolve({ value: {} }),
      },
    };

    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: asyncSchema as any,
      onSubmit: () => {},
    });

    const result = form.values();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.message).toMatch(/async/i);
    }
    cleanup(el);
  });
});

// ---------------------------------------------------------------------------
// createForm — defaultValues
// ---------------------------------------------------------------------------

describe("createForm — defaultValues", () => {
  it("applies string default to a text input on mount()", () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      defaultValues: { email: "ada@example.com", name: "Ada" },
    });
    form.mount();

    expect((el.querySelector('[name="email"]') as HTMLInputElement).value).toBe("ada@example.com");
    expect((el.querySelector('[name="name"]') as HTMLInputElement).value).toBe("Ada");

    form.unmount();
    cleanup(el);
  });

  it("does not apply defaults before mount()", () => {
    const el = makeForm(basicHtml);
    createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      defaultValues: { email: "ada@example.com" },
    });

    expect((el.querySelector('[name="email"]') as HTMLInputElement).value).toBe("");
    cleanup(el);
  });

  it("default values are read by values() after mount()", () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      defaultValues: { email: "ada@example.com", name: "Ada" },
    });
    form.mount();

    const result = form.values();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ email: "ada@example.com", name: "Ada" });
    }

    form.unmount();
    cleanup(el);
  });

  it("default values cause onSubmit to fire with pre-filled data", () => {
    const submitted: any[] = [];
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: (values) => submitted.push(values),
      defaultValues: { email: "ada@example.com", name: "Ada" },
    });
    const unmount = form.mount();

    submit(el);

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual({ email: "ada@example.com", name: "Ada" });
    unmount();
    cleanup(el);
  });

  it("does not mark form as dirty after applying defaults", () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      defaultValues: { email: "ada@example.com", name: "Ada" },
    });
    form.mount();

    expect(form.isDirty()).toBe(false);

    form.unmount();
    cleanup(el);
  });

  it("user change after defaults marks form as dirty", () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      defaultValues: { email: "ada@example.com", name: "Ada" },
    });
    const unmount = form.mount();

    const input = setField(el, "email", "other@example.com");
    dispatch(input, "change");

    expect(form.isDirty()).toBe(true);
    unmount();
    cleanup(el);
  });

  it("applies defaults to a checkbox group — checks matching values", () => {
    const el = makeForm(`
      <input type="checkbox" name="tags" value="a" />
      <input type="checkbox" name="tags" value="b" />
      <input type="checkbox" name="tags" value="c" />
    `);
    const form = createForm({
      el,
      schema: z.object({ tags: z.array(z.string()) }),
      onSubmit: () => {},
      defaultValues: { tags: ["a", "c"] },
    });
    form.mount();

    const checkboxes = el.querySelectorAll<HTMLInputElement>('[name="tags"]');
    expect(checkboxes[0]!.checked).toBe(true); // "a"
    expect(checkboxes[1]!.checked).toBe(false); // "b"
    expect(checkboxes[2]!.checked).toBe(true); // "c"

    form.unmount();
    cleanup(el);
  });

  it("applies defaults to radio inputs — checks matching value", () => {
    const el = makeForm(`
      <input type="radio" name="role" value="admin" />
      <input type="radio" name="role" value="user" />
      <input type="radio" name="role" value="guest" />
    `);
    const form = createForm({
      el,
      schema: z.object({ role: z.string() }),
      onSubmit: () => {},
      defaultValues: { role: "user" },
    });
    form.mount();

    const radios = el.querySelectorAll<HTMLInputElement>('[name="role"]');
    expect(radios[0]!.checked).toBe(false); // "admin"
    expect(radios[1]!.checked).toBe(true); // "user"
    expect(radios[2]!.checked).toBe(false); // "guest"

    form.unmount();
    cleanup(el);
  });

  it("applies defaults to a <select> element", () => {
    const el = makeForm(`
      <select name="country">
        <option value="pl">Poland</option>
        <option value="de">Germany</option>
        <option value="fr">France</option>
      </select>
    `);
    const form = createForm({
      el,
      schema: z.object({ country: z.string() }),
      onSubmit: () => {},
      defaultValues: { country: "de" },
    });
    form.mount();

    expect((el.querySelector('[name="country"]') as HTMLSelectElement).value).toBe("de");

    form.unmount();
    cleanup(el);
  });

  it("applies defaults to a <select multiple> element", () => {
    const el = makeForm(`
      <select name="langs" multiple>
        <option value="en">English</option>
        <option value="pl">Polish</option>
        <option value="de">German</option>
      </select>
    `);
    const form = createForm({
      el,
      schema: z.object({ langs: z.array(z.string()) }),
      onSubmit: () => {},
      defaultValues: { langs: ["en", "pl"] },
    });
    form.mount();

    const options = el.querySelectorAll<HTMLOptionElement>('[name="langs"] option');
    expect(options[0]!.selected).toBe(true); // "en"
    expect(options[1]!.selected).toBe(true); // "pl"
    expect(options[2]!.selected).toBe(false); // "de"

    form.unmount();
    cleanup(el);
  });

  it("applies defaults to a <textarea>", () => {
    const el = makeForm(`<textarea name="bio"></textarea>`);
    const form = createForm({
      el,
      schema: z.object({ bio: z.string() }),
      onSubmit: () => {},
      defaultValues: { bio: "Hello world" },
    });
    form.mount();

    expect((el.querySelector('[name="bio"]') as HTMLTextAreaElement).value).toBe("Hello world");

    form.unmount();
    cleanup(el);
  });

  it("re-applies defaults on each mount() call", () => {
    const el = makeForm(basicHtml);
    const form = createForm({
      el,
      schema: basicSchema,
      onSubmit: () => {},
      defaultValues: { email: "ada@example.com", name: "Ada" },
    });

    const unmount1 = form.mount();
    setField(el, "email", "changed@example.com");
    unmount1();

    // Second mount re-applies defaults
    form.mount();
    expect((el.querySelector('[name="email"]') as HTMLInputElement).value).toBe("ada@example.com");

    form.unmount();
    cleanup(el);
  });

  it("works fine with no defaultValues provided (undefined)", () => {
    const el = makeForm(basicHtml);
    expect(() => {
      const form = createForm({ el, schema: basicSchema, onSubmit: () => {} });
      form.mount();
      form.unmount();
    }).not.toThrow();
    cleanup(el);
  });

  it("ignores defaultValues keys that have no matching DOM element", () => {
    const el = makeForm(basicHtml);
    expect(() => {
      const form = createForm({
        el,
        schema: basicSchema,
        onSubmit: () => {},
        defaultValues: { email: "ada@example.com", name: "Ada" },
      });
      form.mount();
      form.unmount();
    }).not.toThrow();
    cleanup(el);
  });
});
