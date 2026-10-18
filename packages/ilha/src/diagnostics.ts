/** Stable diagnostic codes. Each one has a page at `https://ilha.build/errors/<code>`. */
export type IlhaCode =
  | "ILHA001"
  | "ILHA002"
  | "ILHA003"
  | "ILHA004"
  | "ILHA005"
  | "ILHA006"
  | "ILHA007";

const DOCS_ORIGIN = "https://ilha.build/errors";

const CATALOG: Record<IlhaCode, { message: string; fix: string }> = {
  ILHA001: {
    fix: "Call atom(), watch(), when() and context() at the top level of a component rendered through mount() or renderToString().",
    message: "A primitive was called with no active component",
  },
  ILHA002: {
    fix: "Call atom() and watch() unconditionally and in the same order on every render; move conditions inside the primitive.",
    message: "The number of atom/watch slots changed between renders",
  },
  ILHA003: {
    fix: "Pass the value or a prop to the other island, or share state with createContext() and context().",
    message: "An atom handle was used from a different island",
  },
  ILHA004: {
    fix: "Yield one instruction at a time and let it finish before the generator resumes.",
    message: "A generator component resumed while an instruction was in flight",
  },
  ILHA005: {
    fix: "Give every keyed component a unique key within its parent component.",
    message: "Two sibling components use the same key",
  },
  ILHA006: {
    fix: "Render the same component on the server and the client, and keep primitive order stable.",
    message: "Hydration mismatch, falling back to a full mount",
  },
  ILHA007: {
    fix: "Do not interpolate untrusted text into <script> or <style>; serialize data as JSON with the closing tag escaped.",
    message: "Unsafe raw text in a <script> or <style> element",
  },
};

/** Error thrown by ilha with a stable `code`, a `fix` hint and a `docs` URL. */
export class IlhaError extends Error {
  readonly code: IlhaCode;
  readonly fix: string;
  readonly docs: string;

  constructor(code: IlhaCode, detail?: string) {
    const { message, fix } = CATALOG[code];
    const docs = `${DOCS_ORIGIN}/${code}`;
    const head = detail ? `${message} (${detail})` : message;
    super(`[${code}] ${head}. Fix: ${fix} See ${docs}`);
    this.name = "IlhaError";
    this.code = code;
    this.fix = fix;
    this.docs = docs;
  }
}

/** Build an {@link IlhaError} for `code`. */
export const ilhaError = (code: IlhaCode, detail?: string): IlhaError =>
  new IlhaError(code, detail);

const warned = new Set<string>();

/** Warn once per `code` + `detail` through `console.warn`. */
export const ilhaWarn = (code: IlhaCode, detail?: string): void => {
  const id = `${code}:${detail ?? ""}`;
  if (warned.has(id)) {
    return;
  }
  warned.add(id);
  console.warn(ilhaError(code, detail).message);
};

/** Forget which warnings were already shown (tests only; not part of the public API). */
export const resetIlhaWarnings = (): void => {
  warned.clear();
};
