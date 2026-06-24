import { landingCodeHtml } from "$lib/landing-code-html";
import {
  COUNTER_CODE,
  ILHA_ROUTER_CODE,
  ILHA_STORE_CODE,
  RENDERING_CODE,
  SIGNALS_CODE,
  URLS,
} from "$lib/landing-const";
import { Badge, Button, Input, LayerCard, LinkButton, Radio, Switch, Tabs } from "areia";
import { toast } from "areia/sonner";
import ilha, { raw } from "ilha";

const NITRO_SANDBOX = `${URLS.SANDBOX.replace("{template}", "nitro")}?file=src%2Fpages%2Findex.tsx`;

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
  // Areia Switch: slots + island re-render — see guide/island/render (Areia controls).
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

export const WHY_ILHA_TABS = [
  {
    id: "syntax",
    label: "Familiar syntax",
    title: "Build interactive UI without framework ceremony",
    description: "Keep state, validation, events, and markup together in one tiny island.",
    points: ["Svelte-like reactivity", "React-flavored templating", "No framework ceremony"],
    code: COUNTER_CODE,
  },
  {
    id: "signals",
    label: "Signals",
    title: "Fast by default, because updates are precise",
    description:
      "Signals track the data your UI actually reads, so updates stay focused and predictable.",
    points: ["Fine-grained updates", "Abortable async work", "No app-wide re-render loop"],
    code: SIGNALS_CODE,
  },
  {
    id: "rendering",
    label: "Rendering",
    title: "One island, every rendering strategy",
    description:
      "Choose the right rendering mode per island instead of committing your whole app to one strategy.",
    points: ["Static HTML", "Server-rendered hydration", "Client-only islands"],
    code: RENDERING_CODE,
  },
  {
    id: "routing",
    label: "Routing",
    title: "Start tiny, add structure when it pays off",
    description: "Start with a single import, then add structure only when the product earns it.",
    points: ["Single-file prototypes", "File-based routes", "Dynamic pages without rewrites"],
    code: ILHA_ROUTER_CODE,
  },
  {
    id: "store",
    label: "Store",
    title: "The essentials are ready when you need them",
    description:
      "Keep the core tiny, but bring in practical extras when real apps need coordination.",
    points: [
      "Shared cart and session state",
      "Cross-island coordination",
      "Zustand-shaped ergonomics",
    ],
    code: ILHA_STORE_CODE,
  },
];

export const whyIlhaCodeHtml: Record<string, string> = landingCodeHtml;

export const PRIMARY_ILHA_CARDS = WHY_ILHA_TABS.filter(
  (tab) => tab.id !== "routing" && tab.id !== "store",
);

export const USEFUL_EXTRAS_CARD = {
  label: "Useful extras",
  title: "Routing and shared state when you need them",
  description:
    "Start with a single import and add file-based routes or Zustand-shaped stores only when the product earns it.",
  points: [
    "File-based routes and dynamic pages",
    "Shared cart and session state",
    "Cross-island coordination",
  ],
};

const codePanelClass =
  "code-surface overflow-auto rounded-lg border border-areia-border text-xs [&_pre]:!m-0 [&_pre]:!p-3";

export const UsefulExtrasSnippets = ilha.state("tab", "routing").render(({ state }) => (
  <div class="flex w-full flex-col gap-4">
    <Tabs variant="segmented" size="sm" class="relative w-full" bind:group={state.tab}>
      <Tabs.List>
        <Tabs.Trigger value="routing">@ilha/router</Tabs.Trigger>
        <Tabs.Trigger value="store">@ilha/store</Tabs.Trigger>
      </Tabs.List>
    </Tabs>
    {state.tab() === "routing" ? (
      <div class={codePanelClass}>{raw(whyIlhaCodeHtml.routing ?? "")}</div>
    ) : (
      <div class={codePanelClass}>{raw(whyIlhaCodeHtml.store ?? "")}</div>
    )}
  </div>
));

const Hero = ilha.render(() => (
  <>
    <section class="border-areia-border relative min-h-96 border-b sm:min-h-120 lg:h-120">
      <img
        src="/dither-1.jpg"
        alt=""
        aria-hidden="true"
        class="absolute inset-0 z-0 h-full w-full object-cover"
      />
      <div class="relative inset-0 z-10 flex h-full flex-col items-start justify-between gap-8 lg:flex-row lg:items-stretch">
        <div class="flex flex-1 flex-col justify-center gap-4 px-4 py-16 sm:px-8 sm:py-32 lg:px-16">
          <Badge variant="beta">Beta is live</Badge>
          <h1 class="text-2xl leading-normal font-semibold text-balance text-neutral-950 sm:text-3xl lg:text-4xl dark:text-neutral-950">
            The most versatile web UI library.
          </h1>
          <div class="grid w-full gap-2 sm:flex sm:w-auto">
            <LinkButton
              href="/guide/getting-started/introduction"
              variant="primary"
              size="lg"
              class="w-full justify-center sm:w-auto lg:h-12 lg:text-lg"
            >
              Get Started
            </LinkButton>
            <LinkButton
              href={NITRO_SANDBOX}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              size="lg"
              external
              class="w-full justify-center sm:w-auto lg:h-12 lg:text-lg"
            >
              <img src="/stackblitz.svg" alt="StackBlitz" class="size-4" />
              <span>Open Sandbox</span>
            </LinkButton>
          </div>
        </div>
      </div>
    </section>
    <section class="mt-8 sm:mt-12">
      <p class="px-4 text-lg leading-normal text-balance sm:px-8 sm:text-xl lg:text-3xl">
        Ilha is a tiny island architecture library that renders to{" "}
        <b class="text-areia-primary">plain HTML on the server</b> and hydrates on the client with
        zero flicker. The core is <b class="text-areia-primary">under 2,500 lines of code</b> —
        small enough to paste into any AI prompt. And when you need more, the extras are included:
        routing, typed forms, and shared state management.
      </p>
    </section>
  </>
));

export const IlhaMarketingFooter = ilha.render(() => (
  <footer class="mt-12 px-4 py-12 sm:mt-20 sm:px-8 sm:py-16">
    <h2 class="sr-only">Footer</h2>
    <div class="text-areia-subtle grid gap-8 text-sm sm:grid-cols-2 md:grid-cols-4 md:items-start">
      <nav aria-label="Open source">
        <h3 class="text-areia-default font-semibold">Open Source</h3>
        <div class="mt-4 grid justify-items-start gap-2">
          <a
            href={URLS.GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-areia-default transition"
          >
            Ilha
          </a>
          <a
            href={URLS.AREIA}
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-areia-default transition"
          >
            Areia
          </a>
        </div>
      </nav>
      <nav aria-label="Legals">
        <h3 class="text-areia-default font-semibold">Legals</h3>
        <div class="mt-4 grid justify-items-start gap-2">
          <a href="#" class="hover:text-areia-default transition">
            Terms of Service
          </a>
          <a href="#" class="hover:text-areia-default transition">
            Privacy Policy
          </a>
        </div>
      </nav>
      <div class="hidden md:block"></div>
      <nav aria-label="Socials" class="sm:col-span-2 md:col-span-1 md:justify-self-end">
        <h3 class="text-areia-default font-semibold">Socials</h3>
        <div class="mt-4 grid justify-items-start gap-2">
          <a
            href={URLS.DISCORD}
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-areia-default transition"
          >
            Discord
          </a>
          <a
            href={URLS.X_COM}
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-areia-default transition"
          >
            X.com
          </a>
        </div>
      </nav>
    </div>
    <div class="border-areia-border text-areia-subtle mt-12 border-t pt-8 text-sm">
      © {new Date().getFullYear()} Ilha. All rights reserved.
    </div>
  </footer>
));
