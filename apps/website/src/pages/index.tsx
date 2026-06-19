import { Footer } from "$lib/components/footer";
import { bindHeroTechCardTracking, HeroTechCards } from "$lib/components/hero-tech-card";
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
import { Book } from "lucide";

const NITRO_SANDBOX = `${URLS.SANDBOX.replace("{template}", "nitro")}?file=src%2Fpages%2Findex.tsx`;

export default ilha
  .onMount(({ host }) => bindHeroTechCardTracking(host))
  .render(() => (
    <div class="bg-areia-surface-elevated/50 text-areia-foreground flex min-h-screen flex-col">
      <Topbar />

      <main class="flex-1">
        <section class="container mx-auto mt-20 max-w-6xl px-5 pt-6 pb-12 sm:mt-0 sm:px-6 sm:pt-14 sm:pb-20 md:pt-16 lg:px-8 lg:pt-24 lg:pb-28 xl:pt-28">
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
            <div class="flex flex-wrap items-center justify-center gap-3">
              <LinkButton
                href="/guide/getting-started/introduction"
                variant="primary"
                icon={<Icon icon={Book} />}
              >
                Get Started
              </LinkButton>
              <LinkButton variant="outline" href={NITRO_SANDBOX} external>
                Open Sandbox
              </LinkButton>
            </div>
            <ClipboardText
              text="npx giget@latest gh:ilhajs/ilha/templates/vite my-app"
              tooltip
              class="w-full max-w-md px-0.5 text-left sm:px-0"
            />
            <HeroTechCards />
          </div>
        </section>

        <section class="container mx-auto max-w-6xl px-5 pt-4 pb-16 sm:px-6 sm:pt-0 sm:pb-24 lg:px-8">
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
                  <div class="code-surface border-areia-border overflow-auto rounded-lg border text-xs [&_pre]:!m-0 [&_pre]:!p-3">
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
