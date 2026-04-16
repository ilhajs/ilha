import {
  AI_SYSTEM_PROMPT,
  COUNTER_CODE,
  ILHA_FORM_CODE,
  ILHA_ROUTER_CODE,
  ILHA_STORE_CODE,
  RENDERING_CODE,
  SIGNALS_CODE,
  URLS,
} from "$lib/const";
import { toast } from "$lib/ui";
import ilha, { html, raw } from "ilha";
import { createHighlighter } from "shiki";
import { useHead } from "unhead";

const NITRO_SANDBOX = URLS.SANDBOX.replace("{template}", "nitro") + "?file=src%2Fpages%2Findex.ts";

const highlighter = await createHighlighter({
  themes: ["night-owl-light"],
  langs: ["typescript"],
});

function highlightCode(code: string): string {
  return highlighter.codeToHtml(code, {
    lang: "typescript",
    theme: "night-owl-light",
  });
}

const Libraries = ilha
  .state("library", "router")
  .derived("code", ({ state }) => {
    switch (state.library()) {
      case "router":
        return highlightCode(ILHA_ROUTER_CODE);
      case "store":
        return highlightCode(ILHA_STORE_CODE);
      case "form":
        return highlightCode(ILHA_FORM_CODE);
    }
  })
  .on("[data-library]@click", ({ state, target }) => {
    const library = target.getAttribute("data-library");
    state.library(library!);
  })
  .on("[data-action=copyCommand]@click", async ({ state }) => {
    const command = `npm install @ilha/${state.library()}`;
    await navigator.clipboard.writeText(command);
    return toast("Copied to clipboard");
  })
  .render(
    ({ state, derived }) => html`
      <section class="card mt-20 flex flex-col lg:flex-row gap-0 p-0 overflow-hidden rounded-4xl">
        <div class="flex flex-1 flex-col justify-center gap-4 border-r py-8 px-4 lg:px-8">
          <h2 class="text-xl lg:text-2xl font-semibold">Batteries included.</h2>
          <p class="text-foreground/60 text-sm lg:text-[1rem]">
            Ilha goes beyond UI templating. Get routing, typed form binding, and zustand-shaped
            state management out of the box — no extra setup required.
          </p>
          <p class="text-sm text-foreground/80">Install with:</p>
          <button data-action="copyCommand" class="btn-lg-outline rounded-full justify-start">
            <img src="/copy.svg" class="size-5" />
            <span>npm install @ilha/${state.library()}</span>
          </button>
        </div>
        <div class="flex-1 p-2 overflow-x-auto bg-[#FBFBFB]" data-action="copy">
            <div class="tabs w-full">
            <nav role="tablist" aria-orientation="horizontal" class="w-full rounded-full">
                <button type="button" role="tab" aria-selected="true" tabindex="0" data-library="router" class="rounded-full">@ilha/router</button>
                <button type="button" role="tab" aria-selected="false" tabindex="0" data-library="store" class="rounded-full">@ilha/store</button>
                <button type="button" role="tab" aria-selected="false" tabindex="0" data-library="form" class="rounded-full">@ilha/form</button>
              </nav>
            </div>
          <div class="text-sm lg:text-[1rem]">
            ${raw(derived.code.value ?? "")}
          </div>
        </div>
      </section>
    `,
  );

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
  .bind("[name=name]", "name")
  .bind("[name=useBun]", "useBun")
  .bind("[name=template]", "template")
  .on("[data-action=copyCommand]@click", async ({ derived }) => {
    await navigator.clipboard.writeText(derived.createCommand.value!);
    return toast("Copied to clipboard");
  })
  .render(
    ({ derived }) => html`
      <section class="relative mt-20 overflow-hidden lg:rounded-4xl -mx-4 lg:mx-0">
        <img src="/dither-2.jpg" class="h-160 w-full object-cover" />
        <div class="absolute inset-0 flex flex-col items-center justify-center p-4">
          <div class="flex w-full max-w-180 flex-col gap-4 rounded-3xl bg-white p-6 shadow-xl">
            <h2 class="text-lg font-semibold">Start a new Ilha project</h2>
            <label class="label">Project name</label>
            <input type="text" name="name" class="input rounded-full" placeholder="my-app" />
            <label class="label">Pick a template</label>
            <fieldset class="grid gap-4">
              <label class="label"
                ><input
                  type="radio"
                  name="template"
                  value="vite"
                  class="input"
                  checked
                />
                <img src="/vite.svg" class="size-6" /><span>Vite</span>
              </label>
              <label class="label"
                ><input type="radio" name="template" value="nitro" class="input" />
                <img src="/nitro.svg" class="size-6" /><span>Nitro</span>
              </label>
              <label class="label"
                ><input type="radio" name="template" value="hono" class="input" />
                <img src="/hono.svg" class="size-6" /><span>Hono</span>
              </label>
            </fieldset>
            <label class="label">
              <input type="checkbox" name="useBun" role="switch" class="input" />
              Use Bun
            </label>
            <div class="flex gap-2 items-center min-w-0">
                <button class="flex-1 btn-outline rounded-full justify-start text-left overflow-hidden" data-action="copyCommand">
                    <img src="/copy.svg" class="size-5 shrink-0" />
                    <span class="truncate block">${derived.createCommand.value}</span>
                </button>
                <a href="${derived.sandboxUrl.value}" target="_blank" rel="noopener noreferrer" class="btn rounded-full bg-sky-900">
                    <img src="/stackblitz.svg" class="size-4" />
                    <span>Open Sandbox</span>
                </a>
            </div>
          </div>
        </div>
      </section>
    `,
  );

const AiPrompt = ilha
  .state("provider", "claude")
  .bind("[data-provider]", "provider")
  .on('[data-form="ai"]@submit', ({ event, target, state }) => {
    if (!(target instanceof HTMLFormElement)) return;
    event.preventDefault();
    const formData = new FormData(target);
    const prompt = formData.get("prompt")!.toString();
    const wholePrompt = AI_SYSTEM_PROMPT + prompt;
    const url = new URL(URLS[state.provider().toUpperCase() as keyof typeof URLS]);
    url.searchParams.set("q", wholePrompt);
    window.open(url, "_blank");
  })
  .render(
    () => html`
      <section class="relative -mx-4 mt-20 overflow-hidden lg:mx-0 lg:rounded-4xl">
        <img src="/dither-4.jpg" class="h-120 w-full object-cover lg:h-160" />
        <div class="absolute inset-0 flex flex-col items-center justify-center p-4">
          <div
            class="flex w-full max-w-180 flex-col items-center justify-center gap-8 text-center text-balance"
          >
            <h2 class="text-3xl font-semibold text-sky-950 lg:text-4xl">Small enough to think with.</h2>
            <p class="text-sky-950 lg:text-lg">
              At under 1,500 lines of code, the entire source fits in a single AI context window, so your
              assistant can reason about the whole framework, not just the docs.
            </p>
            <form
              data-form="ai"
              class="card w-full gap-4 rounded-3xl border-none p-2 shadow-xl outline-0"
            >
              <input
                type="text"
                name="prompt"
                class="input border-none shadow-none ring-0 outline-0 lg:text-[1rem]"
                placeholder="Ask AI to build a landing page..."
              />
              <div class="flex items-center justify-between">
                <select class="select rounded-full" data-provider>
                  <option value="claude" selected>Claude</option>
                  <option value="chatgpt">ChatGPT</option>
                  <option value="perplexity">Perplexity</option>
                </select>
                <button class="btn rounded-full bg-sky-900">Ask</button>
              </div>
            </form>
          </div>
        </div>
      </section>
    `,
  );

const WhyIlha = html`
    <div class="mt-20 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div class="card p-4 gap-2">
            <img src="/code.svg" class="size-10" />
            <h3 class="text-lg font-semibold">Fully open-source.</h3>
            <p class="text-sm lg:text-[1rem] text-foreground/60">Every line is free. No paywalls, no hidden tiers.</p>
        </div>
        <div class="card p-4 gap-2">
            <img src="/thumb.svg" class="size-10" />
            <h3 class="text-lg font-semibold">No build step. No JSX. No virtual DOM.</h3>
            <p class="text-sm lg:text-[1rem] text-foreground/60"">Runs from a single import — no transform, no toolchain to wrestle with.</p>
        </div>
        <div class="card p-4 gap-2">
            <img src="/link.svg" class="size-10" />
            <h3 class="text-lg font-semibold">Works with any backend.</h3>
            <p class="text-sm lg:text-[1rem] text-foreground/60"">TypeScript, PHP, Ruby, Elixir, Rust, Go — Ilha fits your stack regardless.</p>
        </div>
    </div>
    <section class="mt-20 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div class="card rounded-4xl">
            <header class="px-4 lg:px-8 pt-4 gap-4">
                <h2 class="text-xl lg:text-2xl">Renders anywhere.</h2>
                <p class="lg:text-[1rem]">Render to plain HTML on the server, hydrate on the client — with zero flicker. Edge rendering supported too.</p>
            </header>
            <section class="flex flex-col flex-1 px-4 lg:px-8">
                <div class="border rounded-2xl overflow-hidden flex-1 bg-[#FBFBFB] text-sm lg:text-[1rem]">
                  ${raw(highlightCode(RENDERING_CODE))}
                </div>
            </section>
        </div>
        <div class="card rounded-4xl">
            <header class="px-4 lg:px-8 pt-4 gap-4">
                <h2 class="text-xl lg:text-2xl">Signals, not a virtual DOM.</h2>
                <p class="lg:text-[1rem]">Fine-grained reactivity via <code>alien-signals</code>. No diffing, no overhead, no surprises.</p>
            </header>
            <section class="flex flex-col flex-1 px-4 lg:px-8">
                <div class="border rounded-2xl overflow-x-scroll flex-1 bg-[#FBFBFB] text-sm lg:text-[1rem]">
                  ${raw(highlightCode(SIGNALS_CODE))}
                </div>
            </section>
        </div>
    </section>
`;

const Hero = html`
    <section class="relative lg:rounded-4xl overflow-hidden lg:h-160 -mx-4 lg:mx-0">
        <img src="/dither-3.jpg" class="absolute inset-0 w-full h-full object-cover lg:rounded-4xl lg:rounded-br-[2.5rem] z-0" />
        <div class="relative h-full inset-0 flex flex-col lg:flex-row justify-between items-start lg:items-stretch gap-8 z-10">
            <div class="flex-1 flex flex-col justify-center gap-4 px-8 lg:px-16 py-32">
                <div class="badge-outline">Alpha is live</div>
                <h1 class="text-3xl lg:text-5xl leading-normal font-semibold text-balance text-sky-950">
                    Build modern UI, your way.
                </h1>
                <div class="flex gap-2">
                    <a href="/docs" class="btn-lg bg-sky-900 lg:h-12 lg:text-lg rounded-full" data-no-intercept>Get Started</a>
                    <a href="${NITRO_SANDBOX}" target="_blank" rel="noopener noreferrer" class="btn-lg-outline lg:h-12 lg:text-lg rounded-full">
                        <img src="/stackblitz.svg" alt="StackBlitz" class="size-4" />
                        <span>Open Sandbox</span>
                    </a>
                </div>
            </div>
            <div class="flex-1 lg:flex flex-col justify-end hidden">
                <div class="bg-[#FBFBFB] flex flex-col lg:rounded-tl-2xl shadow-2xl overflow-hidden text-xs lg:text-[1rem]">
                    <div class="bg-[#FBFBFB] text-center py-1 font-mono text-foreground/60">main.ts</div>
                    ${raw(highlightCode(COUNTER_CODE))}
                </div>
            </div>
        </div>
    </section>
    <section class="mt-20">
        <p class="text-xl lg:text-4xl leading-normal text-balance">
        Ilha is a tiny island architecture library that renders to <b class="text-sky-700">plain HTML on the server</b>
        and hydrates on the client with zero flicker. The core is <b class="text-sky-700">under 1,500 lines of code</b> —
        small enough to paste into any AI prompt. And when you need more, the extras are included:
        routing, typed forms, and shared state management.
        </p>
    </section>
`;

const Heading = (text: string) =>
  html`<h2 class="text-center text-3xl lg:text-4xl font-semibold mt-20 text-sky-700">${text}</h2>`;

export default ilha
  .slot("aiPrompt", AiPrompt)
  .slot("libraries", Libraries)
  .slot("creator", Creator)
  .onMount(() => {
    useHead(window.__UNHEAD__, {
      title: "Ilha - Build modern UI, your way.",
    });
  })
  .render(
    ({ slots }) =>
      html`
      ${Hero}
      ${slots.aiPrompt()}
      ${Heading("Why Ilha?")}
      ${WhyIlha}
      ${Heading("And there's more.")}
      ${slots.libraries()}
      ${slots.creator()}
    `,
  );
