// @jsxImportSource ../src
import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { atom } from "../src/index.ts";
import { render, renderHtml } from "../src/test.ts";

const Counter = () => {
  const count = atom(0);
  return (
    <button type="button" onclick={() => count.update((n: number) => n + 1)}>
      {count}
    </button>
  );
};

const Field = () => {
  const name = atom("");
  const checked = atom(false);
  return (
    <form
      onsubmit={(event: Event) => {
        event.preventDefault();
        name.set(`${name()}!`);
      }}
    >
      <input
        value={name()}
        oninput={(event: Event) => {
          if (event.target instanceof HTMLInputElement) {
            name.set(event.target.value);
          }
        }}
      />
      <input
        type="checkbox"
        checked={checked()}
        onchange={(event: Event) => {
          if (event.target instanceof HTMLInputElement) {
            checked.set(event.target.checked);
          }
        }}
      />
      <output>{name()}</output>
      <mark>{checked() ? "on" : "off"}</mark>
    </form>
  );
};

const Delayed = function* Delayed() {
  yield Effect.sleep(10);
  yield <p>ready</p>;
};

const AsyncGreeting = async () => {
  await Promise.resolve();
  return <p>hello</p>;
};

test("renderHtml output is byte-identical across runs", async () => {
  const first = await renderHtml(Counter);
  const second = await renderHtml(Counter);
  expect(first).toBe(second);
  expect(first).toContain("data-ilha");
});

test("click settles before it resolves", async () => {
  const ui = render(Counter);
  await ui.settled();
  expect(ui.text()).toBe("0");
  await ui.click("button");
  expect(ui.text()).toBe("1");
  await ui.click("button");
  await ui.click("button");
  expect(ui.text()).toBe("3");
  ui.unmount();
});

test("input, change, and submit settle", async () => {
  const ui = render(Field);
  await ui.input("input", "ilha");
  expect(ui.query("output")?.textContent).toBe("ilha");
  await ui.change("input[type=checkbox]", true);
  expect(ui.query("mark")?.textContent).toBe("on");
  await ui.submit("form");
  expect(ui.query("output")?.textContent).toBe("ilha!");
  ui.unmount();
});

test("settled resolves immediately when idle", async () => {
  const ui = render(Counter);
  await ui.settled();
  await ui.settled();
  expect(ui.query("button")).not.toBeNull();
  ui.unmount();
});

test("async components settle without timers", async () => {
  const delayed = render(Delayed);
  expect(delayed.text()).toBe("");
  await delayed.settled();
  expect(delayed.text()).toBe("ready");
  delayed.unmount();

  const promised = render(AsyncGreeting);
  await promised.settled();
  expect(promised.text()).toBe("hello");
  promised.unmount();
});

test("hydrate keeps the server nodes and stays interactive", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = await renderHtml(Counter);
  const serverButton = container.querySelector("button");
  expect(serverButton).not.toBeNull();

  const ui = render(Counter, { container, hydrate: true });
  await ui.settled();
  expect(ui.query("button")).toBe(serverButton);
  await ui.click("button");
  expect(ui.query("button")).toBe(serverButton);
  expect(ui.text()).toBe("1");
  ui.unmount();
  container.remove();
});

test("ssr: true renders on the server, then hydrates", async () => {
  const ui = render(Counter, { ssr: true });
  expect(() => ui.html()).toThrow("settled");
  await ui.settled();
  expect(ui.html()).toContain("data-ilha");
  await ui.click("button");
  expect(ui.text()).toBe("1");
  ui.unmount();
});

test("ssr: true with hydrate: false leaves static server HTML", async () => {
  const ui = render(Counter, { hydrate: false, ssr: true });
  await ui.settled();
  const button = ui.query<HTMLButtonElement>("button");
  expect(button?.textContent).toBe("0");
  button?.click();
  await ui.settled();
  expect(ui.text()).toBe("0");
  ui.unmount();
});

test("a missing selector throws with the current HTML", async () => {
  const ui = render(Counter);
  let message = "";
  try {
    await ui.click("#nope");
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  expect(message).toContain('no element matches "#nope"');
  expect(message).toContain("<button");
  ui.unmount();
});

test("query and queryAll read the container", async () => {
  const ui = render(Field);
  await ui.settled();
  expect(ui.queryAll("input")).toHaveLength(2);
  expect(ui.query<HTMLInputElement>("input")?.value).toBe("");
  ui.unmount();
});

test("unmount removes the container the harness created", async () => {
  const ui = render(Counter);
  await ui.settled();
  const before = document.body.children.length;
  ui.unmount();
  ui.unmount();
  expect(document.body.children.length).toBe(before - 1);
});

test("tree and atoms report live state as JSON", async () => {
  const ui = render(Counter);
  await ui.click("button");
  await ui.click("button");
  expect(ui.atoms()).toEqual([{ component: "Counter", index: 0, value: 2 }]);
  const [root] = ui.tree();
  expect(root?.component).toBe("Counter");
  expect(structuredClone(ui.tree())).toEqual(ui.tree());
  ui.unmount();
});

test("tree works after hydration", async () => {
  const ui = render(Counter, { ssr: true });
  await ui.click("button");
  expect(ui.atoms()).toEqual([{ component: "Counter", index: 0, value: 1 }]);
  ui.unmount();
});

const Broken = () => {
  throw new Error("boom");
};

test("errors collects uncaught component failures", async () => {
  const ui = render(Broken);
  await ui.settled();
  expect(ui.errors.map((error) => error.message)).toEqual(["boom"]);
  ui.unmount();
});
