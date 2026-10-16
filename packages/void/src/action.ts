import { createActionClient } from "void/pages-client";
import type { ActionClient } from "void/pages-client";

const client = createActionClient();

/** Call a page action; uses the Void Router once a regular page hydrates. */
export const action: ActionClient["action"] = client.action;
export const setActionRouter: ActionClient["setActionRouter"] =
  client.setActionRouter;
