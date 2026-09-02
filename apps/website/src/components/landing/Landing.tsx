import { atom } from "ilha";

import { URLS } from "@/lib/landing-const";

const TEMPLATES = [
  { value: "vite-spa", label: "Vite SPA", icon: "/vite.svg", sandbox: true },
  { value: "oxide-spa", label: "Oxide SPA", icon: "/oxide.svg", sandbox: true },
] as const;

export function ProjectCreatorForm() {
  const name = atom("");
  const template = atom<(typeof TEMPLATES)[number]["value"]>("vite-spa");
  const useBun = atom(false);

  const command = () => {
    const packageManager = useBun() ? "bunx" : "npx";
    const projectName = name() ? ` ${name()}` : "";
    return `${packageManager} giget@latest gh:ilhajs/ilha/templates/${template()}${projectName}`;
  };

  const sandboxUrl = () => URLS.SANDBOX.replace("{template}", template());

  const hasSandbox = () =>
    TEMPLATES.find((candidate) => candidate.value === template())?.sandbox ?? true;

  const copyCommand = async (event: MouseEvent) => {
    try {
      await navigator.clipboard.writeText(command());
    } catch {
      return;
    }
    const el = (event.currentTarget as HTMLButtonElement).querySelector("span");
    if (el) {
      const original = el.textContent;
      el.textContent = "Copied!";
      setTimeout(() => {
        el.textContent = original;
      }, 2000);
    }
  };

  return (
    <div class="flex flex-col gap-4">
      <label class="form-control w-full">
        <span class="label-text mb-1">Project name</span>
        <input
          id="project-name"
          name="name"
          class="input input-bordered w-full"
          placeholder="my-app"
          value={name}
          oninput={(event) => name.set(event.currentTarget.value)}
        />
      </label>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Pick a template</legend>
        <div class="grid gap-2 lg:grid-cols-2">
          {TEMPLATES.map((candidate) => (
            <label class="label rounded-box border-base-300 cursor-pointer justify-start gap-2 border p-3">
              <input
                type="radio"
                class="radio"
                name="template"
                value={candidate.value}
                checked={template() === candidate.value}
                onchange={() => template.set(candidate.value)}
              />
              <img src={candidate.icon} class="size-6" alt="" />
              <span>{candidate.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label class="label cursor-pointer justify-start gap-2">
        <input
          type="checkbox"
          class="toggle"
          name="useBun"
          checked={useBun()}
          onchange={(event) => useBun.set(event.currentTarget.checked)}
        />
        <span>Use Bun</span>
      </label>
      <div class="grid min-w-0 gap-2 sm:flex sm:items-center">
        <button
          type="button"
          class="btn btn-outline w-full min-w-0 flex-1 justify-start overflow-hidden text-left"
          data-copy-command
          onclick={copyCommand}
        >
          <img src="/copy.svg" class="size-5 shrink-0" alt="" />
          <span class="block truncate">{command()}</span>
        </button>
        <a
          href={sandboxUrl()}
          target="_blank"
          rel="noopener noreferrer"
          class={`btn btn-primary w-full justify-center sm:w-auto ${hasSandbox() ? "" : "hidden"}`}
          data-sandbox-link
        >
          <img src="/stackblitz.svg" class="size-4" alt="" />
          <span>Open Sandbox</span>
        </a>
      </div>
    </div>
  );
}
