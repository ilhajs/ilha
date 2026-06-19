import { Footer } from "$lib/components/footer";
import { bindHeroTechCardTracking, HeroTechCards } from "$lib/components/hero-tech-card";
import { Preview } from "$lib/components/preview";
import { Topbar } from "$lib/components/topbar";
import {
  PRIMARY_ILHA_CARDS,
  ProjectCreatorForm,
  USEFUL_EXTRAS_CARD,
  UsefulExtrasSnippets,
  whyIlhaCodeHtml,
} from "$lib/landing";
import { URLS } from "$lib/landing-const";
import { Badge, ClipboardText, Icon, LayerCard, LinkButton } from "areia";
import ilha, { raw } from "ilha";
import { Book, FileType, Package, Scale, Star, Zap } from "lucide";

const HERO_STATS = [
  { icon: Scale, label: "< 2,500 LOC core" },
  { icon: Package, label: "Zero dependencies" },
  { icon: FileType, label: "TypeScript-first" },
  { icon: Zap, label: "No virtual DOM" },
];

const PREVIEW_CODE = `import ilha from "ilha";
import { Button, Checkbox, Input, LayerCard } from "areia";
import { each } from "quando";

let nextId = 4;

export default ilha
  .state("tasks", [
    { id: 1, label: "Ship the landing page", done: true },
    { id: 2, label: "Write unit tests", done: false },
    { id: 3, label: "Update README", done: false },
  ])
  .state("draft", "")
  .derived("pending", ({ state }) =>
    state.tasks().filter((t) => !t.done)
  )
  .on("form@submit", ({ state, event }) => {
    event.preventDefault();
    const label = state.draft().trim();
    if (!label) return;
    state.tasks([
      ...state.tasks(),
      { id: nextId++, label, done: false }
    ]);
    state.draft("");
  })
  .on("[data-remove]@click", ({ state, target }) => {
    const id = Number(target.dataset.remove);
    state.tasks(state.tasks().filter((t) => t.id !== id));
  })
  .render(({ state, derived }) => (
    <LayerCard>
      <LayerCard.Title>
        My Tasks ({derived.pending().length})
      </LayerCard.Title>
      <LayerCard.Content class="p-0">
        <ul class="divide-y divide-areia-border">
          {each(state.tasks())
            .as((task, i) => (
              <li
                key={task.id}
                class="flex items-center gap-2 p-2"
              >
                <div class="flex-1">
                  <Checkbox
                    bind:checked={state.tasks.select((tasks) => tasks[i].done)}
                    label={task.label}
                  />
                </div>
                <Button data-remove={task.id} size="sm">
                  ✕
                </Button>
              </li>
            ))
            .else(<div class="p-2">No tasks</div>)}
        </ul>
        <form
          class="flex gap-2 border-t border-areia-border p-2"
        >
          <Input
            placeholder="New task…"
            bind:value={state.draft}
            class="flex-1"
          />
          <Button type="submit" disabled={state.draft.length}>
            Add
          </Button>
        </form>
      </LayerCard.Content>
    </LayerCard>
  ));
`;

const NITRO_SANDBOX = `${URLS.SANDBOX.replace("{template}", "nitro")}?file=src%2Fpages%2Findex.tsx`;

export default ilha
  .onMount(({ host }) => bindHeroTechCardTracking(host))
  .render(() => (
    <div class="bg-areia-surface-elevated/50 text-areia-foreground flex min-h-screen flex-col">
      <Topbar />

      <main class="flex-1">
        <section class="container mx-auto mt-20 max-w-6xl px-5 pt-6 pb-16 sm:mt-0 sm:px-6 sm:pt-14 sm:pb-24 md:pt-16 lg:px-8 lg:pt-24 lg:pb-32 xl:pt-28">
          <div class="mx-auto flex max-w-4xl flex-col items-center gap-6 text-center sm:gap-8 lg:gap-10">
            <Badge variant="beta">Beta is live</Badge>
            <div class="space-y-4 px-0.5 sm:space-y-5 sm:px-0 lg:space-y-6">
              <h1 class="text-[1.75rem] leading-[1.15] font-semibold tracking-tight text-balance sm:text-4xl sm:leading-[1.1] lg:text-5xl lg:leading-[1.08]">
                The most versatile web UI library.
              </h1>
              <p class="text-areia-subtle mx-auto max-w-2xl px-1 text-[0.9375rem] leading-[1.65] text-balance sm:px-0 sm:text-lg sm:leading-7">
                Ilha is a tiny island architecture library that renders to{" "}
                <strong class="text-areia-foreground font-medium">plain HTML on the server</strong>{" "}
                and hydrates on the client with zero flicker. The core is{" "}
                <strong class="text-areia-foreground font-medium">under 2,500 lines of code</strong>
                — small enough to paste into any AI prompt. Routing, typed forms, and shared state
                are included when you need them.
              </p>
            </div>
            <div class="flex w-full max-w-md flex-col items-center gap-2.5">
              <ClipboardText
                text="npx giget@latest gh:ilhajs/ilha/templates/vite my-app"
                tooltip
                class="w-full px-0.5 text-left sm:px-0"
              />
              <div class="flex w-full flex-wrap items-center justify-center gap-3">
                <LinkButton
                  href="/guide/getting-started/introduction"
                  variant="primary"
                  icon={<Icon icon={Book} />}
                  class="flex-1 justify-center sm:flex-none"
                >
                  Get Started
                </LinkButton>
                <LinkButton
                  variant="outline"
                  href={NITRO_SANDBOX}
                  external
                  class="flex-1 justify-center sm:flex-none"
                >
                  Open Sandbox
                </LinkButton>
              </div>
            </div>
            <ul class="text-areia-subtle flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
              {HERO_STATS.map((stat) => (
                <li class="flex items-center gap-1.5">
                  <Icon icon={stat.icon} class="text-areia-primary size-4 shrink-0" />
                  <span>{stat.label}</span>
                </li>
              ))}
              <li class="flex items-center gap-1.5">
                <Icon icon={Star} class="text-areia-primary size-4 shrink-0" />
                <a
                  href={URLS.GITHUB}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hover:text-areia-foreground underline-offset-4 transition hover:underline"
                >
                  Star on GitHub
                </a>
              </li>
            </ul>
            <HeroTechCards />
          </div>
        </section>

        <section class="container mx-auto max-w-6xl px-5 pb-16 sm:px-6 sm:pb-24 lg:px-8 lg:pb-32">
          <div class="mx-auto mb-6 max-w-2xl text-center sm:mb-8">
            <Badge variant="outline">Live demo</Badge>
            <p class="text-areia-subtle mt-3 text-[0.9375rem] leading-[1.65] text-balance sm:text-base">
              One island — state, events, and markup together. Edit the code and watch it run.
            </p>
          </div>
          <Preview code={PREVIEW_CODE} size="lg" />
        </section>

        <section class="container mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-28 lg:px-8 lg:pb-32">
          <div class="mb-8 max-w-2xl space-y-3 sm:mb-10 sm:space-y-4 md:mb-12">
            <Badge variant="outline">Why Ilha</Badge>
            <h2 class="text-xl leading-snug font-semibold tracking-tight sm:text-3xl sm:leading-tight">
              Build modern UI without framework ceremony.
            </h2>
            <p class="text-areia-subtle text-[0.9375rem] leading-[1.65] sm:text-base sm:leading-7">
              Familiar syntax, signal-driven updates, and one island for every rendering strategy —
              from static HTML to hydrated interactivity.
            </p>
          </div>

          <div class="grid items-start gap-5 sm:gap-6 md:grid-cols-2 md:gap-7">
            {PRIMARY_ILHA_CARDS.map((tab) => (
              <LayerCard class="overflow-hidden">
                <LayerCard.Title>{tab.label}</LayerCard.Title>
                <LayerCard.Content class="flex flex-col gap-4 text-[0.9375rem] leading-relaxed sm:text-base sm:leading-7">
                  <div class="space-y-2">
                    <p class="text-areia-foreground m-0 font-medium">{tab.title}</p>
                    <p class="text-areia-subtle m-0">{tab.description}</p>
                  </div>
                  <ul class="text-areia-subtle m-0 grid gap-2 text-sm">
                    {tab.points.map((point) => (
                      <li class="flex items-center gap-2">
                        <span class="bg-areia-primary size-1.5 shrink-0 rounded-full" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <div class="code-surface border-areia-border overflow-auto rounded-lg border text-xs [&_pre]:!m-0 [&_pre]:!p-4">
                    {raw(whyIlhaCodeHtml[tab.id] ?? "")}
                  </div>
                </LayerCard.Content>
              </LayerCard>
            ))}

            <LayerCard class="overflow-hidden">
              <LayerCard.Title>{USEFUL_EXTRAS_CARD.label}</LayerCard.Title>
              <LayerCard.Content class="flex flex-col gap-4 text-[0.9375rem] leading-relaxed sm:text-base sm:leading-7">
                <div class="space-y-2">
                  <p class="text-areia-foreground m-0 font-medium">{USEFUL_EXTRAS_CARD.title}</p>
                  <p class="text-areia-subtle m-0">{USEFUL_EXTRAS_CARD.description}</p>
                </div>
                <ul class="text-areia-subtle m-0 grid gap-2 text-sm">
                  {USEFUL_EXTRAS_CARD.points.map((point) => (
                    <li class="flex items-center gap-2">
                      <span class="bg-areia-primary size-1.5 shrink-0 rounded-full" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <UsefulExtrasSnippets />
              </LayerCard.Content>
            </LayerCard>

            <LayerCard class="overflow-hidden md:col-span-2">
              <LayerCard.Title>Start a new Ilha project</LayerCard.Title>
              <LayerCard.Content class="space-y-4 text-[0.9375rem] leading-relaxed sm:text-base">
                <p class="text-areia-subtle m-0">
                  Pick a template, optional project name, and copy the giget command — or open a
                  StackBlitz sandbox.
                </p>
                <ProjectCreatorForm />
              </LayerCard.Content>
            </LayerCard>

            <LayerCard class="overflow-hidden md:col-span-2">
              <LayerCard.Content class="flex flex-col gap-6 sm:gap-8 md:flex-row md:items-center md:justify-between">
                <div class="max-w-2xl space-y-2.5 text-left sm:space-y-3">
                  <h3 class="text-lg font-semibold tracking-tight sm:text-xl">
                    Read the guide and try the tutorials.
                  </h3>
                  <p class="text-areia-subtle m-0 text-[0.9375rem] leading-relaxed sm:text-base">
                    Learn the island API, helpers, and libraries — then follow interactive counter
                    and dex tutorials.
                  </p>
                </div>
                <div class="flex w-full shrink-0 flex-col gap-2.5 sm:w-auto sm:flex-row sm:gap-3">
                  <LinkButton
                    href="/guide/getting-started/introduction"
                    variant="primary"
                    class="w-full sm:w-auto"
                    icon={<Icon icon={Book} />}
                  >
                    Guide
                  </LinkButton>
                  <LinkButton
                    variant="outline"
                    href="/tutorial/counter/state"
                    class="w-full sm:w-auto"
                  >
                    Tutorial
                  </LinkButton>
                </div>
              </LayerCard.Content>
            </LayerCard>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  ));
