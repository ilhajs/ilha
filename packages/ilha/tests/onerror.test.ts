import { expect, spyOn, test } from "bun:test";

import { ErrorBoundary, h, mount } from "../src/index.ts";

const App = () => {
  throw new Error("nope");
};

test("mount onError receives the failure as an Error", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const seen: Error[] = [];
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App, { onError: (e) => seen.push(e) });
  await Bun.sleep(10);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toBeInstanceOf(Error);
  expect(seen[0]?.message).toBe("nope");
  logged.mockRestore();
  el.remove();
});

const Boom = async () => {
  await Promise.resolve();
  throw new Error("nested");
};

const Page = () => ({
  $$ilha: 1 as const,
  children: [Boom],
  props: {},
  type: "div",
});

test("mount onError receives a nested failure no boundary caught", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const seen: Error[] = [];
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, Page, { onError: (e) => seen.push(e) });
  await Bun.sleep(15);
  expect(seen.map((e) => e.message)).toEqual(["nested"]);
  expect(el.querySelector("[data-ilha-error]")?.textContent).toContain(
    "nested"
  );
  logged.mockRestore();
  el.remove();
});

test("an ErrorBoundary keeps a nested failure away from mount onError", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const seen: Error[] = [];
  const caught: Error[] = [];
  const Guarded = () =>
    h(ErrorBoundary, { onError: (e: Error) => caught.push(e) }, Boom);
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, Guarded, { onError: (e) => seen.push(e) });
  await Bun.sleep(15);
  expect(caught.map((e) => e.message)).toEqual(["nested"]);
  expect(seen).toEqual([]);
  logged.mockRestore();
  el.remove();
});
