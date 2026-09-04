/** Build a playground.ilha.build URL for a code sample. */
export const playgroundUrl = (code: string, mode?: "preview"): string => {
  const url = URL.parse("https://playground.ilha.build");
  if (!url) {
    return "https://playground.ilha.build";
  }
  url.searchParams.set("code", Buffer.from(code, "utf-8").toString("base64"));
  if (mode) {
    url.searchParams.set("mode", mode);
  }
  return url.toString();
};
