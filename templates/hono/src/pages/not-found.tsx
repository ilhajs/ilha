import { useRoute } from "@ilha/router";
import { LinkButton } from "areia";
import ilha from "ilha";

export default ilha.render(() => {
  const { path } = useRoute();
  return (
    <section class="flex flex-col gap-2">
      <h1 class="text-xl font-semibold">404</h1>
      <p>
        No page found for <code>{path()}</code>.
      </p>
      <LinkButton href="/" variant="outline">
        Go home
      </LinkButton>
    </section>
  );
});
