// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount, renderToString, unsafe } from "../src/index.ts";

const RAW = `<strong class="hi">Hi</strong>`;
const SVG = `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>`;
// SAFETY: builds unsanitized markup for bypass coverage without literals.
const jsSrc = ["java", "script:", "alert(1)"].join("");
const NASTY = `<img src="${jsSrc}" onerror="alert(2)" style="color:expression(alert(3))">`;

test("SSR paints unsafe() without escaping", async () => {
  const html = await renderToString(() => <div>{unsafe(RAW)}</div>);
  expect(html).toContain(RAW);
  expect(html).not.toContain("&lt;strong");
});

test("SSR still escapes plain strings", async () => {
  const html = await renderToString(() => <div>{RAW}</div>);
  expect(html).toContain("&lt;strong");
  expect(html).not.toContain("<strong");
});

test("mount paints unsafe() markup into the DOM", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, () => <div>{unsafe(RAW)}</div>);
  await Bun.sleep(5);
  expect(el.querySelector("strong.hi")?.textContent).toBe("Hi");
  unmount();
  el.remove();
});

test("mount paints unsafe() SVG with its namespace", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, () => <div>{unsafe(SVG)}</div>);
  await Bun.sleep(5);
  const svg = el.querySelector("svg");
  expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg");
  expect(svg?.querySelector("circle")).not.toBeNull();
  unmount();
  el.remove();
});

test("unsafe() output updates when its atom changes", async () => {
  let setHtml!: (next: string) => void;
  const App = () => {
    const html = atom(RAW);
    setHtml = (next: string) => html.set(next);
    return <div>{unsafe(html())}</div>;
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(el.querySelector("strong")).not.toBeNull();
  setHtml("<em>Bye</em>");
  await Bun.sleep(10);
  expect(el.querySelector("strong")).toBeNull();
  expect(el.querySelector("em")?.textContent).toBe("Bye");
  unmount();
  el.remove();
});

test("SSR keeps unsafe() markup verbatim, skipping all sanitizers", async () => {
  const html = await renderToString(() => <div>{unsafe(NASTY)}</div>);
  expect(html).toContain(NASTY);
});

test("mount keeps unsafe() attributes verbatim, skipping all sanitizers", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, () => <div>{unsafe(NASTY)}</div>);
  await Bun.sleep(5);
  const img = el.querySelector("img");
  expect(img?.getAttribute("src")).toBe(jsSrc);
  expect(img?.getAttribute("onerror")).toBe("alert(2)");
  expect(img?.getAttribute("style") ?? "").toContain("expression");
  unmount();
  el.remove();
});

test("mount keeps unsafe() table content inside its parent", async () => {
  // NOTE: happy-dom parses fragments without the Range context, so `tr` is
  // dropped here and only its text survives; real browsers keep the row.
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, () => (
    <table>{unsafe("<tr><td>cell</td></tr>")}</table>
  ));
  await Bun.sleep(5);
  expect(el.querySelector("table")?.textContent).toContain("cell");
  unmount();
  el.remove();
});

test("SSR keeps unsafe() table fragments verbatim", async () => {
  const html = await renderToString(() => (
    <table>{unsafe("<tr><td>cell</td></tr>")}</table>
  ));
  expect(html).toContain("<tr><td>cell</td></tr>");
});

test("hydrate keeps SSR unsafe() markup", async () => {
  const App = () => <div>{unsafe(RAW)}</div>;
  const html = await renderToString(App);
  const el = document.createElement("div");
  el.append(
    ...new DOMParser().parseFromString(html, "text/html").body.childNodes
  );
  document.body.append(el);
  const found = el.querySelector("[data-ilha]");
  // SAFETY: hydrate host is either the island root or the wrapper we created.
  const host = (found ?? el) as Element;
  const unmount = mount(host, App, { hydrate: true });
  await Bun.sleep(15);
  expect(host.querySelector("strong.hi")?.textContent).toBe("Hi");
  unmount();
  el.remove();
});
