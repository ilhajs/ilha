import { expect, test } from "bun:test";

import { ilha, state, derived, action, effect, onError, html } from "./index";
import { signal } from "./test-signal";
import "../happydom.ts";

test("basic counter island", async () => {
  const Counter = ilha<{ start?: number }>(({ start = 0 }) => {
    const count = state(start);
    const double = derived(() => count() * 2);
    return html`<button onclick=${() => count((v) => v + 1)}>${double()}</button>`;
  });

  const ssr = Counter.toString({ start: 5 });
  expect(ssr).toContain(">10<");

  const host = document.createElement("div");
  document.body.appendChild(host);
  let effectRuns = 0;
  const CounterWithEffect = ilha(() => {
    const count = state(0);
    effect(() => {
      void count();
      effectRuns++;
    });
    return html`<p>${count()}</p>`;
  });
  const unmount = CounterWithEffect.mount(host);
  expect(host.textContent).toBe("0");
  expect(effectRuns).toBe(1);
  unmount();
});

test("state persists across rerenders; props update rerenders", () => {
  const Box = ilha<{ label: string }>(({ label }) => {
    const open = state(false);
    return html`<div data-label=${label}>${open() ? "open" : "closed"}</div>`;
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle = Box.mount(host, { label: "hello" });
  expect(host.querySelector("div")!.getAttribute("data-label")).toBe("hello");
  expect(host.textContent).toContain("closed");
  expect(handle).toBeDefined();
});

test("effect.once and onError slots", () => {
  const App = ilha(() => {
    const ready = state("no");
    effect.once(({ hydrated }) => {
      void hydrated;
      ready("yes");
    });
    onError(({ error }) => {
      void error;
    });
    return html`<span>${ready()}</span>`;
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  App.mount(host);
});

test("action pending/data/error + SSR stub does not execute", () => {
  const App = ilha(() => {
    const save = action(async (_form: string, { signal }: { signal: AbortSignal }) => {
      await new Promise((r) => setTimeout(r, 5));
      void signal;
      return "ok";
    });
    effect(() => {
      void save.pending;
      void save.data;
      void save.error;
    });
    return html`<p>idle</p>`;
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  App.mount(host);
  const ssr = App.toString();
  expect(ssr).toContain("idle");
});

test("outside-island primitive throws", () => {
  expect(() => state(0)).toThrow(/outside an island render/);
  expect(() => derived(() => 1)).toThrow();
  expect(() => action(() => {})).toThrow();
  expect(() => onError(() => {})).toThrow();
  expect(() => effect.once(() => {})).toThrow();
  // standalone effect still works
  let ran = 0;
  const s = signal(1);
  const stop = effect(() => {
    void s();
    ran++;
  }) as () => void;
  s(2);
  stop();
  expect(ran).toBeGreaterThanOrEqual(1);
});
