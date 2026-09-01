/** @jsxImportSource ../src */
import { expect, test } from "bun:test";

import * as Atom from "effect/unstable/reactivity/Atom";
import { atom, mount } from "ilha";

function ProjectCreatorLike() {
  const name = atom("");
  const template = atom<"vite-spa" | "oxide-spa">("vite-spa");
  const useBun = atom(false);
  const createCommand = atom(
    Atom.transform(template.atom, (get, templateAtom) => {
      const packageManager = get(useBun.atom) ? "bunx" : "npx";
      const projectName = get(name.atom) ? ` ${get(name.atom)}` : "";
      return `${packageManager} giget@latest gh:ilhajs/ilha/templates/${get(templateAtom)}${projectName}`;
    }),
  );

  return (
    <div>
      <input
        data-name
        value={name}
        oninput={(e: Event) => name.set((e.currentTarget as HTMLInputElement).value)}
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
      <label data-oxide-label>
        <input
          type="radio"
          name="template"
          value="oxide-spa"
          checked={template() === "oxide-spa"}
          onchange={() => template.set("oxide-spa")}
        />
        oxide
      </label>
      <button data-bun type="button" onclick={() => useBun.set(true)}>
        bun
      </button>
      <span data-cmd>{createCommand}</span>
    </div>
  );
}

test("derived command survives repeated template toggles", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ProjectCreatorLike);
  await Bun.sleep(10);

  const cmd = () => el.querySelector("[data-cmd]")?.textContent ?? "";

  expect(cmd()).toContain("vite-spa");

  for (let i = 0; i < 5; i++) {
    el.querySelector<HTMLLabelElement>("[data-oxide-label]")!.click();
    await Bun.sleep(5);
    expect(cmd()).toContain("oxide-spa");
    el.querySelector<HTMLLabelElement>("[data-vite-label]")!.click();
    await Bun.sleep(5);
    expect(cmd()).toContain("vite-spa");
  }

  el.querySelector<HTMLButtonElement>("[data-bun]")!.click();
  await Bun.sleep(5);
  expect(cmd()).toMatch(/^bunx /);

  el.querySelector<HTMLInputElement>("[data-name]")!.value = "my-app";
  el.querySelector<HTMLInputElement>("[data-name]")!.dispatchEvent(
    new Event("input", { bubbles: true }),
  );
  await Bun.sleep(5);
  expect(cmd()).toContain(" my-app");

  unmount();
  el.remove();
});
