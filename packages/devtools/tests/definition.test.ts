import { describe, expect, it } from "bun:test";

import { ilhaDevtools } from "../src/index.ts";
import { ILHA_DEVTOOLS_CHANNEL } from "../src/protocol.ts";

describe("devframe definition", () => {
  it("describes the package", () => {
    expect(ilhaDevtools.id).toBe("ilha-devtools");
    expect(ilhaDevtools.packageName).toBe("@ilha/devtools");
    expect(ilhaDevtools.version).toMatch(/^\d+\.\d+\.\d+/u);
    expect(ilhaDevtools.basePath).toBe("/__ilha-devtools/");
  });

  it("serves the built panel from dist/spa", () => {
    expect(ilhaDevtools.clientAssets).toEndWith("/dist/spa");
  });

  it("registers a docs gateway tool for agents", async () => {
    const registered: { id: string; handler: () => object }[] = [];
    await ilhaDevtools.setup(
      // SAFETY: the test only exercises `ctx.agent.registerTool`.
      {
        agent: { registerTool: (tool: never) => registered.push(tool) },
      } as never,
      // SAFETY: setup ignores its second argument.
      {} as never
    );
    expect(registered.map((tool) => tool.id)).toEqual(["ilha-devtools:docs"]);
    expect(registered[0]?.handler()).toMatchObject({
      channel: ILHA_DEVTOOLS_CHANNEL,
    });
  });
});
