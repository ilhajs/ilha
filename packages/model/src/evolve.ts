/**
 * Functions over plain structs, such as a Model or a struct inside one.
 *
 * `evolve` changes some fields of a struct and keeps the rest. Ported from
 * Effect UI's `UiStruct.ts`.
 */
import { dual } from "effect/Function";
import type * as Types from "effect/Types";

/**
 * The fields `evolve` takes for a struct `S`: each one optional, as its new
 * value or a function from its old value to the new one.
 *
 * A function is always the updater, so a field that may hold a function,
 * an optional callback included, is `never` here and can't be set through
 * `evolve`. It is an error message instead when `S` is a union, an array, a
 * primitive or function, or unknown.
 */
export type EvolveFields<S> = unknown extends S
  ? "evolve needs the struct's type: write evolve<Model>(...)"
  : Types.IsUnion<S> extends true
    ? "evolve takes one struct: match the union first"
    : S extends readonly unknown[]
      ? "evolve takes a struct, not an array"
      : // oxlint-disable-next-line anti-slop/no-unknown-returns -- function-shape probe: any return (including unknown) means "not a plain struct".
        S extends (...args: never[]) => unknown
        ? "evolve takes a struct"
        : S extends object
          ? [keyof S] extends [never]
            ? "evolve takes a struct with fields"
            : { readonly [K in keyof S]?: EvolveField<S[K]> }
          : "evolve takes a struct";

// A field that may hold a function, optional callbacks included, can't be
// told from an updater.
type EvolveField<A> = 0 extends 1 & A
  ? // oxlint-disable-next-line typescript/no-explicit-any -- `any` marks "could be a function": the field is never settable through evolve.
    any
  : [
        Extract<
          A,
          // oxlint-disable-next-line typescript/no-explicit-any -- Extract probes for any function shape, including `any`-typed callbacks.
          (...args: any[]) => any
        >,
      ] extends [never]
    ? A | ((value: A) => A)
    : never;

const applyFields = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- applyFields is evolve's untyped dual implementation; the overloads below state the contract.
  self: unknown,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the fields bag is heterogeneous by design; EvolveFields states the per-key contract.
  fields: Record<PropertyKey, unknown>
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- applyFields is evolve's untyped dual implementation; the overloads below state the contract.
): unknown => {
  let out = self;
  // SAFETY: self is only key-read and spread into a fresh object below; the input is never mutated.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- keyed reads over an impl-level unknown need a dictionary view; EvolveFields is the typed contract.
  const previous = self as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(fields)) {
    const field = fields[key];
    const old = previous[key];
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- function-ness IS the contract: any function value is the updater (documented on evolve).
    const isUpdater = typeof field === "function";
    // SAFETY: isUpdater is the typeof check above; updaters take the old field value per EvolveField, and the cast has no runtime effect.
    // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- updater takes and returns the unknown-erased field value; EvolveField states the typed contract.
    const update = field as (value: unknown) => unknown;
    const value = isUpdater ? update(old) : field;
    if (!Object.is(value, old)) {
      if (out === self) {
        out = { ...previous };
      }
      // SAFETY: out is the fresh copy here (made just above while it was still self); the input is never written.
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- keyed write into the fresh impl-level copy; EvolveFields is the typed contract.
      (out as Record<PropertyKey, unknown>)[key] = value;
    }
  }
  return out;
};

/**
 * Changes some fields of a struct and keeps the rest. Each field takes its
 * new value, or a function from its old value to the new one.
 *
 * A function is always the updater. A union is an error: match it first,
 * then evolve the member. The result is a plain-object shallow copy with the
 * changed fields, or the same struct when every field keeps its value. It is
 * for plain structs, not `Schema.Class` or other class instances: use
 * `$.set` for class Models.
 */
// SAFETY: dual(2, impl) carries the two call overloads below; the impl handles both arities at runtime and its return is re-wrapped by dual.
export const evolve: {
  <S>(fields: NoInfer<EvolveFields<S>>): (self: S) => S;
  <S>(self: S, fields: NoInfer<EvolveFields<S>>): S;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- dual implementation signature is untyped by design; the overloads above state the contract.
} = dual(2, applyFields as (self: unknown, fields: unknown) => never);
