import { isActive, defineLayout, head } from "@ilha/router";
import { LinkButton } from "areia";
import ilha from "ilha";

export default defineLayout((Children) =>
  ilha.render(({ input }) => {
    head({
      titleTemplate: (title) => (title ? `${title} · Ilha + Nitro` : "Ilha + Nitro"),
      meta: [{ name: "description", content: "An Ilha app running on Nitro." }],
    });
    return (
      <div class="mt-2 flex flex-col gap-2">
        <nav class="container mx-auto flex max-w-xl items-center gap-2">
          <LinkButton href="/" variant={isActive("/") ? "secondary" : "ghost"}>
            Home
          </LinkButton>
          <LinkButton href="/learn" variant={isActive("/learn") ? "secondary" : "ghost"}>
            Learn
          </LinkButton>
        </nav>
        <main class="container mx-auto max-w-xl">{Children(input)}</main>
      </div>
    );
  }),
);
