/** @jsxImportSource ilha */

import {
  COUNTER_CODE,
  ILHA_ROUTER_CODE,
  ILHA_STORE_CODE,
  RENDERING_CODE,
  SIGNALS_CODE,
  URLS,
} from "$src/const";
import { Badge, Button, Input, LayerCard, LinkButton, Radio, Switch, Tabs, Toaster } from "areia";
import ilha, { raw } from "ilha";
import { createHighlighter } from "shiki/bundle/web";
import { toast } from "sonner";

const NITRO_SANDBOX = `${URLS.SANDBOX.replace("{template}", "nitro")}?file=src%2Fpages%2Findex.ts`;

const TEMPLATES = [
  { value: "vite", label: "Vite", icon: "/vite.svg", sandbox: true },
  { value: "nitro", label: "Nitro", icon: "/nitro.svg", sandbox: true },
  { value: "hono", label: "Hono", icon: "/hono.svg", sandbox: true },
  { value: "elysia", label: "Elysia", icon: "/elysia.svg", sandbox: false },
] as const;

const highlighter = await createHighlighter({
  themes: ["night-owl-light", "night-owl"],
  langs: ["tsx"],
});

function highlightCode(code: string): string {
  return highlighter.codeToHtml(code, {
    lang: "tsx",
    themes: { light: "night-owl-light", dark: "night-owl" },
  });
}

const Creator = ilha
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
    await navigator.clipboard.writeText(derived.createCommand.value!);
    toast.success("Command copied");
  })
  .render(({ state, derived }) => (
    <section class="border-areia-border relative overflow-hidden border-t border-b">
      <img
        src="/dither-3.jpg"
        class="min-h-[34rem] w-full object-cover sm:h-160 sm:min-h-180"
        alt=""
      />
      <div class="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto p-4 sm:p-6">
        <LayerCard class="border-areia-border bg-areia-surface/90 flex max-h-[calc(100dvh-2rem)] w-full max-w-180 flex-col gap-4 overflow-y-auto rounded-none border p-4 shadow-xl ring-0 backdrop-blur-lg sm:max-h-none sm:overflow-visible sm:p-6">
          <h2 class="text-areia-default text-lg font-semibold">Start a new Ilha project</h2>
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
                bind:group={state.template}
              />
            ))}
          </Radio.Group>
          <Switch label="Use Bun" name="useBun" bind:checked={state.useBun} />
          <div class="grid min-w-0 gap-2 sm:flex sm:items-center">
            <Button
              variant="outline"
              class="w-full min-w-0 flex-1 justify-start overflow-hidden text-left"
              data-action="copyCommand"
            >
              <img src="/copy.svg" class="size-5 shrink-0" alt="" />
              <span class="block truncate">{derived.createCommand.value}</span>
            </Button>
            {derived.hasSandbox.value ? (
              <LinkButton
                href={derived.sandboxUrl.value}
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
        </LayerCard>
      </div>
    </section>
  ));

const FEATURE_CARDS = [
  {
    icon: "/code.svg",
    title: "Fully open-source.",
    description: "Every line is free. No paywalls, no hidden tiers.",
  },
  {
    icon: "/thumb.svg",
    title: "No build step. No virtual DOM.",
    description: "Runs from a single import — no transform, no toolchain to wrestle with.",
  },
  {
    icon: "/link.svg",
    title: "Works with any backend.",
    description: "TypeScript, PHP, Ruby, Elixir, Rust, Go — Ilha fits your stack regardless.",
  },
];

const WHY_ILHA_TABS = [
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

function getWhyIlhaTab(id: string) {
  return WHY_ILHA_TABS.find((item) => item.id === id) ?? WHY_ILHA_TABS[0];
}

const whyIlhaTab = ilha.signal(WHY_ILHA_TABS[0].id);

const WhyIlhaTabBar = ilha.render(() => (
  <Tabs
    variant="segmented"
    class="border-areia-border w-full border-b"
    listClass="w-full overflow-x-auto"
    bind:group={whyIlhaTab}
    tabs={WHY_ILHA_TABS.map((tab) => ({
      value: tab.id,
      label: tab.label,
    }))}
  />
));

const WhyIlhaContent = ilha
  .derived("code", () => highlightCode(getWhyIlhaTab(whyIlhaTab()).code))
  .render(({ derived }) => {
    const tab = getWhyIlhaTab(whyIlhaTab());

    return (
      <div class="grid lg:grid-cols-2 lg:items-start">
        <div class="p-4 sm:p-6 lg:p-8">
          <h2 class="text-areia-default text-xl font-semibold sm:text-2xl lg:text-3xl">
            {tab.title}
          </h2>
          <p class="text-areia-subtle mt-3 text-sm lg:text-[1rem]">{tab.description}</p>
          <ul class="mt-6 grid gap-3 text-sm lg:text-[1rem]">
            {tab.points.map((point) => (
              <li class="flex items-center gap-3">
                <span class="bg-areia-primary size-1.5"></span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <div class="code-surface border-areia-border h-72 overflow-auto border-t text-xs sm:h-96 sm:text-sm lg:h-128 lg:border-t-0 lg:border-l lg:text-[1rem]">
          {raw(derived.code.value ?? "")}
        </div>
      </div>
    );
  });

const WhyIlha = ilha.render(() => (
  <section class="border-areia-border mt-8 border-t border-b sm:mt-12">
    <div class="grid grid-cols-1 md:grid-cols-3">
      {FEATURE_CARDS.map((feature, index) => (
        <LayerCard
          class={`border-areia-border gap-2 rounded-none border-b bg-transparent px-4 py-5 shadow-none ring-0 sm:px-6 md:border-r md:border-b-0 md:px-8 md:border-areia-border${index === FEATURE_CARDS.length - 1 ? " border-b-0 md:border-r-0" : ""}`}
        >
          <img src={feature.icon} class="size-10" alt="" />
          <h3 class="text-areia-default text-lg font-semibold">{feature.title}</h3>
          <p class="text-areia-subtle text-sm lg:text-[1rem]">{feature.description}</p>
        </LayerCard>
      ))}
    </div>
    <WhyIlhaTabBar />
    <WhyIlhaContent />
  </section>
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
          <Badge variant="beta">Alpha is live</Badge>
          <h1 class="text-areia-default text-2xl leading-normal font-semibold text-balance sm:text-3xl lg:text-4xl">
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

const Footer = ilha.render(() => (
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

export default ilha.render(() => (
  <div class="flex min-h-screen flex-col">
    <div class="border-areia-border container mx-auto flex max-w-6xl flex-1 flex-col border-x-0 sm:border-x">
      <Hero />
      <WhyIlha />
      <Creator />
      <Footer />
    </div>
    <Toaster position="bottom-right" closeButton theme="system" />
  </div>
));
