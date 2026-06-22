/**
 * Compile-time: async actions may return Partial<TState>, void, or Promise thereof.
 */
import { store } from "./index";

type LoginState = { step: "requestOtp" | "verifyOtp"; email: string };

const form = store<LoginState>({ step: "requestOtp", email: "" })
  .action("submit", async (_, { get }) => {
    const { step } = get();
    if (step === "requestOtp") {
      await Promise.resolve();
      return void 0;
    }
    return { step: "verifyOtp" as const };
  })
  .build();

form.submit();
