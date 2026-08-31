import { head, isActive } from "@ilha/router";
import type { View } from "ilha";

export default function Layout({ children }: { children?: View }) {
  head({
    titleTemplate: (title) => `${title} · Ilha + Vite`,
  });
  return (
    <div class="mx-auto mt-4 flex max-w-xl flex-col gap-4 p-4">
      <nav class="flex items-center gap-2">
        <a href="/" class={isActive("/") ? "btn btn-sm" : "btn btn-sm btn-ghost"}>
          Home
        </a>
        <a href="/learn" class={isActive("/learn") ? "btn btn-sm" : "btn btn-sm btn-ghost"}>
          Learn
        </a>
      </nav>
      <main>{children}</main>
    </div>
  );
}
