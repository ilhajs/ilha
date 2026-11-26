/**
 * Schemas for UI values that are built often and must stay cheap to build.
 *
 * `TaggedEnum` takes the same input as `Schema.TaggedUnion` and attaches one
 * constructor per case, plus `is` and `match`, directly to the schema.
 * Ported from Effect UI's `UiSchema.ts`.
 */
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as Types from "effect/Types";

/**
 * A `Schema.TaggedUnion` with one unchecked constructor per case, `is` and
 * `match`.
 *
 * The schema members come from {@link TaggedEnum.Base} and the constructors
 * from {@link TaggedEnum.Constructors}.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional type+const pair: the type is the schema contract, the const its builder.
export type TaggedEnum<Cases extends Record<string, Schema.Constraint>> =
  TaggedEnum.Base<Cases> & TaggedEnum.Constructors<Cases>;

/**
 * Types that make up a {@link TaggedEnum}.
 */
// oxlint-disable-next-line eslint/no-redeclare, typescript/no-namespace -- the namespace holds the companion types; merging it into the const+type pair is the public API.
export declare namespace TaggedEnum {
  /**
   * The schema members of a {@link TaggedEnum}, without the constructors.
   */
  export interface Base<
    Cases extends Record<string, Schema.Constraint>,
  > extends Schema.TaggedUnion<Cases> {
    /**
     * Returns a type guard that checks only the `_tag` field.
     */
    readonly is: <Tag extends keyof Cases>(
      tag: Tag
    ) => (u: unknown) => u is Cases[Tag]["Type"];
  }

  /**
   * One constructor per case, keyed by tag. A constructor takes the case's
   * `Type` without `_tag`, or no argument when the case has no other fields,
   * and returns it with `_tag` added.
   */
  export type Constructors<Cases extends Record<string, Schema.Constraint>> = {
    readonly [K in keyof Cases]: (
      args: Types.VoidIfEmpty<{
        readonly [
          P in keyof Cases[K]["Type"] as P extends "_tag" ? never : P
        ]: Cases[K]["Type"][P];
      }>
    ) => Cases[K]["Type"];
  };

  /**
   * Keys that can't be tags because they collide with schema, function or
   * object members.
   */
  export type ReservedTag =
    // oxlint-disable-next-line typescript/no-unsafe-function-type, typescript/ban-types -- keyof Function enumerates function-member collisions; no narrower named type exists.
    | Extract<keyof Base<Record<string, never>> | keyof Function, string>
    | "constructor"
    | "hasOwnProperty"
    | "isPrototypeOf"
    | "propertyIsEnumerable"
    | "toLocaleString"
    | "toString"
    | "valueOf"
    | "__proto__"
    | "__defineGetter__"
    | "__defineSetter__"
    | "__lookupGetter__"
    | "__lookupSetter__";
}

type TagOf<K> = K extends number ? `${K}` : Extract<K, string>;

const is =
  (tag: string) =>
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- unknown is the narrowest honest input for a runtime tag check.
  (u: unknown): boolean =>
    Predicate.isTagged(u, tag);

/**
 * Builds a `Schema.TaggedUnion` and attaches one unchecked constructor per
 * case, plus `is` and `match`, directly to the schema.
 *
 * Each constructor is keyed by its tag and only adds `_tag` to its input.
 * The input is the case's `Type` without `_tag`; a case with no other fields
 * takes no argument. `is(tag)` returns a guard that checks only `_tag`.
 *
 * Constructors skip validation, checks and constructor defaults. A field
 * with a constructor default is required, and a branded field takes a
 * branded value. A tag in {@link TaggedEnum.ReservedTag} is a type error,
 * and a case declaring its own `_tag` field throws when the schema is built.
 */
export const TaggedEnum = <
  const CasesByTag extends Record<string, Schema.Struct.Fields>,
>(
  casesByTag: CasesByTag & {
    readonly [K in keyof CasesByTag]: K extends TaggedEnum.ReservedTag
      ? never
      : { readonly _tag?: never };
  }
): TaggedEnum<{
  readonly [K in keyof CasesByTag as TagOf<K>]: Schema.TaggedStruct<
    TagOf<K>,
    CasesByTag[K]
  >;
}> => {
  const tags = Object.keys(casesByTag);
  for (const key of tags) {
    const fields = casesByTag[key];
    if (fields !== undefined && Object.hasOwn(fields, "_tag")) {
      throw new Error(`Case ${key} can't declare _tag`);
    }
  }
  const union = Schema.TaggedUnion(casesByTag);
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the constructors bag is heterogeneous by tag; Constructors states the per-case contract.
  const constructors: Record<string, unknown> = {};
  for (const key of tags) {
    // oxlint-disable-next-line anti-slop/no-object-parameters -- the impl-level constructor takes any case fields or nothing; Constructors states the per-case signature.
    constructors[key] = (args: object | undefined) => ({ ...args, _tag: key });
  }
  // The union already carries its schema members (`tag`, `cases`, `match`,
  // ...); the constructors ride along as extra properties, so wrappers built
  // with `annotate`, `check` or `Schema.rebuild` must re-attach them.
  // SAFETY: constructors only add per-tag callables keyed by validated tags (own `_tag` rejected above); the schema members come from Schema.TaggedUnion untouched.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the schema-plus-constructors shape has no single-step assertion from Object.assign's result.
  return Object.assign(union, {
    is,
    ...constructors,
  }) as unknown as TaggedEnum<{
    readonly [K in keyof CasesByTag as TagOf<K>]: Schema.TaggedStruct<
      TagOf<K>,
      CasesByTag[K]
    >;
  }>;
};
