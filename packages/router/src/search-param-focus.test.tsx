import { afterEach, expect, it } from "bun:test";

import { h } from "ilha";

import { router, searchParam } from "./index";

afterEach(() => {
  history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

const SearchBox = () => {
  const q = searchParam("q", { default: "" });
  return h(
    "div",
    null,
    h("input", {
      id: "s",
      oninput: (e: Event) => {
        // SAFETY: the handler is bound to the input element.
        q.set((e.currentTarget as HTMLInputElement).value);
      },
      type: "search",
      value: q(),
    }),
    h("p", null, `q=${q()}`)
  );
};
const Page = () =>
  // SAFETY: h() types its first argument for tags; SearchBox is a component.
  h("section", null, h(SearchBox as never, null));

it("keeps focus on an input bound to a search param while typing", async () => {
  window.location.href = "http://localhost/a";
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = router().route("/a", Page).mount(host);
  await Bun.sleep(20);

  const input = host.querySelector<HTMLInputElement>("#s");
  if (!input) {
    throw new Error("input missing");
  }
  // Each keystroke must settle before the next one: typing is sequential.
  const type = async (value: string): Promise<void> => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Bun.sleep(20);
    expect(host.querySelector("#s")).toBe(input);
    expect(document.activeElement).toBe(input);
  };
  input.focus();
  await type("a");
  await type("ab");
  await type("abc");
  expect(window.location.search).toBe("?q=abc");
  unmount();
});
