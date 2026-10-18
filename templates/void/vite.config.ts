import { voidIlha } from "@ilha/void/plugin";
import { defineConfig } from "vite";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [voidPlugin(), voidIlha()],
});
