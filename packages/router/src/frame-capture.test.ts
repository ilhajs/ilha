import { afterEach, describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { h } from "ilha";

import { __ilhaServerIsland } from "./server-island";
import {
  __ilhaServerAction,
  registerServerIsland,
  renderServerIsland,
} from "./ssr";

const ACTION_CALL = Symbol.for("ilha.actionCall");
const ACTION_KEY = Symbol.for("oxidejs.actionKey");

interface ActionCallBrand {
  readonly a: readonly string[];
  readonly k: string;
}

type ActionHandle<A extends unknown[], R> = ((...args: A) => R) & {
  $$atom: 1;
  atom: undefined;
  bind: (...args: A) => ((...ev: unknown[]) => R) & {
    [ACTION_CALL]?: ActionCallBrand;
  };
  set: (...args: A) => R;
  with: (...args: A) => ReturnType<ActionHandle<A, R>["bind"]>;
  [ACTION_KEY]?: string;
};

const testAction = <A extends unknown[], R>(
  fn: (...args: A) => R
): ActionHandle<A, R> => {
  const handle: ActionHandle<A, R> = Object.assign(
    (...args: A) => fn(...args),
    {
      $$atom: 1 as const,
      atom: undefined,
      bind(...args: A) {
        const key = handle[ACTION_KEY];
        // SAFETY: event handler is a branded callable carrying ACTION_CALL metadata.
        const handler = ((..._ev: unknown[]) => fn(...args)) as ((
          ...ev: unknown[]
        ) => R) & {
          [ACTION_CALL]?: ActionCallBrand;
        };
        if (key) {
          // SAFETY: test actions bind string args; brand payload mirrors oxide stamps.
          handler[ACTION_CALL] = { a: args as readonly string[], k: key };
        }
        return handler;
      },
      set: (...args: A) => fn(...args),
      with(...args: A) {
        return handle.bind(...args);
      },
    }
  );
  return handle;
};

/** Run a render Effect to completion, rethrowing FrameError on failure. */
const runIsland = async (id: string, request: Request): Promise<string> => {
  const result = await Effect.runPromise(
    Effect.result(renderServerIsland(id, request, (_request, fn) => fn()))
  );
  if (Result.isFailure(result)) {
    throw result.failure;
  }
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

const del = __ilhaServerAction(
  "x:del",
  testAction((id: string) => `deleted:${id}`)
);

const Tasks = () =>
  h(
    "div",
    null,
    h(
      "button",
      { "data-task": "1", onclick: del.bind("1"), type: "button" },
      "Delete 1"
    ),
    h(
      "button",
      { "data-task": "2", onclick: del.bind("2"), type: "button" },
      "Delete 2"
    )
  );

afterEach(() => {
  document.body.replaceChildren();
});

const clickTask = (host: HTMLElement, task: string) => {
  const button = host.querySelector(`button[data-task="${task}"]`);
  expect(button).toBeInstanceOf(HTMLElement);
  if (!(button instanceof HTMLElement)) {
    return;
  }
  button.click();
};

describe("frame capture seam (SSR → client proxy)", () => {
  it("emits sentinels and an actions manifest from a real island render", async () => {
    registerServerIsland(SEAM_ID, () => Tasks);
    const html = await runIsland(
      SEAM_ID,
      new Request("http://localhost/__ilha/frame", { method: "POST" })
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
      new Request("http://localhost/__ilha/frame", { method: "POST" })
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
    document.body.append(host);

    Island.mount(host);
    await Bun.sleep(0);

    // Wired but not fired.
    expect(calls).toEqual([]);
    expect(frames).toEqual([]);

    clickTask(host, "2");
    await Bun.sleep(0);
    await Bun.sleep(0);

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
      new Request("http://localhost/__ilha/frame", { method: "POST" })
    );
    const calls: unknown[][] = [];
    const Island = __ilhaServerIsland("seam-client-2", "div", {
      actions: {
        "x:del": (...args: unknown[]) => {
          calls.push(args);
        },
      },
      frame: () => {
        version += 1;
        return html;
      },
    });

    const host = document.createElement("div");
    // test host only; html is renderer output, not user input.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
    host.innerHTML = html;
    document.body.append(host);
    Island.mount(host);

    clickTask(host, "1");
    await Bun.sleep(0);
    await Bun.sleep(0);

    // Frame replaced the DOM; the new buttons must be wired from the fresh
    // manifest, not the stale one.
    clickTask(host, "2");
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(calls).toEqual([["1"], ["2"]]);
    // One repaint per click.
    expect(version).toBe(2);
  });
});

describe("__ilhaServerAction runtime wrapper", () => {
  it("invokes the function when no capture is active", async () => {
    const seen: unknown[] = [];
    const act = __ilhaServerAction(
      "x:probe",
      testAction((id: string) => {
        seen.push(id);
        return id;
      })
    );
    await act("direct");
    expect(seen).toEqual(["direct"]);
  });

  it(".bind() brands the handler for SSR serialization", async () => {
    const BRAND = Symbol.for("ilha.actionCall");
    const act = __ilhaServerAction(
      "x:brand",
      testAction((id: string, _note: string) => id)
    );
    const handler = act.bind("7", "hi");
    expect(Object.prototype.toString.call(handler)).toBe("[object Function]");
    // SAFETY: bind() stamps the ilha.actionCall brand onto the returned handler.
    const branded = (handler as { [BRAND]?: ActionCallBrand })[BRAND];
    expect(branded).toEqual({ a: ["7", "hi"], k: "x:brand" });
    await handler();
  });

  it("renderServerIsland fails with a 400 FrameError for unknown ids", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        renderServerIsland(
          "no-such-island",
          new Request("http://localhost/__ilha/frame", { method: "POST" }),
          (_request, fn) => fn()
        )
      )
    );
    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) {
      return;
    }
    expect(result.failure.status).toBe(400);
    expect(result.failure.message).toContain("unknown island");
  });
});
