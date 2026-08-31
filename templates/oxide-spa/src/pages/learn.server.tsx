import { head } from "@ilha/router";

const LEARN_ITEMS = [
  {
    title: "Documentation",
    description: "Learn how to use Ilha.",
    href: "https://ilha.build/docs",
  },
  {
    title: "Discord",
    description: "Join our Discord server.",
    href: "https://discord.gg/WnVTMCTz74",
  },
  {
    title: "x.com",
    description: "Follow us on X.",
    href: "https://x.com/ilha_js",
  },
];

export default function Learn() {
  head({ title: "Learn" });
  return (
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Learn Ilha</h2>
        <div class="flex flex-col gap-2">
          {LEARN_ITEMS.map((item) => (
            <a
              key={item.href}
              class="btn btn-outline w-full justify-start"
              href={item.href}
              target="_blank"
              rel="noreferrer"
            >
              <img src="/link.svg" />
              <span>
                {item.title} — {item.description}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
