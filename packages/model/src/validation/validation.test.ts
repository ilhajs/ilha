import { describe, expect, it } from "bun:test";

import { Cause, Option, Redacted, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { make, Rule } from "./validation";
import type { Field, Mode } from "./validation";

const shown = (mode: Mode) => {
  const Form = make(
    {
      a: { required: "A" },
      b: { required: "B" },
      c: { required: "C" },
    },
    { mode }
  );
  const state = Form.blur(
    Form.change(Form.init({ a: "", b: "", c: "" }), "a", ""),
    "b"
  );
  const tags = (s: typeof state) =>
    Object.values(Form.validate(s).fields).map((field) => field._tag);
  // The value is held back by fields that aren't showing yet.
  expect(Option.isNone(Form.validate(state).value)).toBe(true);
  return [tags(state), tags(Form.submit(state))];
};

describe("Validation", () => {
  it("derives each field from its value, its rules and the other values", () => {
    const Signup = make({
      account: { value: Schema.Literals(["Personal", "Business"]) },
      birthday: {
        isEmpty: (birthday) => birthday === null,
        // A rule never sees an empty value, but its type still includes one.
        rules: [
          [
            (birthday) =>
              birthday !== null && /^\d{4}-\d{2}-\d{2}$/u.test(birthday),
            (birthday) => `${birthday} isn't a date`,
          ],
        ],
        value: Schema.NullOr(Schema.String),
      },
      company: {
        required: (values) =>
          values.account === "Business" && "Required for business accounts",
      },
      confirm: {
        required: "Confirm your password",
        rules: [
          [
            (confirm, values) => confirm === values.password,
            "Passwords must match",
          ],
        ],
      },
      email: { required: "Email is required", rules: [Rule.email()] },
      password: {
        required: "Password is required",
        rules: [
          Rule.minLength(8),
          [(password) => /\d/u.test(password), "Include a number"],
        ],
      },
    });
    const state = Signup.submit(
      Signup.init({
        account: "Business",
        birthday: "soon",
        company: "",
        confirm: "short",
        email: "ada@x",
        password: "short",
      })
    );
    const { fields, value, invalid } = Signup.validate(state);
    expect(fields).toEqual({
      account: {
        _tag: "Valid",
        empty: false,
        required: false,
        value: "Business",
      },
      birthday: {
        _tag: "Invalid",
        empty: false,
        errors: ["soon isn't a date"],
        required: false,
        value: "soon",
      },
      company: {
        _tag: "Invalid",
        empty: true,
        errors: ["Required for business accounts"],
        required: true,
        value: "",
      },
      // A rule over two fields runs whether or not the other field passes.
      confirm: { _tag: "Valid", empty: false, required: true, value: "short" },
      email: {
        _tag: "Invalid",
        empty: false,
        errors: ["Invalid email address"],
        required: true,
        value: "ada@x",
      },
      password: {
        _tag: "Invalid",
        empty: false,
        errors: ["Must be at least 8 characters"],
        required: true,
        value: "short",
      },
    });
    expect(invalid).toBe(true);
    expect(Option.isNone(value)).toBe(true);

    const changed = Signup.change(
      Signup.change(state, "password", "longenough"),
      "account",
      "Personal"
    );
    const { company, confirm, password } = Signup.validate(changed).fields;
    expect(password).toEqual({
      _tag: "Invalid",
      empty: false,
      errors: ["Include a number"],
      required: true,
      value: "longenough",
    });
    expect(confirm).toEqual({
      _tag: "Invalid",
      empty: false,
      errors: ["Passwords must match"],
      required: true,
      value: "short",
    });
    // Optional and empty: acceptable, and nothing to show.
    expect(company).toEqual({
      _tag: "NotValidated",
      empty: true,
      required: false,
      value: "",
    });
    expect(
      Signup.validate(Signup.change(changed, "birthday", null)).fields.birthday
    ).toEqual({
      _tag: "NotValidated",
      empty: true,
      required: false,
      value: null,
    });

    const All = make(
      {
        password: { rules: [Rule.minLength(8), Rule.includes("1")] },
      },
      { errors: "all" }
    );
    const all = All.submit(All.init({ password: "abc" }));
    expect(All.validate(all).fields.password).toEqual({
      _tag: "Invalid",
      empty: false,
      errors: ["Must be at least 8 characters", "Must contain 1"],
      required: false,
      value: "abc",
    });
  });

  it("treats an empty Redacted value as empty for required and skips its rules", () => {
    let called = 0;
    const Login = make({
      password: {
        required: "Password is required",
        rules: [
          [
            (password) => {
              called += 1;
              return Redacted.value(password).length >= 8;
            },
            "Must be at least 8 characters",
          ],
        ],
        value: Schema.Redacted(Schema.String),
      },
    });
    const result = Login.validate(
      Login.submit(Login.init({ password: Redacted.make("") }))
    );
    expect(called).toBe(0);
    const { password } = result.fields;
    expect(password._tag).toBe("Invalid");
    if (password._tag === "Invalid") {
      expect(password.errors).toEqual(["Password is required"]);
      expect(password.required).toBe(true);
    }
    expect(Redacted.value(password.value)).toBe("");
    expect(Option.isNone(result.value)).toBe(true);
  });

  it("lists every rule of a field as met or unmet, before the field shows", () => {
    const Form = make({
      password: {
        rules: [
          Rule.minLength(8, "At least 8 characters"),
          [
            (password) => !password.includes(" "),
            (password) => `No spaces in "${password}"`,
          ],
        ],
      },
    });
    const at = (password: string) =>
      Form.checklist(Form.init({ password }), "password");
    expect(at("hunter 2")).toEqual([
      { message: "At least 8 characters", met: true },
      { message: `No spaces in "hunter 2"`, met: false },
    ]);
    // An empty value meets no rule, even one its predicate would pass.
    expect(at("")).toEqual([
      { message: "At least 8 characters", met: false },
      { message: `No spaces in ""`, met: false },
    ]);
    expect(
      Form.validate(Form.init({ password: "hunter 2" })).fields.password._tag
    ).toBe("NotValidated");
  });

  it("shows a field by its mode, and every field after a submit", () => {
    const all: Field<string>["_tag"][] = ["Invalid", "Invalid", "Invalid"];
    expect(shown("onChange")).toEqual([
      ["Invalid", "NotValidated", "NotValidated"],
      all,
    ]);
    expect(shown("onBlur")).toEqual([
      ["NotValidated", "Invalid", "NotValidated"],
      all,
    ]);
    expect(shown("onSubmit")).toEqual([
      ["NotValidated", "NotValidated", "NotValidated"],
      all,
    ]);
  });

  it("shows a server error at once and holds the value back until its field changes", () => {
    const Login = make({
      email: { required: "Email is required" },
      password: {},
    });
    const filled = Login.init({ email: "ada@example.com", password: "secret" });
    const rejected = Login.reject({ password: ["Invalid credentials"] })(
      filled
    );
    expect(Login.validate(rejected)).toEqual({
      fields: {
        email: {
          _tag: "NotValidated",
          empty: false,
          required: true,
          value: "ada@example.com",
        },
        password: {
          _tag: "Invalid",
          empty: false,
          errors: ["Invalid credentials"],
          required: false,
          value: "secret",
        },
      },
      invalid: true,
      validating: false,
      value: Option.none(),
    });
    expect(
      Login.validate(Login.change("email", "ada@example.org")(rejected)).invalid
    ).toBe(true);
    expect(
      Login.validate(Login.change("password", "secret2")(rejected)).value
    ).toEqual(
      Option.some({
        email: "ada@example.com",
        password: "secret2",
      })
    );
    expect(
      Login.validate(Login.reject(rejected, { password: [] })).invalid
    ).toBe(false);
  });

  it("reads a check once its field passes, and holds the value back until it answers", () => {
    const Account = make(
      {
        username: { required: "Pick a username", rules: [Rule.minLength(3)] },
      },
      {
        mode: "onChange",
      }
    );
    const at = (username: string) =>
      Account.change(Account.init({ username: "" }), "username", username);
    const derive = (
      username: string,
      check: AsyncResult.AsyncResult<readonly string[], never>
    ) => {
      const { fields, value, validating } = Account.validate(at(username), {
        username: check,
      });
      return [fields.username._tag, Option.isSome(value), validating];
    };
    expect(Account.passes(at("ab"), "username")).toBe(false);
    expect(Account.passes(at("ada"), "username")).toBe(true);
    // The rules fail first, so the check isn't read.
    expect(derive("ab", AsyncResult.initial(true))).toEqual([
      "Invalid",
      false,
      false,
    ]);
    expect(derive("ada", AsyncResult.initial(true))).toEqual([
      "Validating",
      false,
      true,
    ]);
    expect(derive("ada", AsyncResult.success([], { waiting: true }))).toEqual([
      "Validating",
      false,
      true,
    ]);
    expect(derive("ada", AsyncResult.failure(Cause.die("down")))).toEqual([
      "Validating",
      false,
      true,
    ]);
    expect(derive("ada", AsyncResult.success(["Taken"]))).toEqual([
      "Invalid",
      false,
      false,
    ]);
    expect(derive("ada", AsyncResult.success([]))).toEqual([
      "Valid",
      true,
      false,
    ]);
  });

  it("gives the same answer each time, and keeps a regex's flags", () => {
    const Form = make({
      code: { rules: [Rule.pattern(/^a$/gu)] },
      sticky: { rules: [Rule.pattern(/a/uy)] },
    });
    const state = Form.submit(Form.init({ code: "a", sticky: "ba" }));
    const first = Form.validate(state);
    expect(Form.validate(state)).toEqual(first);
    expect(first.fields).toEqual({
      code: { _tag: "Valid", empty: false, required: false, value: "a" },
      // A sticky pattern matches from the start only.
      sticky: {
        _tag: "Invalid",
        empty: false,
        errors: ["Invalid format"],
        required: false,
        value: "ba",
      },
    });
  });

  it("keeps its State as JSON for any field name, including ones on Object.prototype", () => {
    // SAFETY: the JSON literal above names exactly these keys, so the annotation only names the fixture `make` receives.
    const fields = JSON.parse(
      `{ "constructor": {}, "__proto__": { "required": "Required" } }`
    ) as {
      readonly constructor: Record<string, never>;
      readonly ["__proto__"]: { readonly required: string };
    };
    const Form = make(fields);
    const values = JSON.parse(`{ "constructor": "", "__proto__": "x" }`);
    const state = Form.reject(
      Form.blur(
        Form.change(Form.init(values), "constructor", "c"),
        "constructor"
      ),
      JSON.parse(`{ "__proto__": ["Taken"] }`)
    );
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON round-trip also proves the encoded State is JSON-serializable for the wire.
    const json = JSON.parse(
      JSON.stringify(Schema.encodeSync(Form.State)(state))
    );
    const decoded = Schema.decodeUnknownSync(Form.State)(json);
    expect(decoded).toEqual(state);
    const { fields: derived } = Form.validate(decoded);
    expect(Object.keys(derived)).toEqual(["constructor", "__proto__"]);
    expect(
      Object.getOwnPropertyDescriptor(derived, "__proto__")?.value
    ).toEqual({
      _tag: "Invalid",
      empty: false,
      errors: ["Taken"],
      required: true,
      value: "x",
    });
    expect(
      Object.getOwnPropertyDescriptor(decoded.values, "__proto__")?.value
    ).toBe("x");
  });
});
