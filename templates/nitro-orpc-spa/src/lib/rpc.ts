import { createORPCClient, onError } from "@orpc/client";
import type { JsonifiedClient } from "@orpc/openapi";
import { OpenAPILink } from "@orpc/openapi/fetch";
import type { RouterClient } from "@orpc/server";

import { router } from "../rpc";

const link = new OpenAPILink(router, {
  origin: window.location.origin,
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const client: JsonifiedClient<RouterClient<typeof router>> = createORPCClient(link);
