import { loader } from "@ilha/router";
import { LayerCard, LinkButton } from "areia";
import { each, ilha } from "ilha";

export const load = loader.client(({ head }) => {
  head({ title: "Learn" });
});

const LINK_ICON = "/link.svg";
const BOOK_ICON = "/book.svg";

const LEARN_ITEMS = [
  {
    title: "Documentation",
    description: "Learn how to use Ilha.",
    href: "https://ilha.build/docs",
    icon: BOOK_ICON,
  },
  {
    title: "Discord",
    description: "Join our Discord server.",
    href: "https://discord.gg/WnVTMCTz74",
    icon: LINK_ICON,
  },
  {
    title: "x.com",
    description: "Follow us on X.",
    href: "https://x.com/ilha_js",
    icon: LINK_ICON,
  },
];

export default ilha(() => (
  <LayerCard>
    <LayerCard.Title>Learn Ilha</LayerCard.Title>
    <LayerCard.Content>
      {each(LEARN_ITEMS).as((item) => (
        <LinkButton
          href={item.href}
          icon={<img src={item.icon} alt="" class="size-6" />}
          class="w-full"
          external
        >
          {item.title} - {item.description}
        </LinkButton>
      ))}
    </LayerCard.Content>
  </LayerCard>
));
