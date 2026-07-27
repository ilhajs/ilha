import { Button, Input, LinkButton, Radio, Switch, Tabs } from "areia";
import { toast } from "areia/sonner";
import ilha, { raw } from "ilha";

import { URLS } from "@/lib/landing-const";

const TEMPLATES = [
  { value: "vite", label: "Vite", icon: "/vite.svg", sandbox: true },
  { value: "nitro", label: "Nitro", icon: "/nitro.svg", sandbox: true },
  { value: "hono", label: "Hono", icon: "/hono.svg", sandbox: true },
  { value: "elysia", label: "Elysia", icon: "/elysia.svg", sandbox: false },
] as const;

export const ProjectCreatorForm = ilha
  .state("name", "")
  .state("template", "vite")
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
  .on("[data-action=copyCommand]@click", async ({ derived }) => {
    await navigator.clipboard.writeText(derived.createCommand()!);
    toast.success("Command copied");
  })
  .on("#project-name@input", ({ state, event }) => {
    state.name((event.target as HTMLInputElement).value);
  })
  .on("input[name=template]@change", ({ state, event }) => {
    state.template((event.target as HTMLInputElement).value);
  })
  .on("input[name=useBun]@change", ({ state, event }) => {
    state.useBun((event.target as HTMLInputElement).checked);
  })
  .effect(({ state, host }) => {
    const root = host.querySelector<HTMLElement>('[data-slot="switch"][data-name="useBun"]');
    if (!root) return;
    root.dispatchEvent(
      new CustomEvent("switch:set", { detail: { checked: state.useBun() }, bubbles: false }),
    );
  })
  .render(({ state, derived }) => (
    <div class="flex flex-col gap-4">
      <Input
        id="project-name"
        label="Project name"
        name="name"
        placeholder="my-app"
        value={state.name()}
      />
      <Radio.Group
        legend="Pick a template"
        name="template"
        appearance="card"
        orientation="horizontal"
        class="[&>div]:lg:grid-cols-4"
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
            checked={state.template() === template.value}
          />
        ))}
      </Radio.Group>
      <Switch
        label="Use Bun"
        name="useBun"
        checked={state.useBun()}
        onCheckedChange={(checked) => state.useBun(checked)}
      />
      <div class="grid min-w-0 gap-2 sm:flex sm:items-center">
        <Button
          variant="outline"
          class="w-full min-w-0 flex-1 justify-start overflow-hidden text-left"
          data-action="copyCommand"
        >
          <img src="/copy.svg" class="size-5 shrink-0" alt="" />
          <span class="block truncate">{derived.createCommand()}</span>
        </Button>
        {derived.hasSandbox() ? (
          <LinkButton
            href={derived.sandboxUrl()}
            target="_blank"
            rel="noopener noreferrer"
            variant="primary"
            external
            class="w-full justify-center sm:w-auto sm:justify-center"
          >
            <img src="/stackblitz.svg" class="size-4" alt="" />
            <span>Open Sandbox</span>
          </LinkButton>
        ) : null}
      </div>
    </div>
  ));

export const UsefulExtrasSnippets = ilha
  .input<{ routingHtml: string; storeHtml: string; astroHtml: string }>({
    routingHtml: "",
    storeHtml: "",
    astroHtml: "",
  })
  .state("tab", "routing")
  .render(({ state, input }) => (
    <div class="flex w-full flex-col gap-2">
      <Tabs variant="segmented" size="sm" class="relative w-full" bind:group={state.tab}>
        <Tabs.List>
          <Tabs.Trigger value="routing">@ilha/router</Tabs.Trigger>
          <Tabs.Trigger value="store">@ilha/store</Tabs.Trigger>
          <Tabs.Trigger value="astro">@ilha/astro</Tabs.Trigger>
        </Tabs.List>
      </Tabs>
      <div class={`text-xs leading-relaxed${state.tab() === "routing" ? "" : " hidden"}`}>
        {raw(input.routingHtml)}
      </div>
      <div class={`text-xs leading-relaxed${state.tab() === "store" ? "" : " hidden"}`}>
        {raw(input.storeHtml)}
      </div>
      <div class={`text-xs leading-relaxed${state.tab() === "astro" ? "" : " hidden"}`}>
        {raw(input.astroHtml)}
      </div>
    </div>
  ));
