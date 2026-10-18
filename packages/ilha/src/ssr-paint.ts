import { createPainter } from "./paint-core.ts";
import { SsrEl } from "./ssr-dom.ts";
import type { SsrNode } from "./ssr-dom.ts";

const WHITESPACE_RUN = /\s+/gu;

/**
 * Mark the first option whose value is `value` selected and clear the rest,
 * as setting a live select's `.value` does. Returns whether one matched.
 */
const selectOption = (
  parent: SsrEl,
  value: string,
  found: boolean
): boolean => {
  let matched = found;
  for (const child of parent.children) {
    if (child.kind !== "element") {
      continue;
    }
    if (child.localName === "optgroup") {
      matched = selectOption(child, value, matched);
    } else if (child.localName === "option") {
      const optionValue =
        child.getAttribute("value") ??
        child.textContent.trim().replaceAll(WHITESPACE_RUN, " ");
      if (!matched && optionValue === value) {
        child.setAttribute("selected", "");
        matched = true;
      } else {
        child.removeAttribute("selected");
      }
    }
  }
  return matched;
};

/** The string painter: every paint rebuilds the host's children. */
export const { paint } = createPainter<SsrNode, SsrEl>({
  createElement: (tag) => new SsrEl(tag),
  createRaw: (html) => [{ html, kind: "raw" }],
  createText: (text) => ({ kind: "text", text }),
  placeChildren: (root, nodes) => {
    // SAFETY: SSR fiber roots are SsrEl hosts.
    const host: SsrEl = root as never;
    host.children = nodes;
  },
  setFormControl: (el, key, v) => {
    if (key !== "value") {
      if (v) {
        el.setAttribute(key, "");
      } else {
        el.removeAttribute(key);
      }
      return;
    }
    const text = String(v ?? "");
    if (el.localName === "textarea") {
      // A textarea's value is its text; a `value` attribute is ignored.
      el.textContent = text;
    } else if (el.localName !== "select") {
      el.setAttribute("value", text);
    } else if (v !== null && v !== undefined) {
      // `null`/`undefined` leave the options' own `selected` alone.
      selectOption(el, text, false);
    }
  },
});
