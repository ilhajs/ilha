// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";
import type { AtomHandle, View } from "../src/index.ts";

let tick: AtomHandle<number> | undefined;
let submits = 0;
let clicks = 0;

const FormBox = ({ children }: { children?: View }) => {
  const busy = atom(false);
  return (
    <form
      class="box"
      aria-busy={String(busy())}
      onsubmit={(event: SubmitEvent) => {
        event.preventDefault();
        submits += 1;
      }}
    >
      <button type="submit" class="go" onclick={() => (clicks += 1)}>
        go
      </button>
      {children}
    </form>
  );
};

const Page = () => {
  const n = atom(0);
  tick = n;
  return (
    <main>
      <p>{n()}</p>
      <FormBox>
        <span>inside</span>
      </FormBox>
    </main>
  );
};

const submit = (form: Element): boolean => {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event.defaultPrevented;
};

test("handlers inside a nested component survive hydration and rerenders", async () => {
  const html = await renderToString(Page);
  const wrapper = document.createElement("div");
  wrapper.append(
    ...new DOMParser().parseFromString(html, "text/html").body.childNodes
  );
  document.body.append(wrapper);
  const host = wrapper.querySelector("[data-ilha]");
  if (!host) {
    throw new Error("host missing");
  }
  submits = 0;
  clicks = 0;
  mount(host, Page, { hydrate: true });
  await Bun.sleep(15);
  const form = (): Element => {
    const found = host.querySelector("form.box");
    if (!found) {
      throw new Error("form missing");
    }
    return found;
  };
  expect(submit(form())).toBe(true);
  expect(submits).toBe(1);

  tick?.set(1);
  await Bun.sleep(15);
  expect(host.querySelector("p")?.textContent).toBe("1");
  expect(submit(form())).toBe(true);
  expect(submits).toBe(2);
  host.querySelector<HTMLElement>("button.go")?.click();
  expect(clicks).toBe(1);
  wrapper.remove();
});
