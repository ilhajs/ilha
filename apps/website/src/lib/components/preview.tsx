import ilha from "ilha";

function encodePlaygroundCode(code: string): string {
  const BufferCtor = (
    globalThis as {
      Buffer?: { from: (v: string, enc: "utf8") => { toString: (enc: "base64") => string } };
    }
  ).Buffer;
  if (BufferCtor) return BufferCtor.from(code, "utf8").toString("base64");
  return btoa(unescape(encodeURIComponent(code)));
}

export const Preview = ilha
  .input<{ code: string; size?: "sm" | "lg" }>()
  .state("loaded", false)
  .derived("url", ({ input }) => {
    const url = new URL("https://playground.ilha.build");
    url.searchParams.set("code", encodePlaygroundCode(input.code));
    return url.toString();
  })
  .on("iframe@load", ({ state }) => state.loaded(true))
  .onMount(({ host, state }) => {
    const markLoaded = () => state.loaded(true);
    const frame = host.querySelector("iframe");
    if (!frame) return;

    // Cross-origin playground embeds often never reach a state where ilha's
    // delegated load listener runs (e.g. cached document, bfcache, morph).
    try {
      if (frame.contentWindow?.document?.readyState === "complete") {
        markLoaded();
      }
    } catch {
      // cross-origin — rely on load event or fallback below
    }

    const fallback = window.setTimeout(markLoaded, 2500);
    return () => window.clearTimeout(fallback);
  })
  .effect(({ state, derived }) => {
    state.loaded(false);
    void derived.url();
  })
  .render(({ derived, state, input }) => (
    <div
      class={[
        "border-areia-border bg-areia-background flex h-100 w-full rounded-lg border",
        input.size === "sm" && "h-64!",
        input.size === "lg" && "h-160!",
      ]}
    >
      <iframe
        key={derived.url}
        src={derived.url}
        title="ilha playground preview"
        class={[
          "flex-1 transition-opacity duration-200",
          state.loaded() ? "opacity-100" : "opacity-0",
        ]}
      ></iframe>
    </div>
  ));
