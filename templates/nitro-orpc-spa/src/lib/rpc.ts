import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import type { router } from "../rpc";

const link = new RPCLink({
  origin: typeof window === "undefined" ? undefined : window.location.origin,
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const client: RouterClient<typeof router> = createORPCClient(link);
