// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { h, mount, renderToString } from "../src/index.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_NS = "http://www.w3.org/1999/xhtml";

const BasicApp = () =>
  h(
    "svg",
    { viewBox: "0 0 10 10" },
    h("circle", { cx: "5", cy: "5", r: "4", "stroke-width": 2 })
  );

test("svg elements materialize in the SVG namespace", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, BasicApp);
  await Bun.sleep(10);

  const svg = el.querySelector("svg");
  const circle = el.querySelector("circle");
  if (!(svg instanceof SVGElement) || !(circle instanceof Element)) {
    throw new Error("svg tree missing");
  }
  expect(svg.namespaceURI).toBe(SVG_NS);
  expect(circle.namespaceURI).toBe(SVG_NS);
  // Attributes pass through verbatim — no case mangling.
  expect(svg.getAttribute("viewBox")).toBe("0 0 10 10");
  expect(circle.getAttribute("stroke-width")).toBe("2");
  unmount();
  el.remove();
});

const ForeignApp = () =>
  h("svg", { viewBox: "0 0 10 10" }, [
    h("foreignObject", { height: "10", width: "10" }, [
      h("div", { id: "fo-div" }, "hi"),
    ]),
  ]);

test("foreignObject children return to the HTML namespace", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ForeignApp);
  await Bun.sleep(10);

  const div = el.querySelector("#fo-div");
  if (!(div instanceof Element)) {
    throw new Error("foreignObject div missing");
  }
  expect(div.namespaceURI).toBe(HTML_NS);
  unmount();
  el.remove();
});

test("svg SSR output keeps attribute case", async () => {
  const html = await renderToString(BasicApp);
  expect(html).toContain('viewBox="0 0 10 10"');
  expect(html).toContain('stroke-width="2"');
  expect(html).toContain("<svg");
  expect(html).toContain("<circle");
});

const HydSvgApp = () =>
  h(
    "div",
    { id: "svg-wrap" },
    h("svg", { viewBox: "0 0 10 10" }, h("circle", { cx: "5", r: "4" }))
  );

test("hydrated svg keeps its namespace", async () => {
  const html = await renderToString(HydSvgApp);
  const el = document.createElement("div");
  document.body.append(el);
  el.innerHTML = html;
  const unmount = mount(el, HydSvgApp, { hydrate: true });
  await Bun.sleep(10);

  const svg = el.querySelector("svg");
  const circle = el.querySelector("circle");
  if (!(svg instanceof Element) || !(circle instanceof Element)) {
    throw new Error("hydrated svg tree missing");
  }
  expect(svg.namespaceURI).toBe(SVG_NS);
  expect(circle.namespaceURI).toBe(SVG_NS);
  expect(svg.getAttribute("viewBox")).toBe("0 0 10 10");
  unmount();
  el.remove();
});
