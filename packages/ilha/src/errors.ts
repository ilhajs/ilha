import * as Option from "effect/Option";
import * as Result from "effect/Result";

export function asFailure(e: unknown): Result.Result<never, Error> {
  if (Result.isResult(e) && Result.isFailure(e)) {
    const v = Option.getOrUndefined(Result.getFailure(e));
    return Result.fail(v instanceof Error ? v : new Error(String(v)));
  }
  return Result.fail(e instanceof Error ? e : new Error(String(e)));
}

export function failureMessage(e: unknown): string {
  return asFailure(e).pipe(
    Result.match({
      onSuccess: () => "error",
      onFailure: (err) => err.message,
    }),
  );
}
