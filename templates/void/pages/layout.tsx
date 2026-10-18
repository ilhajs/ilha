import { Link } from "@ilha/void";
import type { View } from "ilha";

import "./app.css";

export default function Layout({ children }: { children?: View }) {
  return (
    <div class="shell">
      <nav>
        <Link href="/" prefetch>
          Todos
        </Link>
        <Link href="/about" prefetch>
          About
        </Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
