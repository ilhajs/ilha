import { useRoute } from "@ilha/router";
import ilha from "ilha";

export default ilha.render(() => {
  const { path } = useRoute();
  return (
    <section>
      <h1>404</h1>
      <p>
        No page found for <code>{path()}</code>.
      </p>
      <a href="/">Go home</a>
    </section>
  );
});
