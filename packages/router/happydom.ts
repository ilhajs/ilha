import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({
  settings: {
    fetch: {
      interceptor: {
        beforeAsyncRequest() {
          // SAFETY: happy-dom types this hook narrower than the Response it
          // consumes; an empty 200 Response satisfies the runtime contract.
          return new Response("", { status: 200 }) as never;
        },
      },
    },
  },
});
