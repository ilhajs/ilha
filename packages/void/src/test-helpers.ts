import type { PageComponent, PageModule } from "./app";

/** A manifest loader that resolves to `component`. */
export const pageModule =
  (component: PageComponent) => (): Promise<PageModule> =>
    Promise.resolve({ default: component });

export const parseDocument = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

/** Let atom updates, paints, and mocked fetches settle. */
export const settle = (): Promise<void> => Bun.sleep(30);

interface HappyDomWindow {
  happyDOM: { setURL: (url: string) => void };
}

/** Move the happy-dom document to `url`; it starts at `about:blank`. */
export const setLocation = (url: string): void => {
  if (!("happyDOM" in window)) {
    throw new Error("setLocation needs the happy-dom test preload.");
  }
  // SAFETY: the happy-dom preload installs `window.happyDOM`.
  (window as typeof window & HappyDomWindow).happyDOM.setURL(url);
};
