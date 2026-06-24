/** Source samples for landing code panels — highlighted by `scripts/generate-landing-code-html.ts`. */

import {
  COUNTER_CODE,
  ILHA_ROUTER_CODE,
  ILHA_STORE_CODE,
  RENDERING_CODE,
  SIGNALS_CODE,
} from "./landing-const";

export const LANDING_HIGHLIGHT_THEMES = {
  light: "night-owl-light",
  dark: "houston",
} as const;

export const landingHighlightSnippets = {
  syntax: { lang: "tsx", code: COUNTER_CODE },
  signals: { lang: "tsx", code: SIGNALS_CODE },
  rendering: { lang: "tsx", code: RENDERING_CODE },
  routing: { lang: "tsx", code: ILHA_ROUTER_CODE },
  store: { lang: "tsx", code: ILHA_STORE_CODE },
} as const;

export type LandingHighlightId = keyof typeof landingHighlightSnippets;
