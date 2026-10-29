// @jsxImportSource ../src
import { expect, test } from "bun:test";

import * as Atom from "effect/reactivity/Atom";
import { atom, mount } from "ilha";

const ProjectCreatorLike = () => {
  const name = atom("");
  const template = atom<"vite-spa" | "void">("vite-spa");
  const useBun = atom(false);
  const createCommand = atom(
    Atom.transform(template.atom, (get, templateAtom) => {
      const packageManager = get(useBun.atom) ? "bunx" : "npx";
      const projectName = get(name.atom) ? ` ${get(name.atom)}` : "";
      return `${packageManager} giget@latest gh:ilhajs/ilha/templates/${get(templateAtom)}${projectName}`;
    })
  );

  return (
    <div>
      <input
        data-name
        value={name}
        oninput={(e: Event) => {
          const target = e.currentTarget;
          // SAFETY: oninput is bound to the painted input element.
          name.set((target as HTMLInputElement).value);
        }}
      />
      <label data-vite-label>
        <input
          type="radio"
          name="template"
          value="vite-spa"
          checked={template() === "vite-spa"}
          onchange={() => template.set("vite-spa")}
        />
        vite
      </label>
      <label data-void-label>
        <input
          type="radio"
          name="template"
          value="void"
          checked={template() === "void"}
          onchange={() => template.set("void")}
        />
        void
      </label>
      <button data-bun type="button" onclick={() => useBun.set(true)}>
        bun
      </button>
      <span data-cmd>{createCommand}</span>
    </div>
  );
};

const clickLabel = async (
  el: HTMLElement,
  selector: string,
  expectText: string
) => {
  const label = el.querySelector(selector);
  if (!(label instanceof HTMLElement)) {
    throw new TypeError(`${selector} missing`);
  }
  label.click();
  await Bun.sleep(5);
  const cmd = el.querySelector("[data-cmd]")?.textContent ?? "";
  expect(cmd).toContain(expectText);
};

const toggleRound = async (
  el: HTMLElement,
  remaining: number
): Promise<void> => {
  if (remaining <= 0) {
    return;
  }
  await clickLabel(el, "[data-void-label]", "void");
  await clickLabel(el, "[data-vite-label]", "vite-spa");
  await toggleRound(el, remaining - 1);
};

test("derived command survives repeated template toggles", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ProjectCreatorLike);
  await Bun.sleep(10);

  const cmd = () => el.querySelector("[data-cmd]")?.textContent ?? "";

  expect(cmd()).toContain("vite-spa");

  await toggleRound(el, 5);

  const bunBtn = el.querySelector("[data-bun]");
  if (!(bunBtn instanceof HTMLButtonElement)) {
    throw new TypeError("[data-bun] missing");
  }
  bunBtn.click();
  await Bun.sleep(5);
  expect(cmd()).toMatch(/^bunx /u);

  const nameInput = el.querySelector("[data-name]");
  if (!(nameInput instanceof HTMLInputElement)) {
    throw new TypeError("[data-name] missing");
  }
  nameInput.value = "my-app";
  nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  await Bun.sleep(5);
  expect(cmd()).toContain(" my-app");

  unmount();
  el.remove();
});
