import { Button, Input, LinkButton, Radio, Switch } from "areia";
import { derived, effect, ilha, state, action } from "ilha";

import { URLS } from "@/lib/landing-const";

const TEMPLATES = [
  { value: "vite-spa", label: "Vite SPA", icon: "/vite.svg", sandbox: true },
  { value: "oxide-spa", label: "Oxide SPA", icon: "/oxide.svg", sandbox: true },
] as const;

export const ProjectCreatorForm = ilha(() => {
  const name = state("");
  const template = state("vite-spa");
  const useBun = state(false);

  const createCommand = derived(() => {
    const packageManager = useBun() ? "bunx" : "npx";
    const projectName = name() ? ` ${name()}` : "";
    return `${packageManager} giget@latest gh:ilhajs/ilha/templates/${template()}${projectName}`;
  });
  const sandboxUrl = derived(() => URLS.SANDBOX.replace("{template}", template()));
  const hasSandbox = derived(() => {
    return TEMPLATES.find((candidate) => candidate.value === template())?.sandbox ?? true;
  });

  const copyCommand = action(async (event: MouseEvent) => {
    try {
      await navigator.clipboard.writeText(createCommand()!);
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
  });

  let host: Element | null = null;
  effect.once(({ host: mounted }) => {
    host = mounted;
  });

  effect(() => {
    if (!host) return;
    const commandSpan = host.querySelector<HTMLElement>("[data-copy-command] span");
    if (commandSpan && commandSpan.textContent !== "Copied!") {
      commandSpan.textContent = createCommand()!;
    }

    const sandboxLink = host.querySelector<HTMLAnchorElement>("[data-sandbox-link]");
    if (sandboxLink) {
      if (hasSandbox()) {
        sandboxLink.href = sandboxUrl()!;
        sandboxLink.classList.remove("hidden");
      } else {
        sandboxLink.classList.add("hidden");
      }
    }
  });

  return (
    <div class="flex flex-col gap-4">
      <Input
        id="project-name"
        label="Project name"
        name="name"
        placeholder="my-app"
        bind:value={name}
      />
      <Radio.Group
        legend="Pick a template"
        name="template"
        appearance="card"
        orientation="horizontal"
        class="[&>div]:lg:grid-cols-2"
      >
        {TEMPLATES.map((candidate) => (
          <Radio.Item
            label={
              <span class="flex items-center gap-2">
                <img src={candidate.icon} class="size-6" alt="" />
                <span>{candidate.label}</span>
              </span>
            }
            value={candidate.value}
            name="template"
            appearance="card"
            bind:group={template}
          />
        ))}
      </Radio.Group>
      <Switch label="Use Bun" name="useBun" bind:checked={useBun} />
      <div class="grid min-w-0 gap-2 sm:flex sm:items-center">
        <Button
          variant="outline"
          class="w-full min-w-0 flex-1 justify-start overflow-hidden text-left"
          data-copy-command
          onclick={copyCommand}
        >
          <img src="/copy.svg" class="size-5 shrink-0" alt="" />
          <span class="block truncate">{createCommand()}</span>
        </Button>
        <LinkButton
          href={sandboxUrl()}
          target="_blank"
          rel="noopener noreferrer"
          variant="primary"
          external
          class={`w-full justify-center sm:w-auto sm:justify-center ${hasSandbox() ? "" : "hidden"}`}
          data-sandbox-link
        >
          <img src="/stackblitz.svg" class="size-4" alt="" />
          <span>Open Sandbox</span>
        </LinkButton>
      </div>
    </div>
  );
});
