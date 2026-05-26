import { isActive, defineLayout } from "@ilha/router";
import ilha from "ilha";

export default defineLayout((children) =>
  ilha.render(() => (
    <>
      <nav class="navbar x-stack container">
        <a href="/" class="button" data-variant={isActive("/") ? "secondary" : "ghost"}>
          Home
        </a>
        <a href="/learn" class="button" data-variant={isActive("/learn") ? "secondary" : "ghost"}>
          Learn
        </a>
      </nav>
      <main class="container">{children}</main>
    </>
  )),
);
