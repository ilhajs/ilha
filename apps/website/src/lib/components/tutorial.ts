import { isActive } from "@ilha/router";
import { effect } from "alien-signals";
import dedent from "dedent";
import ilha, { html, raw } from "ilha";
import { createMarkdownExit } from "markdown-exit";
import { createShikiEditor, type ShikiEditorHandle } from "shedit";
import { createHighlighter } from "shiki";

const md = createMarkdownExit();

const shiki = await createHighlighter({
  langs: ["typescript", "html"],
  themes: ["github-light", "github-dark"],
});

type Code = { template: string; script: string };

function buildSrcDoc() {
  return dedent`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link
        href="https://cdn.jsdelivr.net/npm/@faith-tools/sensible-ui@1.0.5/dist/sensible-ui.min.css"
        type="text/css"
        rel="stylesheet"
      />
      <script
        async
        src="https://ga.jspm.io/npm:es-module-shims@2.8.0/dist/es-module-shims.js"
      ></script>
      <style>
        [data-ilha-slot] {
          display: contents;
        }
      </style>
    </head>
    <body>
      <script type="importmap">{"imports":{"ilha":"https://esm.sh/pr/ilha@main"}}</script>
      <script type="module">
        import tsBlankSpace from "https://esm.sh/ts-blank-space";
        window.addEventListener("message", async ({ data }) => {
          if (data?.type !== "ilha:preview") return;
          // Tear down previous run
          document.body.innerHTML = data.template;
          // Strip types before creating the blob
          const js = tsBlankSpace(data.script, (node) => {
            console.warn("[ts-blank-space] unsupported syntax node:", node);
          });
          const blob = new Blob([js], { type: "text/javascript" });
          const url = URL.createObjectURL(blob);
          try {
            await import(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        });
      </script>
    </body>
    </html>
  `;
}

type TutorialProps = { content: string; code: Code; key: string };

const TUTORIAL_LIST = [
  { href: "/tutorial", label: "1. Counter - .state()" },
  { href: "/tutorial/counter-on", label: "2. Counter - .on()" },
  { href: "/tutorial/counter-derived", label: "3. Counter - .derived()" },
  { href: "/tutorial/counter-bind", label: "4. Counter - .bind()" },
  { href: "/tutorial/counter-effect", label: "5. Counter - .effect()" },
  { href: "/tutorial/pokedex-onmount", label: "6. PokéDex - .onMount()" },
  { href: "/tutorial/pokedex-input", label: "7. PokéDex - .input()" },
  { href: "/tutorial/pokedex-slot", label: "8. PokéDex - .slot()" },
  { href: "/tutorial/pokedex-context", label: "9. PokéDex - context()" },
];

export const Tutorial = ({ content, code, key }: TutorialProps) => {
  const template = ilha.context(`tutorial.${key}.template`, code.template);
  const script = ilha.context(`tutorial.${key}.script`, code.script);
  const contentHtml = md.render(content);

  const Editor = ilha
    .state<"script" | "template">("currentTab", "script")
    .state<ShikiEditorHandle>("editor", undefined)
    .onMount(({ state }) => {
      state.editor?.(
        createShikiEditor(document.getElementById("editor")!, {
          shiki,
          lang: "typescript",
          themes: { light: "github-light", dark: "github-dark" },
          lineHeight: 22,
          tabSize: 2,
          onChange(value) {
            script(value);
          },
        }),
      );
      state.editor?.().setValue(script());
    })
    .on("[data-tab]@click", ({ target, state }) => {
      const editor = state.editor?.();
      if (!editor) return;
      const tab = target.getAttribute("data-tab")!;
      if (tab === "script") {
        editor.setLang("typescript");
        editor.setValue(script());
      } else {
        editor.setLang("html");
        editor.setValue(template());
      }
    })
    .render(
      () => html`
        <div class="flex h-full flex-col gap-2 overflow-hidden">
          <div class="tabs w-full shrink-0" id="demo-tabs-with-panels">
            <nav role="tablist" aria-orientation="horizontal" class="w-full">
              <button type="button" role="tab" aria-selected="true" tabindex="0" data-tab="script">
                Script
              </button>
              <button type="button" role="tab" aria-selected="false" tabindex="0" data-tab="template">
                Template
              </button>
            </nav>
          </div>
          <div id="editor" class="flex-1 overflow-hidden rounded-lg border"></div>
        </div>
      `,
    );

  const Preview = ilha
    .effect(({ host }) => {
      const iframe = host.querySelector<HTMLIFrameElement>("iframe")!;
      let iframeReady = false;
      let pendingMessage: { type: string; template: string; script: string } | null = null;

      const buildMessage = () => ({
        type: "ilha:preview",
        template: template(),
        script: script(),
      });

      const send = (msg: { type: string; template: string; script: string }) => {
        iframe.contentWindow?.postMessage(msg, "*");
      };

      const onLoad = () => {
        iframeReady = true;
        // Flush whatever the current state is once the iframe is ready.
        send(pendingMessage ?? buildMessage());
        pendingMessage = null;
      };
      iframe.addEventListener("load", onLoad, { once: true });

      // Skip the effect's first run — the load handler above owns the initial post.
      let primed = false;
      const stop = effect(() => {
        const msg = buildMessage(); // always read both signals so deps are tracked
        if (!primed) {
          primed = true;
          return;
        }
        if (iframeReady) {
          send(msg);
        } else {
          pendingMessage = msg;
        }
      });

      return () => {
        stop();
        iframe.removeEventListener("load", onLoad);
      };
    })
    .render(
      () => html`
      <div class="h-full min-h-[36rem] lg:min-h-auto overflow-hidden border rounded-lg p-4">
        <iframe class="w-full h-full" srcdoc="${buildSrcDoc()}"></iframe>
      </div>
    `,
    );

  return ilha
    .slot("editor", Editor)
    .slot("preview", Preview)
    .render(
      ({ slots }) => html`
        <div class="w-full lg:h-[100rem]">
          <div class="grid gap-4 h-full grid-cols-1 lg:grid-cols-2 grid-cols-none lg:grid-rows-2">
            <div class="overflow-hidden rounded-lg border p-4 flex flex-col">
              <h2 class="text-xl font-semibold shrink-0">Tutorials</h2>
              <div class="flex flex-col mt-4 overflow-auto">
                ${TUTORIAL_LIST.map((t) => html`<a href="${t.href}" class="${isActive(t.href) ? "btn-secondary" : "btn-ghost"} justify-start">${t.label}</a>`)}
              </div>
            </div>
            <div class="relative overflow-hidden rounded-lg border">
              <div class="h-full overflow-auto prose p-4 pb-16">${raw(contentHtml)}</div>
              <div class="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white via-white/80 to-transparent dark:from-gray-900 dark:via-gray-900/80"></div>
            </div>
            ${slots.editor()}
            ${slots.preview()}
          </div>
        </div>
      `,
    );
};
