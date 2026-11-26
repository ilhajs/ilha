/**
 * The redacting walk shared by the message log and the query's log keys, and
 * the check that keeps a `Schema.Redacted` out of serialised state. Ported
 * from Effect UI's `internal/schema-redact.ts`.
 *
 * @internal
 */
import { memoize } from "effect/Function";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaGetter from "effect/SchemaGetter";

import * as AST from "./wire-ast.ts";

const isRedactedAST = (ast: SchemaAST.AST): boolean =>
  // SAFETY: annotations are an open record by Schema's contract; representation is read-only and compared, never written.
  ast._tag === "Declaration" &&
  (ast.annotations?.representation as { readonly id?: unknown } | undefined)
    ?.id === "effect/schema/Redacted";

const redactedLink = Schema.link<Redacted.Redacted<unknown>>()(
  Schema.Struct({ "~redacted": Schema.Literal(true) }),
  {
    decode: SchemaGetter.forbidden(
      () => "a redacted value was sent as a placeholder and can't be decoded"
    ),
    encode: SchemaGetter.transform(() => ({ "~redacted": true as const })),
  }
);

/**
 * Replaces every `Schema.Redacted` node's encoding with a placeholder, including
 * fields, elements, union members, declaration type parameters, suspended schemas
 * and transformations' encoded sides. Replacing the node's own codec prevents
 * `RedactedFromValue` from unwrapping its value. Declaration type parameters
 * (such as those of `Option` and `ReadonlyMap`) encode contents before the
 * declaration's derived JSON codec runs, so they must also be redacted.
 *
 * Suspended nodes are rebuilt lazily, even when their bodies contain no
 * `Schema.Redacted`. Use `holdsRedacted` for a presence check.
 *
 * @internal
 */
export const redactAST: (ast: SchemaAST.AST) => SchemaAST.AST = memoize(
  (ast: SchemaAST.AST): SchemaAST.AST => {
    if (isRedactedAST(ast)) {
      const out = AST.replaceEncoding(ast, [redactedLink]);
      return ast.context === undefined
        ? out
        : AST.replaceContextLastLink(out, ast.context);
    }
    if (ast.encoding !== undefined) {
      const body = AST.replaceEncoding(ast, undefined); // oxlint-disable-line unicorn/no-useless-undefined -- the parameter is required and undefined clears the encoding.
      const redactedBody = redactAST(body);
      const encoding = SchemaAST.mapOrSame(ast.encoding, (link) =>
        AST.mapLink(link, redactAST)
      );
      return redactedBody === body && encoding === ast.encoding
        ? ast
        : AST.replaceEncoding(redactedBody, encoding);
    }
    return AST.recur(ast, redactAST);
  }
);

/**
 * Whether `ast` declares a `Schema.Redacted` anywhere, as `redactAST` finds
 * one. The check is on the Schema, not on a value.
 *
 * @internal
 */
export const holdsRedacted = memoize((ast: SchemaAST.AST): boolean => {
  const seen = new Set<SchemaAST.AST>();
  const visit = (node: SchemaAST.AST): boolean => {
    if (seen.has(node)) {
      return false;
    }
    seen.add(node);
    if (isRedactedAST(node)) {
      return true;
    }
    if (node.encoding?.some((link) => visit(link.to))) {
      return true;
    }
    switch (node._tag) {
      case "Objects": {
        return (
          node.propertySignatures.some((property) => visit(property.type)) ||
          node.indexSignatures.some(
            (index) => visit(index.parameter) || visit(index.type)
          )
        );
      }
      case "Arrays": {
        return node.elements.some(visit) || node.rest.some(visit);
      }
      case "Union": {
        return node.types.some(visit);
      }
      case "Suspend": {
        return visit(node.thunk());
      }
      case "Declaration": {
        return node.typeParameters.some(visit);
      }
      default: {
        return false;
      }
    }
  };
  return visit(ast);
});
