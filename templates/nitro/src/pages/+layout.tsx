import { isActive, defineLayout } from "@ilha/router";
import { LinkButton } from "areia";
import ilha from "ilha";

export default defineLayout((children) =>
  ilha.render(() => (
    <div class="mt-2 flex flex-col gap-2">
      <nav class="container mx-auto flex max-w-xl items-center gap-2">
        <LinkButton href="/" variant={isActive("/") ? "secondary" : "ghost"}>
          Home
        </LinkButton>
        <LinkButton href="/learn" variant={isActive("/learn") ? "secondary" : "ghost"}>
          Learn
        </LinkButton>
      </nav>
      <main class="container mx-auto max-w-xl">{children}</main>
    </div>
  )),
);
