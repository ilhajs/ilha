import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";

import { router } from "./rpc";

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export default {
  async fetch(request: Request) {
    const { response } = await handler.handle(request, {
      context: {},
    });
    return response;
  },
};
