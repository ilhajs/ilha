// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { mount } from "ilha";
import type { View } from "ilha";
import { createSsrRouter, idleNavigationState } from "void/pages-client";
import type { VisitOptions, VoidRouter } from "void/pages-client";

import { createPageState, VoidContext } from "./context";
import { setLocation, settle } from "./test-helpers";
import { useLink } from "./use-link";
import type { UseLinkOptions } from "./use-link";

interface RecordedVisit {
  options: VisitOptions;
  url: string;
}

/** A router stub: the SSR shape with `visit` swapped for the recorder. */
const stubRouter = (visits: RecordedVisit[]): VoidRouter => {
  const router = createSsrRouter("http://localhost:3000/users/7");
  router.visit = (url, options) => {
    visits.push({ options: options ?? {}, url: String(url) });
    return Promise.resolve({});
  };
  return router;
};

/** Mount menu items under a stub router on a detached host. */
const mountMenu = async (
  children: View,
  router: VoidRouter | null
): Promise<{ host: HTMLElement; visits: RecordedVisit[] }> => {
  setLocation("http://localhost:3000/users/7");
  const visits: RecordedVisit[] = [];
  const host = document.createElement("div");
  mount(host, () => (
    <VoidContext.Provider
      value={createPageState({
        errors: {},
        navigation: idleNavigationState(),
        params: {},
        router: router ?? stubRouter(visits),
        shared: {},
      })}
    >
      <ul>{children}</ul>
    </VoidContext.Provider>
  ));
  await settle();
  return { host, visits };
};

const click = (
  element: Element | null,
  init: MouseEventInit = {}
): MouseEvent => {
  if (!element) {
    throw new Error("click target missing");
  }
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  element.dispatchEvent(event);
  return event;
};

interface ItemProps {
  href: string;
  label: string;
  options?: UseLinkOptions;
  download?: boolean;
}

/** A menu item whose link is a native `<a>` bound with `useLink()`. */
const MenuItem = ({ download, href, label, options }: ItemProps): View => {
  const link = useLink();
  return (
    <li>
      <a class="item" download={download} {...link(href, options)}>
        {label}
      </a>
    </li>
  );
};

/** A native menu: the component itself calls `useLink()` for its anchors. */
const Menu = (): View => {
  const link = useLink();
  return (
    <ul class="menu">
      <li>
        <a class="item" {...link("/users/9")}>
          nine
        </a>
      </li>
    </ul>
  );
};

describe("useLink", () => {
  it("routes plain left clicks through the router", async () => {
    const { host, visits } = await mountMenu(
      <MenuItem
        href="/users/9"
        label="nine"
        options={{ preserveScroll: true, replace: true }}
      />,
      null
    );
    const event = click(host.querySelector("a.item"));
    expect(event.defaultPrevented).toBe(true);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ url: "/users/9" });
    expect(visits[0]?.options).toMatchObject({
      method: "GET",
      preserveScroll: true,
      replace: true,
    });
  });

  it("leaves modified clicks to the browser", async () => {
    const { host, visits } = await mountMenu(
      <MenuItem href="/users/9" label="nine" />,
      null
    );
    const cases: MouseEventInit[] = [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ];
    for (const init of cases) {
      const event = click(host.querySelector("a.item"), init);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(visits).toHaveLength(0);
    setLocation("http://localhost:3000/users/7");
  });

  it("leaves download links to the browser", async () => {
    const { host, visits } = await mountMenu(
      <MenuItem download href="/report.csv" label="csv" />,
      null
    );
    const event = click(host.querySelector("a.item"));
    expect(event.defaultPrevented).toBe(false);
    expect(visits).toHaveLength(0);
    setLocation("http://localhost:3000/users/7");
  });

  it("leaves cross-origin links to the browser", async () => {
    const { host, visits } = await mountMenu(
      <MenuItem href="https://example.com/other" label="ext" />,
      null
    );
    const event = click(host.querySelector("a.item"));
    expect(event.defaultPrevented).toBe(false);
    expect(visits).toHaveLength(0);
    setLocation("http://localhost:3000/users/7");
  });

  it("a prevented onclick skips the visit", async () => {
    const { host, visits } = await mountMenu(
      <MenuItem
        href="/users/9"
        label="stopped"
        options={{ onclick: (event) => event.preventDefault() }}
      />,
      null
    );
    const stoppedEvent = click(host.querySelector("a.item"));
    expect(stoppedEvent.defaultPrevented).toBe(true);
    expect(visits).toHaveLength(0);
    setLocation("http://localhost:3000/users/7");
  });

  it("onNavigate can cancel the visit", async () => {
    const { host, visits } = await mountMenu(
      <MenuItem
        href="/users/9"
        label="cancel"
        options={{ onNavigate: ({ preventDefault }) => preventDefault() }}
      />,
      null
    );
    const cancelEvent = click(host.querySelector("a.item"));
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(visits).toHaveLength(0);
  });

  it("falls back to the browser without a router", async () => {
    setLocation("http://localhost:3000/users/7");
    const host = document.createElement("div");
    // SAFETY: no provider here on purpose — island pages have no router.
    mount(host, () => (
      <ul>
        <MenuItem href="/users/9" label="nine" />
      </ul>
    ));
    await settle();
    const event = click(host.querySelector("a.item"));
    expect(event.defaultPrevented).toBe(false);
    setLocation("http://localhost:3000/users/7");
  });

  it("renders the anchor as a direct child of its parent", async () => {
    const { host } = await mountMenu(<Menu />, null);
    const anchor = host.querySelector("li > a.item");
    if (!anchor) {
      throw new Error("menu anchor is not a direct child of its <li>");
    }
    expect(anchor.parentElement?.tagName).toBe("LI");
    expect(anchor.getAttribute("href")).toBe("/users/9");
    expect(host.querySelector("ul.menu [data-ilha-slot]")).toBeNull();
  });
});
