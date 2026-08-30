import { expect, test } from "bun:test";

import { html, raw } from "./index";

test("JSX and html templates share attribute and child serialization", () => {
  const href = "/users/42";
  const label = "<Ada>";
  const style = { color: "red", fontSize: "14px" };

  const jsxOutput = (
    <a href={href} class={["user", false, "active"]} style={style} aria-hidden={false}>
      {label}
      <strong>{raw("!")}</strong>
    </a>
  ).value;
  const htmlOutput = html`<a
    href=${href}
    class=${["user", false, "active"]}
    style=${style}
    aria-hidden=${false}
    >${label}<strong>${raw("!")}</strong></a
  >`.value;

  const normalize = (value: string) =>
    value
      .replace(/=(["'])(.*?)\1/g, "=$2")
      .replace(/>\s+</g, "><")
      .trim();
  expect(normalize(htmlOutput)).toBe(normalize(jsxOutput));
});

test("html templates apply URL policy after mixed interpolation", () => {
  const scheme = "java";
  const rest = "script:alert(1)";
  expect(html`<a href="${scheme}${rest}">unsafe</a>`.value).toBe("<a>unsafe</a>");
});

test("JSX renders through template IR without lowercasing SVG names", () => {
  const out = (
    <svg viewBox="0 0 24 24">
      <linearGradient gradientUnits="userSpaceOnUse" />
      <circle strokeWidth={2} />
    </svg>
  ).value;
  expect(out).toContain("viewBox=");
  expect(out).toContain("<linearGradient");
  expect(out).toContain("stroke-width=");
  expect(out).not.toContain("viewbox=");
  expect(out).not.toContain("<lineargradient");
});
