export function toast(text: string) {
  document.dispatchEvent(
    new CustomEvent("basecoat:toast", {
      detail: {
        config: {
          category: "success",
          title: text,
        },
      },
    }),
  );
}
