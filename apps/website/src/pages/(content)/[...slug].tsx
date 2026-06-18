import { useRoute } from "@ilha/router";
import { LinkButton } from "areia";
import ilha from "ilha";
import { DocArticle } from "imprensa/doc";
import { getMdxContent, loadMdxHtml } from "imprensa/mdx";

const LazyDocArticle = ilha
  .input<{ path: string }>()
  .derived("mdxContent", async ({ input }) => loadMdxHtml(input.path))
  .render(({ derived, input }) => {
    const mdxContent = derived.mdxContent();

    if (mdxContent) return <DocArticle path={input.path}>{mdxContent}</DocArticle>;

    if (mdxContent === null) {
      return (
        <section class="text-areia-default flex flex-col gap-2">
          <h1 class="text-xl font-semibold">404</h1>
          <p>
            No page found for <code>{input.path}</code>.
          </p>
          <LinkButton href="/" variant="outline">
            Go home
          </LinkButton>
        </section>
      );
    }

    return (
      <section class="text-areia-default flex flex-col gap-3">
        <div class="bg-areia-surface-muted h-8 w-48 animate-pulse rounded-md" />
        <div class="bg-areia-surface-muted h-4 w-full max-w-2xl animate-pulse rounded-md" />
        <div class="bg-areia-surface-muted h-4 w-2/3 animate-pulse rounded-md" />
      </section>
    );
  });

export default ilha.render(() => {
  const { path } = useRoute();
  const pathname = path();
  const prerendered = getMdxContent(pathname);

  if (prerendered) return <DocArticle path={pathname}>{prerendered}</DocArticle>;

  return <LazyDocArticle path={pathname} />;
});
