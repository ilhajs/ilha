import type { JSX } from "ilha/jsx-runtime";

function playgroundUrl(code: string): string {
  const url = new URL("https://playground.ilha.build");
  const BufferCtor = (
    globalThis as {
      Buffer?: { from: (v: string, enc: "utf8") => { toString: (enc: "base64") => string } };
    }
  ).Buffer;
  const b64 = BufferCtor
    ? BufferCtor.from(code, "utf8").toString("base64")
    : btoa(unescape(encodeURIComponent(code)));
  url.searchParams.set("code", b64);
  return url.toString();
}

/** Plain MDX component — ilha islands in MDX `default()` hung prerender on /tutorial/counter/state. */
export function Preview(props: { code: string; size?: "sm" | "lg" }): JSX.Element {
  const size = props.size;
  return (
    <div
      class={[
        "border-areia-border bg-areia-background flex h-100 w-full rounded-lg border",
        size === "sm" && "h-64!",
        size === "lg" && "h-160!",
      ]}
    >
      <iframe
        src={playgroundUrl(props.code)}
        title="ilha playground preview"
        class="flex-1 opacity-100"
      />
    </div>
  );
}
