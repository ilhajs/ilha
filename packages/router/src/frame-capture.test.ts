import { afterEach, describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { h } from "ilha";

import { __ilhaServerIsland } from "./server-island";
import { __ilhaServerAction, registerServerIsland, renderServerIsland } from "./ssr";

/** Run a render Effect to completion, rethrowing FrameError on failure. */
const runIsland = async (
  id: string,
  request: Request,
  incomingProps?: Record<string, unknown>,
): Promise<string> => {
  const result = await Effect.runPromise(
    Effect.result(renderServerIsland(id, request, (_request, fn) => fn(), incomingProps)),
  );
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
};

/**
 * End-to-end seam test: the frame HTML emitted by SSR capture
 * (`renderServerIsland` → `renderToString({ captureActions: true })`) must be
 * consumable by the client proxy (`__ilhaServerIsland`) without a hand-built
 * manifest. Locks the `template[data-ilha-actions]` / `data-ilha-on` contract
 * between `mount.ts` and `server-island.ts`.
 */

const SEAM_ID = "frame-capture-seam";

const del = __ilhaServerAction("x:del", async (id: string) => `deleted:${id}`);

function Tasks() {
  return h(
    "div",
    null,
    h("button", { type: "button", "data-task": "1", onclick: del.with("1") }, "Delete 1"),
    h("button", { type: "button", "data-task": "2", onclick: del.with("2") }, "Delete 2"),
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("frame capture seam (SSR → client proxy)", () => {
  it("emits sentinels and an actions manifest from a real island render", async () => {
    registerServerIsland(SEAM_ID, () => Tasks);
    const html = await runIsland(
      SEAM_ID,
      new Request("http://localhost/__ilha/frame", { method: "POST" }),
    );
    expect(html).toContain('data-ilha-on="click:0"');
    expect(html).toContain('data-ilha-on="click:1"');
    expect(html).toContain("data-ilha-actions");
    expect(html).not.toContain("onclick");
    // Manifest carries the bound args so the client can replay per-item calls.
    expect(html).toContain("x:del");
    expect(html).toContain("Delete 1");
  });

  it("wires real SSR frame HTML to client actions and repaints", async () => {
    registerServerIsland(SEAM_ID, () => Tasks);
    const html = await runIsland(
      SEAM_ID,
      new Request("http://localhost/__ilha/frame", { method: "POST" }),
    );

    const calls: unknown[][] = [];
    const frames: unknown[] = [];
    const Island = __ilhaServerIsland("seam-client", "div", {
      actions: {
        "x:del": (...args: unknown[]) => {
          calls.push(args);
        },
      },
      frame: (props) => {
        frames.push(props);
        return html;
      },
    });

    const host = document.createElement("div");
    // test host only; html is renderer output, not user input.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
    host.innerHTML = html;
    document.body.appendChild(host);

    Island.mount(host);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Wired but not fired.
    expect(calls).toEqual([]);
    expect(frames).toEqual([]);

    host.querySelector<HTMLElement>('button[data-task="2"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The manifest args flowed through: client called the action with "2",
    // then scheduled a frame repaint.
    expect(calls).toEqual([["2"]]);
    expect(frames).toHaveLength(1);
  });

  it("re-wires sentinels after a frame repaint with fresh args", async () => {
    let version = 0;
    registerServerIsland(SEAM_ID, () => Tasks);
    const html = await runIsland(
      SEAM_ID,
      new Request("http://localhost/__ilha/frame", { method: "POST" }),
    );
    const calls: unknown[][] = [];
    const Island = __ilhaServerIsland("seam-client-2", "div", {
      actions: {
        "x:del": (...args: unknown[]) => {
          calls.push(args);
        },
      },
      frame: () => {
        version++;
        return html;
      },
    });

    const host = document.createElement("div");
    // test host only; html is renderer output, not user input.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
    host.innerHTML = html;
    document.body.appendChild(host);
    Island.mount(host);

    host.querySelector<HTMLElement>('button[data-task="1"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Frame replaced the DOM; the new buttons must be wired from the fresh
    // manifest, not the stale one.
    host.querySelector<HTMLElement>('button[data-task="2"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual([["1"], ["2"]]);
    // One repaint per click.
    expect(version).toBe(2);
  });
});

describe("__ilhaServerAction runtime wrapper", () => {
  it("invokes the function when no capture is active", async () => {
    const seen: unknown[] = [];
    const act = __ilhaServerAction("x:probe", async (id: string) => {
      seen.push(id);
      return id;
    });
    await act("direct");
    expect(seen).toEqual(["direct"]);
  });

  it(".with() brands the handler for SSR serialization", async () => {
    const BRAND = Symbol.for("ilha.actionCall");
    const act = __ilhaServerAction("x:brand", async (id: string, _note: string) => id);
    const handler = act.with("7", "hi");
    expect(typeof handler).toBe("function");
    const branded = (handler as unknown as Record<symbol, { k: string; a: unknown[] }>)[BRAND];
    expect(branded).toEqual({ k: "x:brand", a: ["7", "hi"] });
    // Calling the handler on the server still reaches the function.
    await handler();
  });

  it("renderServerIsland fails with a 400 FrameError for unknown ids", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        renderServerIsland(
          "no-such-island",
          new Request("http://localhost/__ilha/frame", { method: "POST" }),
          (_request, fn) => fn(),
        ),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    const error = (result as { failure: { status: number; message?: string } }).failure;
    expect(error.status).toBe(400);
    expect(error.message).toContain("unknown island");
  });
});
