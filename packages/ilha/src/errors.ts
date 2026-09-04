import * as Option from "effect/Option";
import * as Result from "effect/Result";

// SAFETY: this is the error-normalization boundary — thrown values arrive with
// no schema, so the parameter is the caller's own thrown type and the Result is
// the domain type.
export const asFailure = <T>(e: T): Result.Result<never, Error> => {
  if (Result.isResult(e) && Result.isFailure(e)) {
    const v = Option.getOrUndefined(Result.getFailure(e));
    return Result.fail(v instanceof Error ? v : new Error(String(v)));
  }
  return Result.fail(e instanceof Error ? e : new Error(String(e)));
};

export const failureMessage = <T>(e: T): string =>
  asFailure(e).pipe(
    Result.match({
      onFailure: (err) => err.message,
      onSuccess: () => "error",
    })
  );
