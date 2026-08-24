import { isActive, defineLayout, head } from "@ilha/router";
import { LinkButton } from "areia";
import { Toaster } from "areia/sonner";
import { ilha } from "ilha";

export default defineLayout((Children) =>
  ilha(({ input }) => {
    head({ titleTemplate: (title) => `${title} · Ilha + Oxide` });
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
        <main class="container mx-auto max-w-xl">
          <Children {...input} />
        </main>
        <Toaster />
      </div>
    );
  }),
);
