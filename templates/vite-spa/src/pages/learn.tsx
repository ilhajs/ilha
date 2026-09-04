import { head } from "@ilha/router";

const LEARN_ITEMS = [
  {
    description: "Learn how to use Ilha.",
    href: "https://ilha.build/docs",
    title: "Documentation",
  },
  {
    description: "Join our Discord server.",
    href: "https://discord.gg/WnVTMCTz74",
    title: "Discord",
  },
  {
    description: "Follow us on X.",
    href: "https://x.com/ilha_js",
    title: "x.com",
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
