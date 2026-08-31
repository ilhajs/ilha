import { useRoute } from "@ilha/router";

export default function NotFound() {
  const { path } = useRoute();
  return (
    <section class="flex flex-col gap-2">
      <h1 class="text-xl font-semibold">404</h1>
      <p>
        No page found for <code>{path()}</code>.
      </p>
      <a href="/">Go home</a>
    </section>
  );
}
