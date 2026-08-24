import { Button, Input, LinkButton, Radio, Switch } from "areia";
import { ilha } from "ilha";

import { URLS } from "@/lib/landing-const";

const TEMPLATES = [
  { value: "vite-spa", label: "Vite SPA", icon: "/vite.svg", sandbox: true },
  { value: "oxide-spa", label: "Oxide SPA", icon: "/oxide.svg", sandbox: true },
] as const;

export const ProjectCreatorForm = ilha
  .state("name", "")
  .state("template", "vite-spa")
  .state("useBun", false)
  .derived("createCommand", ({ state }) => {
    const packageManager = state.useBun() ? "bunx" : "npx";
    const projectName = state.name() ? ` ${state.name()}` : "";
    return `${packageManager} giget@latest gh:ilhajs/ilha/templates/${state.template()}${projectName}`;
  })
  .derived("sandboxUrl", ({ state }) => {
    return URLS.SANDBOX.replace("{template}", state.template());
  })
  .derived("hasSandbox", ({ state }) => {
    return TEMPLATES.find((template) => template.value === state.template())?.sandbox ?? true;
  })
  .action("copyCommand", async (event: MouseEvent, { derived }) => {
    try {
      await navigator.clipboard.writeText(derived.createCommand()!);
    } catch {
      // Clipboard can be denied without a user gesture; leave the label as-is.
      return;
    }
    const el = (event.currentTarget as HTMLElement | null)?.querySelector("span");
    if (el) {
      const original = el.textContent;
      el.textContent = "Copied!";
      setTimeout(() => {
        el.textContent = original;
      }, 2000);
    }
  })
  .effect(({ derived, host }) => {
    const commandSpan = host.querySelector<HTMLElement>("[data-copy-command] span");
    if (commandSpan && commandSpan.textContent !== "Copied!") {
      commandSpan.textContent = derived.createCommand()!;
    }

    const sandboxLink = host.querySelector<HTMLAnchorElement>("[data-sandbox-link]");
    if (sandboxLink) {
      if (derived.hasSandbox()) {
        sandboxLink.href = derived.sandboxUrl()!;
        sandboxLink.classList.remove("hidden");
      } else {
        sandboxLink.classList.add("hidden");
      }
    }
  })
  .render(({ state, derived, action }) => (
    <div class="flex flex-col gap-4">
      <Input
        id="project-name"
        label="Project name"
        name="name"
        placeholder="my-app"
        bind:value={state.name}
      />
      <Radio.Group
        legend="Pick a template"
        name="template"
        appearance="card"
        orientation="horizontal"
        class="[&>div]:lg:grid-cols-2"
      >
        {TEMPLATES.map((template) => (
          <Radio.Item
            label={
              <span class="flex items-center gap-2">
                <img src={template.icon} class="size-6" alt="" />
                <span>{template.label}</span>
              </span>
            }
            value={template.value}
            name="template"
            appearance="card"
            bind:group={state.template}
          />
        ))}
      </Radio.Group>
      <Switch label="Use Bun" name="useBun" bind:checked={state.useBun} />
      <div class="grid min-w-0 gap-2 sm:flex sm:items-center">
        <Button
          variant="outline"
          class="w-full min-w-0 flex-1 justify-start overflow-hidden text-left"
          data-copy-command
          onclick={action.copyCommand}
        >
          <img src="/copy.svg" class="size-5 shrink-0" alt="" />
          <span class="block truncate">{derived.createCommand()}</span>
        </Button>
        <LinkButton
          href={derived.sandboxUrl()}
          target="_blank"
          rel="noopener noreferrer"
          variant="primary"
          external
          class={`w-full justify-center sm:w-auto sm:justify-center ${derived.hasSandbox() ? "" : "hidden"}`}
          data-sandbox-link
        >
          <img src="/stackblitz.svg" class="size-4" alt="" />
          <span>Open Sandbox</span>
        </LinkButton>
      </div>
    </div>
  ));
