// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";

const ResetApp = () => {
  const text = atom("hello");
  return (
    <div>
      <input id="controlled" value={text()} />
      <button id="reset" type="button" onclick={() => text.set("reset!")}>
        reset
      </button>
    </div>
  );
};

test("controlled input resets to the rendered value", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ResetApp);
  await Bun.sleep(10);

  const input = el.querySelector("#controlled");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("input missing");
  }
  expect(input.value).toBe("hello");
  // User edit lands in the live property only.
  input.value = "user edit";
  el.querySelector("#reset")?.click();
  await Bun.sleep(10);

  expect(input.value).toBe("reset!");
  unmount();
  el.remove();
});

const ShiftApp = () => {
  const show = atom(false);
  return (
    <div>
      {show() ? <p id="extra">extra</p> : null}
      <input id="below" placeholder="type here" />
      <button
        id="toggle"
        type="button"
        onclick={() => show.update((v: boolean) => !v)}
      >
        toggle
      </button>
    </div>
  );
};

test("conditional above an input does not shift the morph", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ShiftApp);
  await Bun.sleep(10);

  const input = el.querySelector("#below");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("input missing");
  }
  input.value = "typed";
  el.querySelector("#toggle")?.click();
  await Bun.sleep(10);

  expect(el.querySelector("#extra")?.textContent).toBe("extra");
  // The skipped branch leaves a placeholder, so the input keeps its node.
  expect(el.querySelector("#below")).toBe(input);
  expect(input.value).toBe("typed");

  el.querySelector("#toggle")?.click();
  await Bun.sleep(10);
  expect(el.querySelector("#extra")).toBeNull();
  expect(el.querySelector("#below")).toBe(input);
  expect(input.value).toBe("typed");
  unmount();
  el.remove();
});

const HydResetApp = () => {
  const text = atom("hello");
  return (
    <div>
      <input id="hyd-controlled" value={text()} />
      <button id="hyd-reset" type="button" onclick={() => text.set("reset!")}>
        reset
      </button>
    </div>
  );
};

test("controlled reset works after hydration", async () => {
  const html = await renderToString(HydResetApp);
  expect(html).toContain('value="hello"');

  const el = document.createElement("div");
  document.body.append(el);
  el.innerHTML = html;
  const unmount = mount(el, HydResetApp, { hydrate: true });
  await Bun.sleep(10);

  const input = el.querySelector("#hyd-controlled");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("input missing");
  }
  input.value = "user edit";
  el.querySelector("#hyd-reset")?.click();
  await Bun.sleep(10);

  expect(input.value).toBe("reset!");
  unmount();
  el.remove();
});

const mountApp = async (App: () => JSX.Element, html?: string) => {
  const el = document.createElement("div");
  document.body.append(el);
  if (html !== undefined) {
    el.innerHTML = html;
  }
  const unmount = mount(el, App, { hydrate: html !== undefined });
  await Bun.sleep(10);
  const click = async (id: string) => {
    el.querySelector<HTMLButtonElement>(`#${id}`)?.click();
    await Bun.sleep(10);
  };
  const done = () => {
    unmount();
    el.remove();
  };
  return { click, done, el };
};

const field = <T extends Element>(root: Element, selector: string): T => {
  const node = root.querySelector(selector);
  if (!node) {
    throw new Error(`${selector} missing`);
  }
  // SAFETY: each test passes the selector of the element type it expects.
  return node as T;
};

const OptionSelectedApp = () => {
  const tick = atom(0);
  return (
    <div data-tick={tick()}>
      <select id="single">
        <option value="a" selected={true}>
          a
        </option>
        <option value="b" selected={false}>
          b
        </option>
      </select>
      <select id="multi" multiple>
        <option value="a" selected={true}>
          a
        </option>
        <option value="b" selected={false}>
          b
        </option>
      </select>
      <button
        id="tick"
        type="button"
        onclick={() => tick.update((n: number) => n + 1)}
      >
        tick
      </button>
    </div>
  );
};

test("controlled option selected={false} undoes a user pick", async () => {
  const { click, done, el } = await mountApp(OptionSelectedApp);
  const single = field<HTMLSelectElement>(el, "#single");
  const multi = field<HTMLSelectElement>(el, "#multi");
  single.value = "b";
  multi.options[1].selected = true;
  await click("tick");

  expect(single.value).toBe("a");
  expect([...multi.options].map((o) => o.selected)).toEqual([true, false]);
  done();
});

const SelectValueApp = () => {
  const choice = atom("b");
  const tick = atom(0);
  return (
    <div data-tick={tick()}>
      <select id="controlled" value={choice()}>
        <option value="a">a</option>
        <option value="b">b</option>
        <option value="c">c</option>
      </select>
      <select id="free">
        <option value="a">a</option>
        <option value="b">b</option>
      </select>
      <button
        id="tick"
        type="button"
        onclick={() => tick.update((n: number) => n + 1)}
      >
        tick
      </button>
      <button id="pick-c" type="button" onclick={() => choice.set("c")}>
        c
      </button>
    </div>
  );
};

test("select value={…} selects, undoes user picks and follows state", async () => {
  const { click, done, el } = await mountApp(SelectValueApp);
  const controlled = field<HTMLSelectElement>(el, "#controlled");
  const free = field<HTMLSelectElement>(el, "#free");
  expect(controlled.value).toBe("b");

  controlled.value = "a";
  free.value = "b";
  await click("tick");
  expect(controlled.value).toBe("b");
  // No value or selected props: the user's pick survives.
  expect(free.value).toBe("b");

  await click("pick-c");
  expect(controlled.value).toBe("c");
  done();
});

test("select value={…} renders the matching option selected", async () => {
  const html = await renderToString(SelectValueApp);
  expect(html).toContain('<option value="b" selected="">b</option>');
  expect(html).not.toContain('<option value="a" selected');
});

const TextareaApp = () => {
  const text = atom("hello");
  const tick = atom(0);
  return (
    <div data-tick={tick()}>
      <textarea id="controlled" value={text()} />
      <textarea id="free" />
      <button
        id="tick"
        type="button"
        onclick={() => tick.update((n: number) => n + 1)}
      >
        tick
      </button>
      <button id="clear" type="button" onclick={() => text.set("")}>
        clear
      </button>
    </div>
  );
};

test("textarea value={…} undoes user edits and follows state", async () => {
  const { click, done, el } = await mountApp(TextareaApp);
  const controlled = field<HTMLTextAreaElement>(el, "#controlled");
  const free = field<HTMLTextAreaElement>(el, "#free");
  expect(controlled.value).toBe("hello");

  controlled.value = "user edit";
  free.value = "kept";
  await click("tick");
  expect(controlled.value).toBe("hello");
  expect(free.value).toBe("kept");

  controlled.value = "user edit";
  await click("clear");
  expect(controlled.value).toBe("");
  done();
});

test("textarea value={…} renders as text and hydrates", async () => {
  const html = await renderToString(TextareaApp);
  expect(html).toContain('<textarea id="controlled">hello</textarea>');

  const { click, done, el } = await mountApp(TextareaApp, html);
  const controlled = field<HTMLTextAreaElement>(el, "#controlled");
  expect(controlled.value).toBe("hello");
  controlled.value = "user edit";
  await click("tick");
  expect(controlled.value).toBe("hello");
  done();
});

const UndefinedCheckedApp = () => {
  const tick = atom(0);
  const checked: boolean | undefined = undefined;
  return (
    <div data-tick={tick()}>
      <input id="box" type="checkbox" checked={checked} />
      <button
        id="tick"
        type="button"
        onclick={() => tick.update((n: number) => n + 1)}
      >
        tick
      </button>
    </div>
  );
};

test("checked={undefined} stays uncontrolled", async () => {
  const { click, done, el } = await mountApp(UndefinedCheckedApp);
  const box = field<HTMLInputElement>(el, "#box");
  box.click();
  await click("tick");
  expect(box.checked).toBe(true);
  done();
});
