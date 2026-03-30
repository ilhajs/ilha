import RootLayout from "$routes/+layout";
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
    </head>
    <body>
      <script type="importmap">{"imports":{"ilha":"https://esm.sh/pr/ilha@main"}}</script>
      <script type="module">
        window.addEventListener("message", async ({ data }) => {
          if (data?.type !== "ilha:preview") return;

          // Tear down previous run
          document.body.innerHTML = data.template;

          // Re-run script as a blob module so it gets a fresh scope
          const blob = new Blob([data.script], { type: "text/javascript" });
          const url  = URL.createObjectURL(blob);
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

type TutorialLayoutProps = { content: string; code: Code };

const TutorialLayout = ({ content, code }: TutorialLayoutProps) => {
  const template = ilha.context("tutorial.template", code.template);
  const script = ilha.context("tutorial.script", code.script);
  const contentHtml = md.render(content);

  const Editor = ilha
    // .bind("[data-template]", template)
    // .bind("[data-script]", script)
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
        <div class="flex flex-1 flex-col gap-2">
          <div class="tabs w-full" id="demo-tabs-with-panels">
            <nav role="tablist" aria-orientation="horizontal" class="w-full">
              <button type="button" role="tab" aria-selected="true" tabindex="0" data-tab="script">
                Script
              </button>
              <button type="button" role="tab" aria-selected="false" tabindex="0" data-tab="template">
                Template
              </button>
            </nav>
          </div>
          <div id="editor" class="rounded-lg border"></div>
        </div>
      `,
    );

  const Preview = ilha
    .effect(({ host }) => {
      const iframe = host.querySelector<HTMLIFrameElement>("iframe")!;

      const buildMessage = () => ({
        type: "ilha:preview",
        template: template(),
        script: script(),
      });

      const send = () => {
        iframe.contentWindow?.postMessage(buildMessage(), "*");
      };

      iframe.addEventListener("load", send, { once: true });

      // On subsequent signal changes, post directly
      const stop = effect(() => {
        if (iframe.contentDocument?.readyState === "complete") {
          iframe.contentWindow?.postMessage(buildMessage(), "*");
        }
      });

      return stop;
    })
    .render(
      () => html`
        <div class="flex-1 border rounded-lg">
          <iframe srcdoc="${buildSrcDoc()}"></iframe>
        </div>
      `,
    );

  return ilha
    .slot("editor", Editor)
    .slot("preview", Preview)
    .render(
      ({ slots }) => html`
        <div class="flex flex-1">
          <div class="flex-1 prose">${raw(contentHtml)}</div>
          <div class="flex flex-1 flex-col gap-2">
            ${slots.editor()}
            ${slots.preview()}
          </div>
        </div>
      `,
    );
};

export default (props: TutorialLayoutProps) => RootLayout(TutorialLayout(props));
