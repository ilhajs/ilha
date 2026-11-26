/**
 * Field validation for forms: Foldkit's rules, with each field's state derived
 * from what the user did instead of stored.
 *
 * `make` takes the form's fields, each with the Schema of what its control
 * holds (a string by default), a `required` message and a list of rules. It
 * returns a {@link Validation}: a `State` Schema for the Model, functions
 * that record what the user did, and `validate`, which derives each field as
 * `NotValidated`, `Validating`, `Valid` or `Invalid`.
 *
 * The Model holds the values as typed, which fields were edited or left, whether
 * a submit was tried, and the server's errors. Errors are never stored, so a
 * rule that reads another field always sees its current value.
 *
 * **Example** (A sign-up form)
 *
 * ```ts import.meta.vitest
 * import { Validation } from "@ilha/model/validation"
 * import { Equal, Redacted, Schema } from "effect"
 *
 * const Signup = Validation.make({
 *   email: { required: "Email is required", rules: [Validation.Rule.email()] },
 *   password: {
 *     value: Schema.Redacted(Schema.String),
 *     required: "Password is required",
 *     rules: [[(password) => Redacted.value(password).length >= 8, "Must be at least 8 characters"]]
 *   },
 *   confirm: {
 *     value: Schema.Redacted(Schema.String),
 *     required: "Confirm your password",
 *     rules: [[(confirm, values) => Equal.equals(confirm, values.password), "Passwords must match"]]
 *   }
 * }, { mode: "onChange" })
 *
 * let state = Signup.init({ email: "", password: Redacted.make(""), confirm: Redacted.make("") })
 * state = Signup.change(state, "password", Redacted.make("hunter22"))
 * state = Signup.change(state, "confirm", Redacted.make("hunter2"))
 *
 * const { email, confirm } = Signup.validate(state).fields
 * email._tag // => "NotValidated"
 * confirm // => { _tag: "Invalid", value: Redacted.make("hunter2"), empty: false, required: true, errors: ["Passwords must match"] }
 * ```
 *
 * @since 0.1.0
 */
import type * as Arr from "effect/Array";
import { dual } from "effect/Function";
import * as Option from "effect/Option";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/**
 * A rule's message: a string, or a function of the field's value.
 *
 * **Gotchas**
 *
 * `validate` calls a message function only with a value that fails the rule.
 * `checklist` calls it for every rule, so it also gets a value that meets
 * the rule, and an empty value, which the predicate never sees. A function
 * used with `checklist` must handle an empty value, and return a label that
 * reads right whether or not the rule is met.
 *
 * @since 0.1.0
 */
export type RuleMessage<A> = string | ((value: A) => string);

/**
 * A rule: a predicate and the message shown when it returns `false`.
 *
 * **Details**
 *
 * The predicate gets the field's value and every value of the form, so a rule
 * can compare two fields. The rules in {@link Rule} ignore the second
 * argument, so they fit any form.
 *
 * `checklist` shows the message for every rule, met or not. See
 * {@link RuleMessage} for what that asks of a message function.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
export type Rule<A, Values = unknown> = readonly [
  predicate: (value: A, values: Values) => boolean,
  message: RuleMessage<A>,
];

const resolveMessage = <A>(message: RuleMessage<A>, value: A): string =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `RuleMessage` is a string-or-function union; `typeof` narrows it at this boundary.
  typeof message === "string" ? message : message(value);

const pattern = (
  regex: RegExp,
  message: RuleMessage<string> = "Invalid format"
): Rule<string> => {
  // A global or sticky RegExp keeps `lastIndex` between calls. A private
  // copy that starts at zero each time gives the same answer, keeps the
  // flags and leaves the caller's RegExp alone.
  // oxlint-disable-next-line eslint/require-unicode-regexp -- the copy inherits the caller's flags, which the rules below set.
  const copy = new RegExp(regex);
  return [
    (value) => {
      copy.lastIndex = 0;
      return copy.test(value);
    },
    message,
  ];
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const STRICT_URL = /^https?:\/\/.+/u;
const PERMISSIVE_URL = /^(?:https?:\/\/)?\S+\.\S+$/u;

/**
 * Foldkit's rules, with its patterns and default messages.
 *
 * **Details**
 *
 * Each rule takes an optional message, a string or a function of the value,
 * that replaces the default. A rule's predicate never sees an empty value: an
 * empty field is checked against `required` instead. A message function can
 * see one, because `checklist` calls it for every rule. See
 * {@link RuleMessage}.
 *
 * - `minLength(min)`, `maxLength(max)`: the string's length.
 * - `pattern(regex)`: the string matches `regex`.
 * - `email()`: something, `@`, something, `.`, something, with no spaces.
 * - `url({ requireProtocol })`: starts with `http://` or `https://`, or with
 *   `requireProtocol: false` a bare domain such as `example.com`.
 * - `startsWith(prefix)`, `endsWith(suffix)`, `includes(substring)`.
 * - `equals(expected)`, `oneOf(values)`: the string is one of these.
 * - `minItems(min)`, `maxItems(max)`: the array's length.
 * - `fromSchema(schema, message)`: the value decodes through `schema`. Use it
 *   to keep a rule and the parser you run at submit the same Schema.
 *
 * **Example** (Rules with default and custom messages)
 *
 * ```ts import.meta.vitest
 * import { Validation } from "@ilha/model/validation"
 * import { Schema } from "effect"
 *
 * const Rule = Validation.Rule
 *
 * const Profile = Validation.make({
 *   name: { required: "Name is required", rules: [Rule.minLength(2)] },
 *   website: { rules: [Rule.url({ requireProtocol: false })] },
 *   age: { rules: [Rule.fromSchema(Schema.FiniteFromString, (age) => age + " is not a number")] }
 * }, { mode: "onChange", errors: "all" })
 *
 * const state = Profile.change(Profile.init({ name: "", website: "", age: "" }), "age", "ten")
 * Profile.validate(state).fields.age // => { _tag: "Invalid", value: "ten", empty: false, required: false, errors: ["ten is not a number"] }
 * ```
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
export const Rule = {
  email: (
    message: RuleMessage<string> = "Invalid email address"
  ): Rule<string> => pattern(EMAIL, message),
  endsWith: (suffix: string, message?: RuleMessage<string>): Rule<string> => [
    (value) => value.endsWith(suffix),
    message ?? `Must end with ${suffix}`,
  ],
  equals: (expected: string, message?: RuleMessage<string>): Rule<string> => [
    (value) => value === expected,
    message ?? `Must match ${expected}`,
  ],
  fromSchema: <A, I>(
    schema: Schema.Codec<A, I>,
    message: RuleMessage<I>
  ): Rule<I> => {
    const decode = Schema.decodeOption(schema);
    return [(value) => Option.isSome(decode(value)), message];
  },
  includes: (
    substring: string,
    message?: RuleMessage<string>
  ): Rule<string> => [
    (value) => value.includes(substring),
    message ?? `Must contain ${substring}`,
  ],
  maxItems: (
    max: number,
    message?: RuleMessage<readonly unknown[]>
  ): Rule<readonly unknown[]> => [
    (value) => value.length <= max,
    message ?? `Must select at most ${max}`,
  ],
  maxLength: (max: number, message?: RuleMessage<string>): Rule<string> => [
    (value) => value.length <= max,
    message ?? `Must be at most ${max} characters`,
  ],
  minItems: (
    min: number,
    message?: RuleMessage<readonly unknown[]>
  ): Rule<readonly unknown[]> => [
    (value) => value.length >= min,
    message ?? `Must select at least ${min}`,
  ],
  minLength: (min: number, message?: RuleMessage<string>): Rule<string> => [
    (value) => value.length >= min,
    message ?? `Must be at least ${min} characters`,
  ],
  oneOf: (
    values: readonly string[],
    message?: RuleMessage<string>
  ): Rule<string> => [
    (value) => values.includes(value),
    message ?? `Must be one of: ${values.join(", ")}`,
  ],
  pattern,
  startsWith: (prefix: string, message?: RuleMessage<string>): Rule<string> => [
    (value) => value.startsWith(prefix),
    message ?? `Must start with ${prefix}`,
  ],
  url: (
    options: {
      readonly message?: RuleMessage<string> | undefined;
      readonly requireProtocol?: boolean | undefined;
    } = {}
  ): Rule<string> =>
    pattern(
      options.requireProtocol === false ? PERMISSIVE_URL : STRICT_URL,
      options.message ?? "Invalid URL"
    ),
} as const;

/**
 * When a field starts showing its result.
 *
 * **Details**
 *
 * - `"onChange"`: once the field was edited.
 * - `"onBlur"`: once the field was left, recorded with `blur`.
 * - `"onSubmit"`: once a submit was tried. The default, as in Base UI.
 *
 * After a tried submit every field shows its result, in every mode. Errors
 * from `reject` always show.
 *
 * @since 0.1.0
 */
export type Mode = "onChange" | "onBlur" | "onSubmit";

/**
 * Options for {@link make}.
 *
 * **Details**
 *
 * `errors: "first"`, the default, reports the first failing rule.
 * `errors: "all"` reports every failing rule, like Foldkit's `validateAll`.
 *
 * @since 0.1.0
 */
export interface Options {
  readonly mode?: Mode | undefined;
  readonly errors?: "first" | "all" | undefined;
}

/**
 * The value type of a field: its `value` Schema's `Type`, or `string` when the
 * field has no `value`.
 *
 * @since 0.1.0
 */
export type FieldType<S> = [S] extends [Schema.Top] ? S["Type"] : string;

/**
 * One field passed to {@link make}.
 *
 * **Details**
 *
 * - `value`: the Schema of what the control holds, such as `Schema.Boolean`
 *   for a checkbox. Defaults to `Schema.String`.
 * - `required`: the message for an empty value, or a function of every value
 *   that returns the message, or `false` when the field is optional for those
 *   values. Without it an empty value is acceptable and shows as
 *   `NotValidated`.
 * - `rules`: checked in order, only when the value isn't empty.
 * - `isEmpty`: what counts as empty. Defaults to an empty string or array,
 *   unwrapping a `Redacted` first.
 *
 * @since 0.1.0
 */
export interface FieldOptions<S, Values> {
  readonly value?: S & Schema.Top;
  readonly required?: string | ((values: Values) => string | false) | undefined;
  readonly rules?: readonly Rule<FieldType<S>, Values>[] | undefined;
  readonly isEmpty?: ((value: FieldType<S>) => boolean) | undefined;
}

/**
 * What a form remembers, kept in the Model through {@link Validation.State}.
 *
 * **Details**
 *
 * `values` are what the controls hold. `edited` and `touched` list the fields
 * that were changed and left, `submitted` records a tried submit, and
 * `rejected` holds the server's errors by field. Nothing derived is stored.
 *
 * @since 0.1.0
 */
export interface State<Values> {
  readonly values: Values;
  readonly edited: readonly Extract<keyof Values, string>[];
  readonly touched: readonly Extract<keyof Values, string>[];
  readonly submitted: boolean;
  readonly rejected: {
    readonly [K in keyof Values]?: Arr.NonEmptyReadonlyArray<string>;
  };
}

/**
 * A field that isn't showing a result yet, or is optional and empty.
 *
 * @since 0.1.0
 */
export interface NotValidated<A> {
  readonly _tag: "NotValidated";
  readonly value: A;
  readonly empty: boolean;
  readonly required: boolean;
}

/**
 * A field that passes its rules and waits on a check.
 *
 * @since 0.1.0
 */
export interface Validating<A> {
  readonly _tag: "Validating";
  readonly value: A;
  readonly empty: boolean;
  readonly required: boolean;
}

/**
 * A field that passes its rules and its check.
 *
 * @since 0.1.0
 */
export interface Valid<A> {
  readonly _tag: "Valid";
  readonly value: A;
  readonly empty: boolean;
  readonly required: boolean;
}

/**
 * A field with at least one error.
 *
 * @since 0.1.0
 */
export interface Invalid<A> {
  readonly _tag: "Invalid";
  readonly value: A;
  readonly empty: boolean;
  readonly required: boolean;
  readonly errors: Arr.NonEmptyReadonlyArray<string>;
}

/**
 * A field as {@link Validation.validate} derives it.
 *
 * **Details**
 *
 * Each state has the field's `value`, `empty` (the field's `isEmpty` applied
 * to `value`) and `required`, which is `true` when an empty value would be
 * an error, for a `*` next to the label.
 *
 * @since 0.1.0
 */
export type Field<A> = NotValidated<A> | Validating<A> | Valid<A> | Invalid<A>;

/**
 * One rule of a field, as {@link Validation.checklist} reports it: its message
 * and whether the field's value meets it.
 *
 * **Gotchas**
 *
 * The message is there for every rule, met or not, so write it as a
 * requirement, such as "At least 8 characters". A message function is called
 * with whatever the field holds, an empty value included.
 *
 * **Example** (A password's requirements)
 *
 * ```ts import.meta.vitest
 * import { Validation } from "@ilha/model/validation"
 * import { Redacted, Schema } from "effect"
 *
 * const Signup = Validation.make({
 *   password: {
 *     value: Schema.Redacted(Schema.String),
 *     required: "Password is required",
 *     rules: [
 *       [(password) => Redacted.value(password).length >= 8, "At least 8 characters"],
 *       [(password) => /\d/.test(Redacted.value(password)), "At least one number"]
 *     ]
 *   }
 * })
 *
 * // Nothing was submitted, so the field shows no error yet. The list is there anyway.
 * const state = Signup.change(Signup.init({ password: Redacted.make("") }), "password", Redacted.make("hunter2"))
 * Signup.checklist(state, "password") // => [{ message: "At least 8 characters", met: false }, { message: "At least one number", met: true }]
 * ```
 *
 * @since 0.1.0
 */
export interface ChecklistItem {
  readonly message: string;
  readonly met: boolean;
}

/**
 * The errors from async checks, by field: usually a query's result, mapped to
 * a list of errors.
 *
 * **Details**
 *
 * A check is read only when its field is filled in and passes its rules.
 * While it is `Initial` or waiting, the field is `Validating`. A `Success`
 * with errors makes it `Invalid`, and one with none leaves it `Valid`.
 *
 * @since 0.1.0
 */
export type Checks<Values> = {
  readonly [K in keyof Values]?:
    | AsyncResult.AsyncResult<readonly string[], never>
    | undefined;
};

/**
 * What {@link Validation.validate} derives from a {@link State}.
 *
 * **Details**
 *
 * - `fields`: each field as a {@link Field}.
 * - `value`: `Some` of the values when every field is acceptable, whether
 *   or not it shows yet. Use it to gate a submit.
 * - `invalid`: some field is `Invalid`.
 * - `validating`: some field is `Validating`.
 *
 * @since 0.1.0
 */
export interface Validated<Values> {
  readonly fields: { readonly [K in keyof Values]: Field<Values[K]> };
  readonly value: Option.Option<Values>;
  readonly invalid: boolean;
  readonly validating: boolean;
}

/**
 * A form's validation, made by {@link make}.
 *
 * **Details**
 *
 * `State` goes in the Model. `init`, `change`, `blur`, `submit` and
 * `reject` record what the user and the server did, and return a new state.
 * `change`, `blur` and `reject` are also data-last, so they fit an updater:
 * `{ ...model, form: Form.change("email", value)(model.form) }`.
 *
 * - `change(state, name, value)`: sets the value, marks the field edited and
 *   drops its server errors.
 * - `blur(state, name)`: marks the field touched.
 * - `submit(state)`: records a tried submit, so every field shows its result.
 * - `reject(state, { name: errors })`: stores server errors. They show at
 *   once and hold back `value` until the field changes. An empty list
 *   clears a field's errors.
 * - `passes(state, name)`: whether the field is filled in and passes its own
 *   rules, ignoring checks and server errors. Use it to enable the query
 *   behind a check.
 * - `checklist(state, name)`: every rule of the field with its message and
 *   whether the value meets it, in the order written. It ignores the mode,
 *   `errors`, checks and server errors, so a list of requirements can show
 *   from the first render. An empty value meets no rule. Each rule's message
 *   function is called every time, with an empty value too.
 * - `validate(state, checks?)`: derives a {@link Validated}. It is pure, so
 *   call it from `view`, `update` and tests.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+namespace pair
export interface Validation<Fields extends Validation.Fields> {
  readonly State: Schema.Codec<
    State<Validation.Values<Fields>>,
    State<Validation.Encoded<Fields>>,
    Fields[keyof Fields]["DecodingServices"],
    Fields[keyof Fields]["EncodingServices"]
  >;
  readonly init: (
    values: Validation.Values<Fields>
  ) => State<Validation.Values<Fields>>;
  readonly change: {
    <K extends Validation.Name<Fields>>(
      name: K,
      value: Validation.Values<Fields>[K]
    ): (
      self: State<Validation.Values<Fields>>
    ) => State<Validation.Values<Fields>>;
    <K extends Validation.Name<Fields>>(
      self: State<Validation.Values<Fields>>,
      name: K,
      value: Validation.Values<Fields>[K]
    ): State<Validation.Values<Fields>>;
  };
  readonly blur: {
    (
      name: Validation.Name<Fields>
    ): (
      self: State<Validation.Values<Fields>>
    ) => State<Validation.Values<Fields>>;
    (
      self: State<Validation.Values<Fields>>,
      name: Validation.Name<Fields>
    ): State<Validation.Values<Fields>>;
  };
  readonly submit: (
    self: State<Validation.Values<Fields>>
  ) => State<Validation.Values<Fields>>;
  readonly reject: {
    (
      errors: Readonly<
        Partial<Record<Validation.Name<Fields>, readonly string[]>>
      >
    ): (
      self: State<Validation.Values<Fields>>
    ) => State<Validation.Values<Fields>>;
    (
      self: State<Validation.Values<Fields>>,
      errors: Readonly<
        Partial<Record<Validation.Name<Fields>, readonly string[]>>
      >
    ): State<Validation.Values<Fields>>;
  };
  readonly passes: (
    self: State<Validation.Values<Fields>>,
    name: Validation.Name<Fields>
  ) => boolean;
  readonly checklist: (
    self: State<Validation.Values<Fields>>,
    name: Validation.Name<Fields>
  ) => readonly ChecklistItem[];
  readonly validate: (
    self: State<Validation.Values<Fields>>,
    checks?: Checks<Validation.Values<Fields>>
  ) => Validated<Validation.Values<Fields>>;
}

/**
 * Types that make up a {@link Validation}.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+namespace pair
// oxlint-disable-next-line typescript/no-namespace -- `Validation` groups its member types as a namespace, as the public API documents.
export declare namespace Validation {
  /**
   * The Schema of each field's value.
   *
   * @since 0.1.0
   */
  export type Fields = Readonly<Record<string, Schema.Top>>;

  /**
   * The values of a form, as the controls hold them.
   *
   * @since 0.1.0
   */
  export type Values<F extends Validation.Fields> = {
    readonly [K in keyof F]: F[K]["Type"];
  };

  /**
   * The values of a form, encoded.
   *
   * @since 0.1.0
   */
  export type Encoded<F extends Validation.Fields> = {
    readonly [K in keyof F]: F[K]["Encoded"];
  };

  /**
   * The name of a field.
   *
   * @since 0.1.0
   */
  export type Name<F extends Validation.Fields> = Extract<keyof F, string>;

  /**
   * The values {@link make} infers from its fields: each field's `value`
   * Schema's `Type`, or `string`.
   *
   * **Details**
   *
   * `K` is inferred from the field names on their own, so a field made only
   * of functions still has a value.
   *
   * @since 0.1.0
   */
  export type InferValues<S, K extends string> = Values<InferFields<S, K>>;

  /**
   * The value Schemas {@link make} infers from its fields: each field's
   * `value`, or `Schema.String`.
   *
   * @since 0.1.0
   */
  export type InferFields<S, K extends string> = {
    readonly [P in K]: P extends keyof S
      ? [S[P]] extends [Schema.Top]
        ? S[P]
        : Schema.String
      : Schema.String;
  };
}

interface Spec {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the function reads every value of the form, which has no single named type here.
  readonly required: string | ((values: unknown) => string | false) | undefined;
  readonly rules: readonly Rule<unknown, unknown>[];
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `isEmpty` narrows the control's value; the predicate owns its contract.
  readonly isEmpty: (value: unknown) => boolean;
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the Model holds each field under its own name with its Schema type; the map shape erases them into one `State`.
type AnyState = State<Record<string, unknown>>;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- controls hold arbitrary values; each rule and `isEmpty` narrows them.
const isEmptyValue = (value: unknown): boolean => {
  const unwrapped = Redacted.isRedacted(value) ? Redacted.value(value) : value;
  return (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- emptiness is a string-or-array representation check, not parsed input.
    (typeof unwrapped === "string" || Array.isArray(unwrapped)) &&
    unwrapped.length === 0
  );
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `required` functions read every value of the form, which has no single named type here.
const requiredMessage = (spec: Spec, values: unknown): string | undefined => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `required` is a message string, a message function, or absent; `typeof` selects the function case.
  if (typeof spec.required === "function") {
    const message = spec.required(values);
    return message === false ? undefined : message;
  }
  return spec.required;
};

const ruleErrors = (
  spec: Spec,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the predicate, not `ruleErrors`, owns the field's value contract.
  value: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- rules compare two fields, so both values stay unparsed until the predicate reads them.
  values: unknown,
  all: boolean
): string[] => {
  const errors: string[] = [];
  for (const [predicate, message] of spec.rules) {
    if (!predicate(value, values)) {
      errors.push(resolveMessage(message, value));
      if (!all) {
        break;
      }
    }
  }
  return errors;
};

const isNonEmpty = <A>(
  errors: readonly A[]
): errors is Arr.NonEmptyReadonlyArray<A> => errors.length > 0;

const add = <A>(names: readonly A[], name: A): readonly A[] =>
  names.includes(name) ? names : [...names, name];

/**
 * Builds a form's validation from its fields.
 *
 * **When to use**
 *
 * Use when a form's fields show errors as the user fills them in. Put
 * `State` in the Model, record each change with `change`, and derive the
 * fields with `validate` in `view` and `update`.
 *
 * **Details**
 *
 * `validate` derives each field in this order:
 *
 * 1. Errors from `reject` make it `Invalid`, and always show.
 * 2. An empty value is `Invalid` with the `required` message, or acceptable
 *    when the field is optional.
 * 3. The first failing rule is the error, or every failing rule with
 *    `errors: "all"`.
 * 4. A check that is `Initial` or waiting is `Validating`. A check that
 *    returned errors is `Invalid`.
 * 5. Otherwise the field is `Valid`.
 *
 * A field shows its result once a submit was tried, or by its `mode`. A
 * field that isn't showing, or is optional and empty, is `NotValidated`.
 *
 * **Gotchas**
 *
 * - Derived errors aren't in the Model or the MessageLog. Read them in a test
 *   with `validate(s.model.form)`.
 * - A check is typed to never fail. A failed result, from a defect, keeps the
 *   field `Validating`: map a fetch that can fail to errors first.
 * - The values are what the controls hold, not a parsed value. Parse them
 *   at submit, with the Schema that `Rule.fromSchema` checks.
 * - The `value` Schemas go in the Model, so history restore writes them into
 *   `history.state` and the server ships them in the page state. Declare a
 *   secret such as a password with `value: Schema.Redacted(Schema.String)`,
 *   and the component's whole state stays out of both: none of its fields
 *   restore or hydrate, so keep the form a leaf component. See
 *   `Component.define`.
 * - A form sets `novalidate`: native constraint validation isn't used.
 *
 * **Example** (A login form with a server error)
 *
 * ```ts import.meta.vitest
 * import { Validation } from "@ilha/model/validation"
 * import { Option, Redacted, Schema } from "effect"
 *
 * const Login = Validation.make({
 *   email: { required: "Email is required", rules: [Validation.Rule.email("Please enter a valid email")] },
 *   password: { value: Schema.Redacted(Schema.String), required: "Password is required" }
 * })
 *
 * // The default mode shows nothing until a submit is tried.
 * let form = Login.init({ email: "ada@example", password: Redacted.make("") })
 * Login.validate(form).fields.email._tag // => "NotValidated"
 *
 * form = Login.submit(form)
 * Login.validate(form).fields.email // => { _tag: "Invalid", value: "ada@example", empty: false, required: true, errors: ["Please enter a valid email"] }
 *
 * form = Login.change(form, "email", "ada@example.com")
 * form = Login.change(form, "password", Redacted.make("secret"))
 * Login.validate(form).value // => Option.some({ email: "ada@example.com", password: Redacted.make("secret") })
 *
 * // The server's error shows on the password until the password changes.
 * form = Login.reject(form, { password: ["Invalid credentials"] })
 * Login.validate(form).invalid // => true
 * ```
 *
 * @since 0.1.0
 */
export const make = <S, K extends string>(
  fields: {
    readonly [P in keyof S]: FieldOptions<S[P], Validation.InferValues<S, K>>;
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- field names are the form's own keys, and each value keeps its Schema from `input`.
  } & Readonly<Record<K, unknown>>,
  options: Options = {}
): Validation<Validation.InferFields<S, K>> => {
  const mode = options.mode ?? "onSubmit";
  const all = options.errors === "all";
  // SAFETY: `make` only reads the declared field options back through `input`; the cast recovers the `FieldOptions` shape the generic signature guarantees.
  const input = fields as Record<string, FieldOptions<Schema.Top, unknown>>;
  const names = Object.keys(input);
  const specs = new Map<string, Spec>(
    names.map((name) => [
      name,
      {
        isEmpty: input[name].isEmpty ?? isEmptyValue,
        required: input[name].required,
        rules: input[name].rules ?? [],
      },
    ])
  );
  const Name = Schema.Literals(names);
  // Records keyed by field name are built with `fromEntries`, so a name
  // such as `__proto__` stays an own key.
  const byName = <A>(f: (name: string) => A): Record<string, A> =>
    Object.fromEntries(names.map((name) => [name, f(name)]));
  const State = Schema.Struct({
    edited: Schema.Array(Name),
    rejected: Schema.Struct(
      byName(() => Schema.optionalKey(Schema.NonEmptyArray(Schema.String)))
    ),
    submitted: Schema.Boolean,
    touched: Schema.Array(Name),
    values: Schema.Struct(byName((name) => input[name].value ?? Schema.String)),
  });

  const shows = (state: AnyState, name: string): boolean =>
    state.submitted ||
    (mode === "onChange" && state.edited.includes(name)) ||
    (mode === "onBlur" && state.touched.includes(name));

  const passes = (state: AnyState, name: string): boolean => {
    const spec = specs.get(name);
    if (spec === undefined) {
      throw new Error(`Unknown field: ${name}`);
    }
    const value = state.values[name];
    return (
      !spec.isEmpty(value) &&
      spec.rules.every(([predicate]) => predicate(value, state.values))
    );
  };

  const checklist = (
    state: AnyState,
    name: string
  ): readonly ChecklistItem[] => {
    const spec = specs.get(name);
    if (spec === undefined) {
      throw new Error(`Unknown field: ${name}`);
    }
    const value = state.values[name];
    const empty = spec.isEmpty(value);
    return spec.rules.map(([predicate, message]) => ({
      message: resolveMessage(message, value),
      met: !empty && predicate(value, state.values),
    }));
  };

  const validate = (
    state: AnyState,
    checks: Record<
      string,
      AsyncResult.AsyncResult<readonly string[], never> | undefined
    > = {}
  ) => {
    const entries: [string, Field<unknown>][] = [];
    let acceptable = true;
    let invalid = false;
    let validating = false;
    for (const [name, spec] of specs) {
      const value = state.values[name];
      const empty = spec.isEmpty(value);
      const message = requiredMessage(spec, state.values);
      const shared = { empty, required: message !== undefined, value };
      const rejected = Object.hasOwn(state.rejected, name)
        ? state.rejected[name]
        : undefined;
      // The field's result before it shows. An optional empty field is
      // acceptable and has no result to show.
      let result: Field<unknown>;
      if (rejected !== undefined) {
        result = { _tag: "Invalid", ...shared, errors: rejected };
      } else if (empty) {
        result =
          message === undefined
            ? { _tag: "NotValidated", ...shared }
            : { _tag: "Invalid", ...shared, errors: [message] };
      } else {
        const errors = ruleErrors(spec, value, state.values, all);
        const check = Object.hasOwn(checks, name) ? checks[name] : undefined;
        if (isNonEmpty(errors)) {
          result = { _tag: "Invalid", ...shared, errors };
        } else if (check === undefined) {
          result = { _tag: "Valid", ...shared };
        } else if (check._tag === "Success" && !check.waiting) {
          result = isNonEmpty(check.value)
            ? { _tag: "Invalid", ...shared, errors: check.value }
            : { _tag: "Valid", ...shared };
        } else {
          result = { _tag: "Validating", ...shared };
        }
      }
      acceptable &&= result._tag === "Valid" || result._tag === "NotValidated";
      if (rejected === undefined && !shows(state, name)) {
        result = { _tag: "NotValidated", ...shared };
      }
      entries.push([name, result]);
      invalid ||= result._tag === "Invalid";
      validating ||= result._tag === "Validating";
    }
    return {
      fields: Object.fromEntries(entries),
      invalid,
      validating,
      value: acceptable ? Option.some(state.values) : Option.none(),
    };
  };

  // SAFETY: the object below holds the `State` Schema, the updater closures and `validate` for the inferred fields, so casting the `unknown`-erased internals back restores the exact public `Validation` contract.
  return {
    State,
    blur: dual(2, (self: AnyState, name: string): AnyState => ({
      ...self,
      touched: add(self.touched, name),
    })),
    change: dual(
      3,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `change` records the control's current value before any Schema parses it at submit.
      (self: AnyState, name: string, value: unknown): AnyState => {
        const { [name]: _, ...rejected } = self.rejected;
        return {
          ...self,
          edited: add(self.edited, name),
          rejected,
          values: { ...self.values, [name]: value },
        };
      }
    ),
    checklist,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the form's values are keyed by field name with each field's own Schema type; the map is internal to `make`.
    init: (values: Record<string, unknown>): AnyState => ({
      edited: [],
      rejected: {},
      submitted: false,
      touched: [],
      values,
    }),
    passes,
    reject: dual(
      2,
      (
        self: AnyState,
        errors: Record<string, readonly string[] | undefined>
      ): AnyState => {
        const merged = new Map<string, readonly string[] | undefined>(
          Object.entries(self.rejected)
        );
        for (const [name, list] of Object.entries(errors)) {
          if (list !== undefined) {
            merged.set(name, list);
          }
        }
        // `fromEntries` keeps any field name, `__proto__` included, as an own key.
        const kept = [...merged].filter(
          (entry): entry is [string, Arr.NonEmptyReadonlyArray<string>] =>
            entry[1] !== undefined && isNonEmpty(entry[1])
        );
        return { ...self, rejected: Object.fromEntries(kept) };
      }
    ),
    submit: (self: AnyState): AnyState =>
      self.submitted ? self : { ...self, submitted: true },
    validate,
    // oxlint-disable-next-line typescript/no-explicit-any -- intentional erasure, documented above.
  } as any;
};
