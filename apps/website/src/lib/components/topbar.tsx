import { Link, LinkButton } from "areia";
import ilha from "ilha";
import { LogoButton, SearchNavbarTrigger, ThemeToggle } from "imprensa/components";
import { socials } from "imprensa/config";
import { Icon } from "imprensa/icons";

export const Topbar = ilha.render(() => (
  <header class="border-areia-border bg-areia-background/80 sticky top-0 z-50 border-b backdrop-blur-lg">
    <div class="container mx-auto flex h-14 max-w-6xl min-w-0 items-center justify-between gap-3 px-4">
      <div class="flex shrink-0 items-center gap-4">
        <LogoButton />
        <Link
          href="/guide/getting-started/introduction"
          variant="plain"
          class="text-areia-foreground/80 text-sm"
        >
          Guide
        </Link>
        <Link
          href="/tutorial/counter/state"
          variant="plain"
          class="text-areia-foreground/80 text-sm"
        >
          Tutorial
        </Link>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <SearchNavbarTrigger />
        <div class="hidden md:flex">
          <ThemeToggle />
        </div>
        <div class="flex items-center">
          {socials.map((s) => (
            <LinkButton
              href={s.url}
              shape="square"
              icon={<Icon icon={s.service} class="size-4" />}
              external
              aria-label={s.service}
            />
          ))}
        </div>
      </div>
    </div>
  </header>
));
