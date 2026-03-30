import ilha, { html, raw } from "ilha";
import {
  Blend,
  Boxes,
  Braces,
  Cable,
  type IconNode,
  MousePointerClick,
  Radar,
  ScanSearch,
  SquareCode,
} from "lucide";

const ilhaLogo =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDI0IiBoZWlnaHQ9IjEwMjQiIGZpbGw9Im5vbmUiPjxkZWZzPjxjbGlwUGF0aCBpZD0iYSIgY2xhc3M9ImZyYW1lLWNsaXAgZnJhbWUtY2xpcC1kZWYiPjxyZWN0IHdpZHRoPSIxMDI0IiBoZWlnaHQ9IjEwMjQiIHJ4PSIwIiByeT0iMCIvPjwvY2xpcFBhdGg+PC9kZWZzPjxnIGNsYXNzPSJmcmFtZS1jb250YWluZXItd3JhcHBlciI+PGcgY2xhc3M9ImZyYW1lLWNvbnRhaW5lci1ibHVyIj48ZyBjbGFzcz0iZnJhbWUtY29udGFpbmVyLXNoYWRvd3MiIGNsaXAtcGF0aD0idXJsKCNhKSI+PGcgY2xhc3M9ImZpbGxzIj48cmVjdCB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiBjbGFzcz0iZnJhbWUtYmFja2dyb3VuZCIgcng9IjAiIHJ5PSIwIi8+PC9nPjxnIGNsYXNzPSJmcmFtZS1jaGlsZHJlbiI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJiIiB4MT0iMCIgeDI9IjEiIHkxPSIuNSIgeTI9Ii41Ij48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMyZDYxZmYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyOGJmZmYiLz48L2xpbmVhckdyYWRpZW50PjxwYXR0ZXJuIGlkPSJjIiB3aWR0aD0iNTY0LjkiIGhlaWdodD0iNTY0LjkiIHg9Ijg4LjQiIHk9IjIyOS42IiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNMCAwaDU2NXY1NjVIMHoiIHN0eWxlPSJmaWxsOnVybCgjYikiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSI1NjQuOSIgaGVpZ2h0PSI1NjQuOSIgeD0iODguNCIgeT0iMjI5LjYiIGZpbGw9InVybCgjYykiIGNsYXNzPSJmaWxscyIgcng9IjgwIiByeT0iODAiIHRyYW5zZm9ybT0icm90YXRlKDQ1IDM3MSA1MTIpIi8+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJkIiB4MT0iMCIgeDI9IjEiIHkxPSIuNSIgeTI9Ii41Ij48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMyOGJmZmYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyZDYxZmYiLz48L2xpbmVhckdyYWRpZW50PjxwYXR0ZXJuIGlkPSJlIiB3aWR0aD0iNTY0LjkiIGhlaWdodD0iNTY0LjkiIHg9IjM3MC44IiB5PSIyMjkuNiIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMGg1NjV2NTY1SDB6IiBzdHlsZT0iZmlsbDp1cmwoI2QpIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iNTY0LjkiIGhlaWdodD0iNTY0LjkiIHg9IjM3MC44IiB5PSIyMjkuNiIgZmlsbD0idXJsKCNlKSIgY2xhc3M9ImZpbGxzIiByeD0iODAiIHJ5PSI4MCIgdHJhbnNmb3JtPSJyb3RhdGUoNDUgNjUzIDUxMikiLz48L2c+PC9nPjwvZz48L2c+PC9zdmc+";

const outlinedButtonClass =
  "border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-sky-600 hover:bg-white/5";
const navButtonClass =
  "border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:border-sky-600 hover:text-white";
const filledButtonClass =
  "bg-linear-to-r from-blue-600 to-sky-500 text-white transition hover:from-blue-500 hover:to-sky-400";
const footerLinkClass = "transition hover:text-white";
const hoverGridColumns = 10;
const hoverGridRows = 30;
const visibleHoverRows = 4;
const lightClasses = [
  "bg-sky-300/20",
  "bg-sky-400/20",
  "bg-cyan-300/20",
  "bg-cyan-400/20",
  "bg-blue-300/20",
  "bg-blue-400/20",
] as const;

const blueprintItems = [
  {
    title: "HTML-first islands",
    copy: "Render plain HTML strings and mount interactivity only where it is needed. Each island stays self-contained, so the rest of the page can remain simple and server-friendly.",
    icon: lucideIcon(Boxes),
  },
  {
    title: "Delegated events",
    copy: "Use `.on()` with selector-plus-event syntax to attach typed handlers with very little ceremony. It keeps behavior close to the markup without repetitive component wrappers.",
    icon: lucideIcon(MousePointerClick),
  },
  {
    title: "Shared signals",
    copy: "Build local state with `.state()` when an island should stay isolated. Use `.context()` when multiple islands need to react to the same source of truth.",
    icon: lucideIcon(Cable),
  },
  {
    title: "SSR and hydration",
    copy: "Render synchronously or asynchronously on the server and preserve the HTML that already exists. Opt into hydration only when client-side continuity is actually needed.",
    icon: lucideIcon(Blend),
  },
  {
    title: "Framework-free foundation",
    copy: "Ilha keeps the surface area intentionally small and framework-free. It gives you an island architecture layer instead of a full runtime abstraction.",
    icon: lucideIcon(SquareCode),
  },
  {
    title: "Reactive by default",
    copy: "Built on `alien-signals`, the reactive model stays lightweight and direct. State changes stay predictable and rendering logic remains focused on the values an island actually reads.",
    icon: lucideIcon(Radar),
  },
  {
    title: "Schema-compatible input",
    copy: "Inputs work with Standard Schema validators. You can validate props with tools you already use instead of adopting a library-specific format.",
    icon: lucideIcon(ScanSearch),
  },
  {
    title: "Typed builder chain",
    copy: "The builder carries TypeScript inference through state, derived values, handlers, and render output. The API stays strongly typed without forcing manual annotations across the chain.",
    icon: lucideIcon(Braces),
  },
] as const;

const codeExample = `const counter = ilha
  .input(counterSchema)
  .state("count", ({ input }) => input.count)
  .on("[data-increment]@click", ({ state }) => {
    state.count(state.count() + 1);
  })
  .render(({ state }) => html\`
    <button data-increment>
      Count: \${state.count}
    </button>
  \`);`;

const primaryLinks = [
  { href: "/docs/#ilha", label: "Docs", className: navButtonClass },
  {
    href: "/docs/#installation",
    label: "Get started",
    className: `${filledButtonClass} px-4 py-2 text-sm font-medium`,
  },
] as const;

const heroLinks = [
  {
    href: "/docs/#installation",
    label: "Read installation",
    className: `${filledButtonClass} w-full px-5 py-3 text-center text-sm font-semibold sm:w-auto`,
  },
  {
    href: "/docs/#builder-api",
    label: "Explore builder API",
    className: `${outlinedButtonClass} w-full text-center sm:w-auto`,
  },
] as const;

const footerSections = [
  {
    title: "Open Source",
    ariaLabel: "Open source",
    links: [
      { href: "https://github.com/guarana-studio/ilha", label: "Ilha" },
      { href: "https://github.com/guarana-studio/deskdown", label: "Deskdown" },
      { href: "https://github.com/guarana-studio/docsome", label: "Docsome" },
      { href: "https://github.com/guarana-studio/hydride", label: "Hydride" },
    ],
  },
  {
    title: "Company",
    ariaLabel: "Company",
    links: [
      { href: "https://guarana.studio/", label: "Guarana Studio" },
      { href: "#", label: "Terms of Service" },
      { href: "#", label: "Privacy Policy" },
      { href: "#", label: "Acceptable Use Policy" },
    ],
  },
  null,
  {
    title: "Socials",
    ariaLabel: "Socials",
    className: "md:justify-self-end",
    links: [
      { href: "https://github.com/guarana-studio", label: "GitHub" },
      { href: "#", label: "Discord" },
      { href: "#", label: "X.com" },
    ],
  },
] as const;

type FooterSection = Exclude<(typeof footerSections)[number], null>;

function lucideIcon(iconNode: IconNode) {
  const children = iconNode
    .map(([tag, attrs]) => {
      const attrString = Object.entries(attrs)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}="${String(value)}"`)
        .join(" ");

      return `<${tag} ${attrString}></${tag}>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
      ${children}
    </svg>
  `;
}

function BlueprintTile(item: (typeof blueprintItems)[number], index: number) {
  const grid = Array.from({ length: hoverGridColumns * hoverGridRows }, (_, cellIndex) => {
    return html`
      <div class="relative aspect-square border-b border-r border-white/5">
        <div
          data-grid-light
          data-cell-index="${cellIndex}"
          class="absolute inset-0 bg-sky-300/15 opacity-0 blur-sm transition-opacity duration-1000"
        ></div>
      </div>
    `;
  }).join("");

  return html`
    <article
      data-blueprint-tile
      data-tile-index="${index}"
      class="group relative flex flex-col bg-white/5 p-7 backdrop-blur transition-colors duration-200 hover:bg-white/6"
    >
      <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div class="grid w-full grid-cols-10 place-items-stretch">
          ${raw(grid)}
        </div>
      </div>
      <div aria-hidden="true" class="pointer-events-none absolute inset-0 bg-linear-to-br from-white/5 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"></div>
      <div aria-hidden="true" class="relative mb-5 flex h-10 w-10 items-center justify-center border border-white/10 bg-white/5 text-slate-300">
        ${raw(item.icon)}
      </div>
      <h2 class="relative text-xl font-semibold text-white">${item.title}</h2>
      <p class="relative mt-3 text-sm leading-7 text-slate-300">${item.copy}</p>
    </article>
  `;
}

const Home = ilha
  .onMount(({ host }) => {
    const tiles = Array.from(host.querySelectorAll<HTMLElement>("[data-blueprint-tile]"));
    const colorClassList = [...lightClasses];
    const cleanupMap = new Map<
      HTMLElement,
      { clearTimeoutId: number | null; nextStepTimeoutId: number | null }
    >();

    const setTileHeight = (tile: HTMLElement) => {
      const cellSize = Math.ceil(tile.clientWidth / hoverGridColumns);
      tile.style.minHeight = `${cellSize * visibleHoverRows}px`;
    };

    const clearTile = (tile: HTMLElement) => {
      const timeouts = cleanupMap.get(tile);

      if (timeouts && timeouts.clearTimeoutId !== null) {
        window.clearTimeout(timeouts.clearTimeoutId);
        timeouts.clearTimeoutId = null;
      }

      if (timeouts && timeouts.nextStepTimeoutId !== null) {
        window.clearTimeout(timeouts.nextStepTimeoutId);
        timeouts.nextStepTimeoutId = null;
      }

      const lights = Array.from(tile.querySelectorAll<HTMLElement>("[data-grid-light]"));

      for (const light of lights) {
        light.classList.remove("opacity-100");
        light.classList.add("opacity-0");
      }
    };

    const runTileStep = (tile: HTMLElement) => {
      const lights = Array.from(tile.querySelectorAll<HTMLElement>("[data-grid-light]"));
      const totalVisibleCells = hoverGridColumns * visibleHoverRows;
      const next = new Set<number>();
      const batchSize = Math.random() > 0.5 ? 4 : 3;

      while (next.size < batchSize) {
        next.add(Math.floor(Math.random() * totalVisibleCells));
      }

      for (const index of next) {
        const light = lights[index];

        if (!light) {
          continue;
        }

        const colorClass = lightClasses[Math.floor(Math.random() * lightClasses.length)];

        if (!colorClass) {
          continue;
        }

        light.classList.remove(...colorClassList);
        light.classList.add(colorClass, "opacity-100");
        light.classList.remove("opacity-0");
      }

      const timeouts = cleanupMap.get(tile) ?? { clearTimeoutId: null, nextStepTimeoutId: null };

      timeouts.clearTimeoutId = window.setTimeout(() => {
        for (const index of next) {
          const light = lights[index];

          if (!light) {
            continue;
          }

          light.classList.remove("opacity-100");
          light.classList.add("opacity-0");
        }
      }, 750);

      timeouts.nextStepTimeoutId = window.setTimeout(() => {
        runTileStep(tile);
      }, 1500);

      cleanupMap.set(tile, timeouts);
    };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLElement) {
          setTileHeight(entry.target);
        }
      }
    });

    const cleanups: Array<() => void> = [];

    for (const tile of tiles) {
      setTileHeight(tile);
      resizeObserver.observe(tile);
      cleanupMap.set(tile, { clearTimeoutId: null, nextStepTimeoutId: null });

      const handleMouseEnter = () => {
        clearTile(tile);
        runTileStep(tile);
      };

      const handleMouseLeave = () => {
        clearTile(tile);
      };

      tile.addEventListener("mouseenter", handleMouseEnter);
      tile.addEventListener("mouseleave", handleMouseLeave);

      cleanups.push(() => {
        tile.removeEventListener("mouseenter", handleMouseEnter);
        tile.removeEventListener("mouseleave", handleMouseLeave);
        clearTile(tile);
      });
    }

    return () => {
      resizeObserver.disconnect();
      cleanups.forEach((cleanup) => cleanup());
    };
  })
  .render(() => {
    return html`
    <main class="min-h-screen overflow-hidden bg-slate-950 font-sans text-slate-100 antialiased" id="main-content">
      <div class="relative isolate">
        <div aria-hidden="true" class="absolute inset-0 -z-10 bg-linear-to-b from-slate-950 via-slate-950 to-slate-900"></div>
        <div aria-hidden="true" class="absolute inset-0 -z-10 overflow-hidden opacity-20">
          <div class="grid h-full w-full grid-cols-6 md:grid-cols-10 lg:grid-cols-12">
            ${raw(
              Array.from(
                { length: 12 },
                () => '<div class="border-l border-white/10 last:border-r"></div>',
              ).join(""),
            )}
          </div>
          <div class="absolute inset-0 grid grid-rows-6 md:grid-rows-8 lg:grid-rows-10">
            ${raw(
              Array.from(
                { length: 10 },
                () => '<div class="border-t border-white/10 last:border-b"></div>',
              ).join(""),
            )}
          </div>
        </div>
        <div aria-hidden="true" class="absolute inset-x-0 top-0 -z-10 h-96 bg-linear-to-b from-blue-500/20 via-cyan-400/10 to-transparent"></div>
        <div aria-hidden="true" class="absolute left-0 top-24 -z-10 h-72 w-72 rotate-12 bg-blue-500/10 blur-3xl"></div>
        <div aria-hidden="true" class="absolute right-0 top-40 -z-10 h-80 w-80 -rotate-6 bg-cyan-400/10 blur-3xl"></div>

        <div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6 sm:px-8 lg:px-10">
          <header class="flex items-center justify-between pb-5">
            <a href="#main-content" class="flex items-center gap-3" aria-label="Ilha home">
              <img src="${ilhaLogo}" alt="Ilha logo" class="h-8 w-8" />
              <p class="text-sm font-medium text-slate-100">Ilha</p>
            </a>

            <nav class="hidden items-center gap-3 md:flex" aria-label="Primary">
              ${raw(
                primaryLinks
                  .map(
                    (link) => html`
                      <a href="${link.href}" class="${link.className}">
                        ${link.label}
                      </a>
                    `,
                  )
                  .join(""),
              )}
            </nav>
          </header>

          <section class="flex flex-1 items-center py-16 sm:py-20 lg:py-24" aria-labelledby="hero-heading">
            <div class="grid w-full gap-12 lg:grid-cols-2 lg:items-center">
              <div class="max-w-3xl">
                <h1 id="hero-heading" class="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                  Framework-free islands for HTML-first apps.
                </h1>

                <p class="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                  Ilha gives you typed state, delegated events, shared signals, and SSR-friendly islands without shipping a full framework to the browser.
                </p>

                <div class="mt-8 flex max-w-xl flex-col gap-3 sm:max-w-none sm:flex-row sm:flex-wrap">
                  ${raw(
                    heroLinks
                      .map(
                        (link) => html`
                          <a href="${link.href}" class="${link.className}">
                            ${link.label}
                          </a>
                        `,
                      )
                      .join(""),
                  )}
                </div>
              </div>

              <div class="relative min-w-0" aria-labelledby="example-heading">
                <h2 id="example-heading" class="sr-only">
                  Code example
                </h2>
                <div aria-hidden="true" class="absolute inset-0 rounded-3xl bg-cyan-400/10 blur-2xl"></div>
                <div class="relative overflow-hidden border border-white/10 bg-slate-900/80 shadow-2xl backdrop-blur">
                  <div class="flex items-center justify-between border-b border-white/10 px-5 py-4">
                    <div aria-hidden="true" class="flex items-center gap-2">
                      <span class="h-2.5 w-2.5 rounded-full bg-rose-400"></span>
                      <span class="h-2.5 w-2.5 rounded-full bg-amber-300"></span>
                      <span class="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
                    </div>
                    <p class="font-mono text-xs uppercase tracking-widest text-slate-500">
                      counter.ts
                    </p>
                  </div>

                  <pre class="w-full overflow-x-auto p-5 font-mono text-sm leading-7 text-slate-200"><code>${codeExample}</code></pre>
                </div>
              </div>
            </div>
          </section>

          <section class="py-10" aria-labelledby="feature-grid-heading">
            <h2 id="feature-grid-heading" class="sr-only">
              Features and core concepts
            </h2>
            <div class="relative overflow-hidden border border-white/10">
              <div class="grid divide-y divide-white/10 md:grid-cols-2 md:divide-x md:divide-y">
                ${raw(blueprintItems.map((item, index) => BlueprintTile(item, index)).join(""))}
              </div>
            </div>
          </section>

          <footer class="mt-8 py-10">
            <h2 class="sr-only">Footer</h2>
            <div class="grid gap-10 text-sm text-slate-400 md:grid-cols-4 md:items-start">
              ${raw(
                footerSections
                  .map((section, index) =>
                    section
                      ? html`
                          <nav aria-label="${(section as FooterSection).ariaLabel}" class="${"className" in section ? section.className : ""}">
                            <h3 class="font-mono text-xs uppercase tracking-widest text-slate-500">
                              ${(section as FooterSection).title}
                            </h3>
                            <div class="mt-4 grid gap-3 justify-items-start">
                              ${raw(
                                (section as FooterSection).links
                                  .map(
                                    (link) => html`
                                      <a href="${link.href}" class="${footerLinkClass}">${link.label}</a>
                                    `,
                                  )
                                  .join(""),
                              )}
                            </div>
                          </nav>
                        `
                      : `<div class="hidden md:block" data-spacer="${index}"></div>`,
                  )
                  .join(""),
              )}
            </div>

            <div class="mt-10 border-t border-white/10 pt-6 text-xs text-slate-500">
              © 2026 Ilha by Guarana Studio. All rights reserved.
            </div>
          </footer>
        </div>
      </div>
    </main>
  `;
  });

export default Home;
