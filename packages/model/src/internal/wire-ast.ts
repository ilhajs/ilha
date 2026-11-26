/**
 * `effect/SchemaAST` functions that `effect` exports at runtime but marks
 * `@internal`, so its published declarations leave them out, plus the
 * canonical JSON encoding the log uses for group keys. Ported from Effect
 * UI's `internal/schemaAST.ts` and `internal/query-core.ts`.
 *
 * @internal
 */
import * as SchemaAST from "effect/SchemaAST";

interface Internals {
  readonly replaceEncoding: <A extends SchemaAST.AST>(
    ast: A,
    encoding: readonly SchemaAST.Link[] | undefined
  ) => A;
  readonly replaceContextLastLink: <A extends SchemaAST.AST>(
    ast: A,
    context: SchemaAST.Context
  ) => A;
  readonly mapLink: (
    link: SchemaAST.Link,
    f: (ast: SchemaAST.AST) => SchemaAST.AST
  ) => SchemaAST.Link;
  readonly getIndexSignatureKeys: (
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: mirrors effect's own runtime signature; inputs are Schema AST maps keyed by PropertyKey.
    input: Readonly<Record<PropertyKey, unknown>>,
    parameter: SchemaAST.IndexSignature["parameter"]
  ) => readonly PropertyKey[];
}

// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: effect ships these helpers at runtime but omits them from its published declarations; Internals above states their exact contract.
const internals = SchemaAST as unknown as Internals;

/** @internal */
export const { replaceEncoding } = internals;

/** @internal */
export const { replaceContextLastLink } = internals;

/** @internal */
export const { mapLink } = internals;

/** @internal */
export const { getIndexSignatureKeys } = internals;

/**
 * Rebuilds a node's children with `f`, for the nodes that have children.
 */
export const recur = (
  ast: SchemaAST.AST,
  f: (ast: SchemaAST.AST) => SchemaAST.AST
): SchemaAST.AST => {
  if (!("recur" in ast)) {
    return ast;
  }
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: effect ships recur at runtime but omits it from its published AST declarations; the rebuildable contract above is the runtime shape.
  const rebuildable = ast as unknown as {
    recur: (f: (ast: SchemaAST.AST) => SchemaAST.AST) => SchemaAST.AST;
  };
  return rebuildable.recur(f);
};

// A fixed name for the kind of a leaf. Never its value, nor anything the value can set, such as its string tag: a
// key can hold a secret.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the leaf is any value JSON cannot carry; the branches below decode it into a fixed kind name.
const kindOf = (leaf: unknown): string => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the switch decodes the leaf into its fixed kind name; the result never carries the value.
  switch (typeof leaf) {
    case "number": {
      return "a non-finite number";
    }
    case "undefined": {
      return "undefined";
    }
    case "object": {
      return "a class instance";
    }
    default: {
      return `a ${typeof leaf}`; // oxlint-disable-line anti-slop/no-runtime-typeof -- the fallback kind names the primitive; the result never carries the value.
    }
  }
};
/**
 * The kind of a leaf JSON can't carry. Never its value, nor anything the
 * value can set, such as its string tag: a key can hold a secret.
 *
 * @internal
 */
export class NonJsonLeaf {
  /** The fixed kind name of the leaf. */
  readonly kind: string;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the leaf is any value JSON cannot carry; kindOf decodes it into a fixed kind name.
  constructor(leaf: unknown) {
    this.kind = kindOf(leaf);
  }
}

/**
 * Canonical JSON: sorted object keys, `undefined` properties dropped, no
 * whitespace, `-0` kept apart from `0`. It parses back with `JSON.parse`.
 * Throws a `NonJsonLeaf` on a leaf JSON can't carry.
 *
 * @internal
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- canonical accepts any runtime value; NonJsonLeaf rejects what JSON cannot carry.
export const canonical = (u: unknown): string => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- decoding the value into its canonical encoding; the result never carries the input contract.
  if (u === null || typeof u === "boolean") {
    return String(u);
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- decoding the value into its canonical encoding; the result never carries the input contract.
  if (typeof u === "string") {
    return JSON.stringify(u);
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- decoding the value into its canonical encoding; the result never carries the input contract.
  if (typeof u === "number") {
    if (!Number.isFinite(u)) {
      throw new NonJsonLeaf(u);
    }
    return Object.is(u, -0) ? "-0" : String(u);
  }
  if (Array.isArray(u)) {
    const parts: string[] = [];
    // Not `map`: a hole must throw too.
    // oxlint-disable-next-line typescript/prefer-for-of -- index order preserves holes; for-of would skip them and change which leaves throw.
    for (let i = 0; i < u.length; i += 1) {
      parts.push(canonical(u[i]));
    }
    return `[${parts.join(",")}]`;
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- decoding the value into its canonical encoding; the result never carries the input contract.
  if (typeof u === "object") {
    const proto = Object.getPrototypeOf(u);
    if (proto !== Object.prototype && proto !== null) {
      throw new NonJsonLeaf(u);
    }
    // SAFETY: the prototype check above leaves only plain objects and null-prototype maps, whose string keys read as unknown values.
    const o = u as Record<string, unknown>; // oxlint-disable-line anti-slop/no-unsafe-dictionary-type -- plain-object keys read as unknown by construction; each value is re-decoded above.
    const parts: string[] = [];
    for (const key of Object.keys(o).toSorted()) {
      if (o[key] !== undefined) {
        parts.push(`${JSON.stringify(key)}:${canonical(o[key])}`);
      }
    }
    return `{${parts.join(",")}}`;
  }
  throw new NonJsonLeaf(u);
};
