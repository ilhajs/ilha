import ilha, { html } from "ilha";

export const navbar = ilha.render(
  () => html`
    <nav class="flex items-center justify-center">
      <div class="container flex items-center justify-between p-4">
        <a href="/" class="btn-ghost">
          <img src="/logo.svg" class="h-8" />
          <span>Ilha</span>
        </a>
        <div class="flex items-center gap-2 rounded-full border">
          <a href="/docs" class="btn-link" data-no-intercept>Docs</a>
          <a href="/tutorial" class="btn-link">Tutorial</a>
        </div>
      </div>
    </nav>
  `,
);
