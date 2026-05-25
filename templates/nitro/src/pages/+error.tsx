import type { ErrorHandler } from "@ilha/router/vite";
import ilha from "ilha";

export default ((error, route) =>
  ilha.render(() => (
    <div class="error">
      <h1>{error.status ?? 500}</h1>
      <p>{error.message}</p>
      <small>{route.path}</small>
    </div>
  ))) satisfies ErrorHandler;
