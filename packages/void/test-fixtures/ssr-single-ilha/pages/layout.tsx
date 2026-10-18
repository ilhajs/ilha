import type { View } from "ilha";

import { provideQueryCell } from "./query-cell.ts";

export default function Layout({ children }: { children?: View }) {
  provideQueryCell();
  return (
    <div class="shell">
      <header>Fixture</header>
      <main>{children}</main>
    </div>
  );
}
