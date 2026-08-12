import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";

import { router } from "./rpc";

const handler = new OpenAPIHandler(router, {
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
