/**
 * StackBlitz WebContainer detection for AsyncLocalStorage fallbacks.
 * Safe to import from browser-shared modules: on the client this always
 * returns false (no `process.versions.webcontainer`).
 */

let webcontainerOverride: boolean | null = null;

/** StackBlitz sets `process.versions.webcontainer` inside WebContainers. */
export const inWebcontainer = (): boolean => {
  if (webcontainerOverride !== null) {
    return webcontainerOverride;
  }
  try {
    // SAFETY: `process` is Node/SSR-only; browser shims omit `versions.webcontainer`.
    const versions = (
      globalThis as {
        process?: {
          versions?: NodeJS.ProcessVersions & { webcontainer?: string };
        };
      }
    ).process?.versions;
    return Boolean(versions?.webcontainer);
  } catch {
    return false;
  }
};

/** Test-only: force or clear the WebContainer detection path. */
export const __setInWebcontainerForTests = (value: boolean | null): void => {
  webcontainerOverride = value;
};
