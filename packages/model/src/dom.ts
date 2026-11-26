/**
 * Refs: names for elements that `DomCommand` reaches and `h.ref` attaches.
 * A ref resolves within the instance that issued the Command, so two
 * instances never collide. Ported from Effect UI's `Renderer.Ref`/`Refs`.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/**
 * A name for an element the instance renders, typed by the node it reaches.
 * `at` derives a ref for one row of a list.
 */
export interface Ref<in out Node> {
  /** The ref's name, without any `at` keys. */
  readonly name: string;
  /** The name plus any `at` keys: what the element stores. */
  readonly key: string;
  /** A ref for one row: `Row.at(id)`. */
  readonly at: (key: string | number) => Ref<Node>;
}

/**
 * Declares a ref for the element `h.ref` names. The optional `tag` types the
 * node it reaches, as `document.createElement(tag)` would return it.
 */
const refAt = <Node>(name: string, key: string): Ref<Node> => ({
  at: (row) => refAt(name, `${key}[${row}]`),
  key,
  name,
});

export const ref: {
  <K extends keyof HTMLElementTagNameMap>(
    name: string,
    tag: K
  ): Ref<HTMLElementTagNameMap[K]>;
  <Node extends Element = Element>(name: string, tag?: string): Ref<Node>;
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the dual call signatures are the public contract; the generic below is the single implementation.
} = <Node extends Element>(name: string, _tag?: string): Ref<Node> =>
  refAt(name, name);

const isRef = (u: unknown): u is Ref<Element> =>
  Predicate.hasProperty(u, "name") &&
  typeof u.name === "string" &&
  Predicate.hasProperty(u, "key") &&
  typeof u.key === "string" &&
  Predicate.hasProperty(u, "at") &&
  typeof u.at === "function";

/**
 * The Schema of a ref in a Command's `args`: it encodes to the ref's `key`.
 * Decoding a key gives a ref with that key, named by the part before any
 * `at` keys. A name containing `[` decodes with a shorter name; the `key`
 * stays exact, and the runtime resolves refs by key.
 */
export const RefSchema: Schema.decodeTo<
  Schema.declare<Ref<Element>>,
  Schema.String
> = Schema.String.pipe(
  Schema.decodeTo(
    Schema.declare(isRef, { expected: "Dom.Ref" }),
    SchemaTransformation.transform({
      decode: (key: string): Ref<Element> => {
        const at = key.indexOf("[");
        return refAt(at === -1 ? key : key.slice(0, at), key);
      },
      encode: (value: Ref<Element>) => value.key,
    })
  )
);

/**
 * How a Command reaches an element of the instance that issued it. `lookup`
 * waits for the issuing update's commit, then returns `Option.none()` for a
 * ref that isn't rendered. The kernel gives every Command run one, so it is
 * a framework service and never part of a component's requirements.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+const pair: the interface is the service contract, the const its Context.Reference.
export interface Refs {
  /** Resolve `ref` within the issuing instance, after its commit. */
  readonly lookup: <Node extends Element>(
    ref: Ref<Node>
  ) => Effect.Effect<Option.Option<Node>>;
}

const silent: Refs = {
  lookup: () => Effect.succeed(Option.none()),
};

/**
 * The `Refs` service. It defaults to one that resolves nothing, so a host
 * without a document needs nothing; the kernel always provides the real one.
 */
export const Refs: Context.Reference<Refs> = Context.Reference<Refs>(
  "@ilha/model/Dom/Refs",
  { defaultValue: () => silent }
);

declare module "./command.ts" {
  interface FrameworkServices {
    /** How a Command reaches the issuing instance's elements. */
    readonly refs: Refs;
  }
}
