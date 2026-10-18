// @jsxImportSource ../src
import { expect, spyOn, test } from "bun:test";

import * as Atom from "effect/reactivity/Atom";

import {
  atom,
  context,
  createContext,
  Fragment,
  mount,
  renderToString,
} from "../src/index.ts";
import type { Component } from "../src/index.ts";

const mapAtom = Atom.map;

const settle = () => Bun.sleep(15);

/** Parse SSR output into a live host, the way a browser would. */
const serverHost = (html: string) => {
  const wrapper = document.createElement("div");
  wrapper.append(
    ...new DOMParser().parseFromString(html, "text/html").body.childNodes
  );
  document.body.append(wrapper);
  const host = wrapper.querySelector("[data-ilha]");
  if (!host) {
    throw new Error("host missing");
  }
  return { host, wrapper };
};

const hydrated = async (C: Component, html?: string) => {
  const { host, wrapper } = serverHost(html ?? (await renderToString(C)));
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  mount(host, C, { hydrate: true });
  await settle();
  const warnings = warn.mock.calls.length;
  warn.mockRestore();
  return { host, warnings, wrapper };
};

const Mixed = () => {
  const a = atom(Atom.make("shared"));
  const b = atom(7);
  return (
    <p>
      {a()}:{b()}
    </p>
  );
};

test("snapshot stays aligned when a derived atom precedes a plain atom", async () => {
  const html = await renderToString(Mixed);
  expect(html).toContain("shared:7");
  const { host, wrapper } = await hydrated(Mixed, html);
  expect(host.textContent).toBe("shared:7");
  wrapper.remove();
});

const Derived = () => {
  const base = atom(2);
  const doubled = atom(mapAtom(base.atom, (n: number) => n * 2));
  const label = atom("x");
  return (
    <p>
      {base()}:{doubled()}:{label()}
    </p>
  );
};

test("derived atoms are recomputed, not seeded from the snapshot", async () => {
  const html = await renderToString(Derived);
  const { host, wrapper } = serverHost(html);
  expect(host.textContent).toBe("2:4:x");
  // Tamper with the derived slot's position: only plain slots (base, label) exist.
  host.dataset.ilhaState = JSON.stringify({ v: [5, "y"] });
  mount(host, Derived, { hydrate: true });
  await settle();
  expect(host.textContent).toBe("5:10:y");
  wrapper.remove();
});

const Theme = createContext({ secret: "top-secret" });

const Reader = () => <b>{context(Theme)().secret}</b>;

const Provided = () => {
  const n = atom(3);
  return (
    <section>
      <Theme.Provider value={{ secret: "from-props" }}>
        <Reader />
      </Theme.Provider>
      <i>{n()}</i>
    </section>
  );
};

test("context provider values stay out of the snapshot", async () => {
  const html = await renderToString(Provided);
  expect(html).not.toContain("from-props&quot;");
  expect(html).toContain("data-ilha-state");
  const state =
    /data-ilha-state="(?<state>[^"]*)"/u.exec(html)?.groups?.state ?? "";
  expect(state).not.toContain("from-props");
  const { host, wrapper } = await hydrated(Provided, html);
  expect(host.querySelector("b")?.textContent).toBe("from-props");
  expect(host.querySelector("i")?.textContent).toBe("3");
  wrapper.remove();
});

const Raw = () => {
  const timer = atom.lazy(() => ({ id: 42 }), { snapshot: false });
  const n = atom(5);
  return (
    <p>
      {timer().id}:{n()}
    </p>
  );
};

test("snapshot: false keeps lazy refs out of the snapshot (SSR)", async () => {
  const html = await renderToString(Raw);
  const state =
    /data-ilha-state="(?<state>[^"]*)"/u.exec(html)?.groups?.state ?? "";
  expect(state).not.toContain("42");
  expect(state).toContain("5");
});

test("snapshot: false slots restart on hydration and keep later slots aligned", async () => {
  const { host, wrapper } = serverHost(await renderToString(Raw));
  host.dataset.ilhaState = JSON.stringify({ v: [9] });
  mount(host, Raw, { hydrate: true });
  await settle();
  expect(host.textContent).toBe("42:9");
  wrapper.remove();
});

const Counter = () => {
  const n = atom(1);
  return <button onclick={() => n.update((x: number) => x + 1)}>{n()}</button>;
};

const ComponentRoot = () => <Counter />;

test("component roots hydrate without a mismatch warning", async () => {
  const { host, warnings, wrapper } = await hydrated(ComponentRoot);
  expect(warnings).toBe(0);
  host.querySelector("button")?.click();
  await settle();
  expect(host.querySelector("button")?.textContent).toBe("2");
  wrapper.remove();
});

const FragmentRoot = () => (
  <Fragment>
    <h2>title</h2>
    <Counter />
  </Fragment>
);

test("fragment roots hydrate and keep the server nodes", async () => {
  const { host, wrapper } = serverHost(await renderToString(FragmentRoot));
  const heading = host.querySelector("h2");
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  mount(host, FragmentRoot, { hydrate: true });
  await settle();
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
  expect(host.querySelector("h2")).toBe(heading);
  host.querySelector("button")?.click();
  await settle();
  expect(host.querySelector("button")?.textContent).toBe("2");
  wrapper.remove();
});

const Form = () => {
  const n = atom(0);
  return (
    <form>
      <input name="q" />
      <button type="button" onclick={() => n.update((x: number) => x + 1)}>
        {n()}
      </button>
    </form>
  );
};

test("hydration keeps what was typed before the island woke", async () => {
  const { host, wrapper } = serverHost(await renderToString(Form));
  const input = host.querySelector("input");
  if (!input) {
    throw new Error("input missing");
  }
  input.value = "typed early";
  input.focus();
  mount(host, Form, { hydrate: true });
  await settle();
  expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("typed early");
  host.querySelector("button")?.click();
  await settle();
  expect(host.querySelector("button")?.textContent).toBe("1");
  expect(input.value).toBe("typed early");
  wrapper.remove();
});
