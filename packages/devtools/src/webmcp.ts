/**
 * Mirror the page functions onto the browser's WebMCP model context, so an
 * agent driving the page can call them without any dev server. A no-op when
 * the browser provides no model context.
 */
import type { IlhaInspectNode, SetAtomResult } from "ilha/debug";

import type { AtomJson, ModelLogResult } from "./protocol";

export interface PageTools {
  inspect: () => IlhaInspectNode[];
  highlight: (id: string | null) => boolean;
  setAtom: (id: string, index: number, value: AtomJson) => SetAtomResult;
  modelLog: (id: string) => ModelLogResult;
}

interface FoundResult {
  found: boolean;
}

interface WebMcpResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

interface ToolSchema {
  type: "object";
  properties: Record<string, { type?: string | string[] }>;
  required?: string[];
}

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  annotations: { title: string; readOnlyHint: boolean };
  execute: (args: ToolArgs) => WebMcpResult;
}

interface ToolArgs {
  id?: string | null;
  index?: number;
  value?: AtomJson;
}

interface WebMcpRegistration {
  unregister?: () => void;
}

interface ModelContextLike {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal: AbortSignal }
  ) => WebMcpRegistration | undefined;
}

/** What WebMCP drafts add to `document` and `navigator`. */
interface ModelContextHost {
  modelContext?: ModelContextLike;
}

const noop = (): void => {
  /* nothing to undo */
};

const isFunction = <T>(value: T): value is T & ((...args: never[]) => void) =>
  typeof value === "function";

const isModelContext = (
  value: ModelContextLike | undefined
): value is ModelContextLike =>
  value !== undefined && isFunction(value.registerTool);

/** `document.modelContext` (current draft), else `navigator.modelContext`. */
const resolveModelContext = (): ModelContextLike | undefined => {
  // SAFETY: WebMCP drafts add an optional `modelContext` to these hosts.
  const hosts: ModelContextHost[] = [
    "document" in globalThis ? (document as ModelContextHost) : {},
    "navigator" in globalThis ? (navigator as ModelContextHost) : {},
  ];
  return hosts.map((host) => host.modelContext).find(isModelContext);
};

const text = (
  value: IlhaInspectNode[] | SetAtomResult | FoundResult | ModelLogResult
): WebMcpResult => ({
  content: [{ text: JSON.stringify(value, null, 2), type: "text" }],
});

const fail = (message: string): WebMcpResult => ({
  content: [{ text: message, type: "text" }],
  isError: true,
});

const isString = <T>(value: T): value is T & string =>
  typeof value === "string";

const isNumber = <T>(value: T): value is T & number =>
  typeof value === "number";

const buildTools = ({
  inspect,
  highlight,
  setAtom,
  modelLog,
}: PageTools): WebMcpTool[] => [
  {
    annotations: { readOnlyHint: true, title: "Inspect Ilha islands" },
    description:
      "List every live Ilha island on this page as a JSON tree: component names, atom values by slot index, child components, and host selectors. Call this first to learn which ids exist.",
    execute: () => text(inspect()),
    inputSchema: { properties: {}, type: "object" },
    name: "ilha_inspect",
  },
  {
    annotations: { readOnlyHint: false, title: "Highlight an Ilha component" },
    description:
      "Outline a component's element on the page. Pass an id from ilha_inspect, or null to clear the outline.",
    execute: ({ id }) =>
      id === null || isString(id)
        ? text({ found: highlight(id) })
        : fail("id must be a string from ilha_inspect, or null."),
    inputSchema: {
      properties: { id: { type: ["string", "null"] } },
      required: ["id"],
      type: "object",
    },
    name: "ilha_highlight",
  },
  {
    annotations: { readOnlyHint: false, title: "Set an Ilha atom" },
    description:
      "Replace one atom's value in a live component with a JSON value and let it rerender. Use the id and atom index from ilha_inspect. Derived and Effect atoms are read-only.",
    execute: ({ id, index, value }) =>
      isString(id) && isNumber(index) && value !== undefined
        ? text(setAtom(id, index, value))
        : fail("Pass id (string), index (number), and value (JSON)."),
    inputSchema: {
      properties: {
        id: { type: "string" },
        index: { type: "integer" },
        value: {},
      },
      required: ["id", "index", "value"],
      type: "object",
    },
    name: "ilha_set_atom",
  },
  {
    annotations: { readOnlyHint: true, title: "Read an island's message log" },
    description:
      "Read one model island's recorded messages: each message, the model fields it changed, and how many commands it started. Pass an id from ilha_inspect. Islands that are not model apps, or have nothing recorded, return ok:false with a reason.",
    execute: ({ id }) =>
      isString(id)
        ? text(modelLog(id))
        : fail("Pass id (a string from ilha_inspect)."),
    inputSchema: {
      properties: { id: { type: "string" } },
      required: ["id"],
      type: "object",
    },
    name: "ilha_model_log",
  },
];

/** Register the tools; returns a dispose that removes them. */
export const registerWebMcpTools = (tools: PageTools): (() => void) => {
  const context = resolveModelContext();
  if (!context) {
    return noop;
  }
  const controller = new AbortController();
  const registrations = buildTools(tools).map((tool) =>
    context.registerTool(tool, { signal: controller.signal })
  );
  return () => {
    controller.abort();
    for (const registration of registrations) {
      registration?.unregister?.();
    }
  };
};
