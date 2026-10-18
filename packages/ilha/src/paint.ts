import { bindEvents } from "./events.ts";
import {
  committedElement,
  hydrateInner,
  markControlled,
  morphInner,
  placeChildren,
  standInFor,
} from "./morph.ts";
import { createPainter } from "./paint-core.ts";

type FormNode = HTMLElement & {
  value?: string;
  defaultValue?: string;
  checked?: boolean;
  selected?: boolean;
};

const toggleAttr = (el: Element, name: string, on: boolean): void => {
  if (on) {
    el.setAttribute(name, "");
  } else {
    el.removeAttribute(name);
  }
};

/** The DOM painter: fresh renders morph into the live tree. */
export const { paint } = createPainter<Node, Element>({
  bindEvents,
  committed: committedElement,
  createElement: (tag, ns) =>
    ns ? document.createElementNS(ns, tag) : document.createElement(tag),
  createRaw: (html, parent) => {
    // SAFETY: raw injection is the documented contract of unsafe() — the
    // caller vouches for the markup. Parsed scripts do not execute on insert.
    const range = document.createRange();
    // SAFETY: fiber roots are live Elements, valid Range contexts.
    range.selectNodeContents(parent as Node);
    return [...range.createContextualFragment(html).childNodes];
  },
  createText: (text) => document.createTextNode(text),
  morph: (root, nodes, hydrate) => {
    // SAFETY: DOM fiber roots are Elements (mount host or hole host).
    const el = root as Element;
    if (!el.hasChildNodes()) {
      placeChildren(el, nodes);
      return;
    }
    const tmp = document.createElement("div");
    tmp.append(...nodes);
    if (hydrate) {
      const want = tmp.firstElementChild?.tagName;
      if (want && el.firstElementChild?.tagName !== want) {
        console.warn("[ilha] hydrate mismatch, full mount");
      }
    }
    (hydrate ? hydrateInner : morphInner)(el, tmp);
  },
  // SAFETY: DOM fiber roots are Elements.
  placeChildren: (root, nodes) => placeChildren(root as Element, nodes),
  // A connected host stays where it is; the morph resolves the stand-in.
  reuseNode: (host) => (host.isConnected ? standInFor(host) : host),
  setFormControl: (el, key, v) => {
    // SAFETY: form controls expose value/checked/selected live properties.
    const node = el as FormNode;
    // `null`/`undefined` mean uncontrolled: the morph keeps user edits.
    const set = v !== null && v !== undefined;
    if (set) {
      markControlled(el, key);
    }
    if (key !== "value") {
      node[key] = Boolean(v);
      toggleAttr(el, key, Boolean(v));
      return;
    }
    const text = set ? String(v) : "";
    if (el.localName === "textarea") {
      // A textarea's default value is its text: SSR markup and the morph
      // compare that, not a `value` attribute.
      node.defaultValue = text;
    } else if (el.localName !== "select") {
      // Mirror to the attribute so the morph can tell controlled renders
      // (attr present) from uncontrolled ones (attr absent, user edits win).
      if (set) {
        el.setAttribute("value", text);
      } else {
        el.removeAttribute("value");
      }
    }
    // A select picks among its options; the painter applies select props
    // after its children, so they exist here.
    node.value = text;
  },
  setStyle: (el, css) => {
    // SAFETY: style props apply to HTML/SVG elements, which carry `style`.
    (el as HTMLElement).style.cssText = css;
  },
});
