/** Build a playground.ilha.build URL for a code sample. */
export function playgroundUrl(code: string, mode?: "preview"): string {
  const url = new URL("https://playground.ilha.build");
  url.searchParams.set("code", Buffer.from(code, "utf8").toString("base64"));
  if (mode) url.searchParams.set("mode", mode);
  return url.toString();
}
