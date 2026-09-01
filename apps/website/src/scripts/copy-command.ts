export function bindCopyCommandButtons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>("[data-copy-command]").forEach((button) => {
    if (button.dataset.copyBound === "1") return;
    button.dataset.copyBound = "1";
    button.addEventListener("click", async () => {
      const text =
        button.dataset.copyValue ?? button.querySelector("[data-copy-label]")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      const label = button.querySelector<HTMLElement>("[data-copy-label]");
      if (!label) return;
      const original = label.textContent;
      label.textContent = "Copied!";
      setTimeout(() => {
        label.textContent = original;
      }, 2000);
    });
  });
}
