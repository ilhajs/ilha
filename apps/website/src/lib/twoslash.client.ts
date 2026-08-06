/**
 * Place Twoslash hover cards next to the hovered token.
 *
 * Cards use `position: fixed` so they escape figure/pre overflow clipping
 * (needed for horizontal code scroll). CSS alone cannot anchor fixed boxes
 * to a token, so we sync `--twoslash-left/top` from the token's viewport box.
 */
import { mount } from "@cloudflare/nimbus-docs/client";

const GAP = 8;
const EDGE = 8;
const HOVER_SEL = ".twoslash-hover, .twoslash-error-hover, .twoslash-query-persisted";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function popupFor(anchor: HTMLElement): HTMLElement | null {
  // Prefer the direct card; fall back for renderer markup variants.
  return (
    anchor.querySelector<HTMLElement>(":scope > .twoslash-popup-container") ??
    anchor.querySelector<HTMLElement>(".twoslash-popup-container")
  );
}

function placePopup(anchor: HTMLElement, popup: HTMLElement) {
  const ar = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Tentative place so layout can resolve max-width / wrapping.
  popup.style.setProperty("--twoslash-left", `${Math.round(ar.left)}px`);
  popup.style.setProperty("--twoslash-top", `${Math.round(ar.bottom + GAP)}px`);

  const pr = popup.getBoundingClientRect();
  const width = pr.width || Math.min(320, vw - EDGE * 2);
  const height = pr.height || Math.min(200, vh - EDGE * 2);

  const spaceBelow = vh - ar.bottom - EDGE;
  const spaceAbove = ar.top - EDGE;
  const preferBelow = spaceBelow >= Math.min(height, 120) || spaceBelow >= spaceAbove;

  const left = clamp(ar.left, EDGE, vw - width - EDGE);
  let top = preferBelow ? ar.bottom + GAP : ar.top - height - GAP;

  if (preferBelow && top + height > vh - EDGE) {
    top = clamp(ar.top - height - GAP, EDGE, vh - height - EDGE);
  } else if (!preferBelow && top < EDGE) {
    top = clamp(ar.bottom + GAP, EDGE, vh - height - EDGE);
  }

  top = clamp(top, EDGE, Math.max(EDGE, vh - height - EDGE));

  popup.style.setProperty("--twoslash-left", `${Math.round(left)}px`);
  popup.style.setProperty("--twoslash-top", `${Math.round(top)}px`);
}

function initTwoslashFigure(root: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  let active: { anchor: HTMLElement; popup: HTMLElement } | null = null;
  let raf = 0;

  const reposition = () => {
    if (!active) return;
    placePopup(active.anchor, active.popup);
  };

  const schedulePlace = (anchor: HTMLElement, popup: HTMLElement) => {
    active = { anchor, popup };
    placePopup(anchor, popup);
    // Second pass after paint — wrapped signatures change height once visible.
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (active?.popup === popup) placePopup(anchor, popup);
    });
  };

  const activateFrom = (node: EventTarget | null) => {
    if (!(node instanceof Element)) return;
    const anchor = node.closest<HTMLElement>(HOVER_SEL);
    if (!anchor || !root.contains(anchor)) return;
    const popup = popupFor(anchor);
    if (!popup) return;
    schedulePlace(anchor, popup);
  };

  // `pointerover` bubbles (unlike pointerenter), so one root listener is enough.
  root.addEventListener("pointerover", (event) => activateFrom(event.target), {
    signal,
  });

  root.addEventListener(
    "pointerout",
    (event) => {
      if (!active) return;
      const next = event.relatedTarget;
      if (next instanceof Node) {
        if (active.anchor.contains(next) || active.popup.contains(next)) return;
      }
      // Leaving the token/card pair.
      if (event.target instanceof Node && active.anchor.contains(event.target)) {
        active = null;
      }
    },
    { signal },
  );

  root.addEventListener("focusin", (event) => activateFrom(event.target), { signal });

  const pre = root.querySelector("pre.astro-code");
  pre?.addEventListener("scroll", reposition, { signal, passive: true });
  window.addEventListener("scroll", reposition, { signal, passive: true, capture: true });
  window.addEventListener("resize", reposition, { signal, passive: true });

  root.querySelectorAll<HTMLElement>(".twoslash-query-persisted").forEach((anchor) => {
    const popup = popupFor(anchor);
    if (popup) placePopup(anchor, popup);
  });

  return () => {
    cancelAnimationFrame(raf);
    controller.abort();
  };
}

mount(".nb-code-figure.twoslash", initTwoslashFigure);
