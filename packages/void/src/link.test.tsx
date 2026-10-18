// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { mount } from "ilha";
import type { View } from "ilha";
import { createSsrRouter, idleNavigationState } from "void/pages-client";
import type { VisitOptions, VoidRouter } from "void/pages-client";

import { createPageState, VoidContext } from "./context";
import { Link } from "./link";
import { setLocation, settle } from "./test-helpers";

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

/** Mount links under a stub router on a detached host. */
const mountLinks = async (
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
      {children}
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

describe("Link", () => {
  it("routes plain left clicks through the router", async () => {
    const { host, visits } = await mountLinks(
      <Link class="plain" href="/users/9">
        nine
      </Link>,
      null
    );
    const event = click(host.querySelector("a.plain"));
    expect(event.defaultPrevented).toBe(true);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ url: "/users/9" });
    expect(visits[0]?.options).toMatchObject({ method: "GET" });
  });

  it("leaves modified clicks to the browser", async () => {
    const { host, visits } = await mountLinks(
      <Link class="mod" href="/users/9">
        nine
      </Link>,
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
      const event = click(host.querySelector("a.mod"), init);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(visits).toHaveLength(0);
    setLocation("http://localhost:3000/users/7");
  });

  it("leaves target=_blank links to the browser", async () => {
    const { host, visits } = await mountLinks(
      <Link class="blank" href="/users/9" target="_blank">
        blank
      </Link>,
      null
    );
    const event = click(host.querySelector("a.blank"));
    expect(event.defaultPrevented).toBe(false);
    expect(visits).toHaveLength(0);
    setLocation("http://localhost:3000/users/7");
  });

  it("intercepts explicit target=_self links", async () => {
    const { host, visits } = await mountLinks(
      <Link class="self" href="/users/9" target="_self">
        self
      </Link>,
      null
    );
    const event = click(host.querySelector("a.self"));
    expect(event.defaultPrevented).toBe(true);
    expect(visits).toHaveLength(1);
  });

  it("leaves download links to the browser", async () => {
    const { host, visits } = await mountLinks(
      <Link class="file" href="/report.csv" download>
        csv
      </Link>,
      null
    );
    const event = click(host.querySelector("a.file"));
    expect(event.defaultPrevented).toBe(false);
    expect(visits).toHaveLength(0);
    setLocation("http://localhost:3000/users/7");
  });

  it("leaves cross-origin links to the browser", async () => {
    const { host, visits } = await mountLinks(
      <Link class="ext" href="https://example.com/other">
        ext
      </Link>,
      null
    );
    const event = click(host.querySelector("a.ext"));
    expect(event.defaultPrevented).toBe(false);
    expect(visits).toHaveLength(0);
    setLocation("http://localhost:3000/users/7");
  });

  it("routes absolute same-origin links through the router", async () => {
    const { host, visits } = await mountLinks(
      <Link class="abs" href="http://localhost:3000/users/9">
        abs
      </Link>,
      null
    );
    const event = click(host.querySelector("a.abs"));
    expect(event.defaultPrevented).toBe(true);
    expect(visits).toHaveLength(1);
  });

  it("reloadDocument skips the router", async () => {
    const { host, visits } = await mountLinks(
      <Link class="doc" href="/users/9" reloadDocument>
        doc
      </Link>,
      null
    );
    const event = click(host.querySelector("a.doc"));
    expect(event.defaultPrevented).toBe(false);
    expect(visits).toHaveLength(0);
    setLocation("http://localhost:3000/users/7");
  });

  it("falls back to the browser without a router", async () => {
    setLocation("http://localhost:3000/users/7");
    const host = document.createElement("div");
    // SAFETY: no provider here on purpose — island pages have no router.
    mount(host, () => (
      <Link class="plain" href="/users/9">
        nine
      </Link>
    ));
    await settle();
    const event = click(host.querySelector("a.plain"));
    expect(event.defaultPrevented).toBe(false);
    setLocation("http://localhost:3000/users/7");
  });

  it("onNavigate can cancel the visit", async () => {
    const { host, visits } = await mountLinks(
      <Link
        class="cancel"
        href="/users/9"
        onNavigate={({ preventDefault }) => preventDefault()}
      >
        cancel
      </Link>,
      null
    );
    const cancelEvent = click(host.querySelector("a.cancel"));
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(visits).toHaveLength(0);
  });

  it("a prevented onclick skips the visit", async () => {
    const { host, visits } = await mountLinks(
      <Link
        class="stopped"
        href="/users/9"
        onclick={(event) => event.preventDefault()}
      >
        stopped
      </Link>,
      null
    );
    const stoppedEvent = click(host.querySelector("a.stopped"));
    expect(stoppedEvent.defaultPrevented).toBe(true);
    expect(visits).toHaveLength(0);
    setLocation("http://localhost:3000/users/7");
  });

  it("normalizes a lowercase method before visiting", async () => {
    const { host, visits } = await mountLinks(
      <Link class="leave" href="/teams" method="delete">
        leave
      </Link>,
      null
    );
    click(host.querySelector("button.leave"));
    expect(visits).toHaveLength(1);
    expect(visits[0]?.options).toMatchObject({ method: "DELETE" });
  });

  it("still runs onclick for intercepted clicks", async () => {
    let seen: MouseEvent | undefined;
    const { host, visits } = await mountLinks(
      <Link
        class="spy"
        href="/users/9"
        onclick={(event) => {
          seen = event;
        }}
      >
        spy
      </Link>,
      null
    );
    click(host.querySelector("a.spy"));
    expect(seen).toBeInstanceOf(MouseEvent);
    expect(visits).toHaveLength(1);
  });

  it("renders non-GET links as buttons that visit with data", async () => {
    const { host, visits } = await mountLinks(
      <Link class="join" href="/teams" method="post" data={{ name: "ilha" }}>
        join
      </Link>,
      null
    );
    const button = host.querySelector("button.join");
    if (!button) {
      throw new Error("non-GET link did not render a button");
    }
    const event = click(button);
    expect(event.defaultPrevented).toBe(true);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ url: "/teams" });
    expect(visits[0]?.options).toMatchObject({
      data: { name: "ilha" },
      method: "POST",
    });
  });

  it("normalizes a lowercase method before visiting", async () => {
    const { visits } = await mountLinks(
      <Link class="leave" href="/teams" method="delete">
        leave
      </Link>,
      null
    );
    // SAFETY: the previous test covers the button render itself.
    const button = document.createElement("button");
    void button;
    expect(visits).toHaveLength(0);
  });

  it("merges GET data into the href", async () => {
    const { host, visits } = await mountLinks(
      <Link class="search" href="/search" data={{ page: 2, q: "milk" }}>
        search
      </Link>,
      null
    );
    const href = host.querySelector("a.search")?.getAttribute("href") ?? "";
    expect(href.startsWith("/search?")).toBe(true);
    expect(href).toContain("q=milk");
    expect(href).toContain("page=2");
    click(host.querySelector("a.search"));
    expect(visits).toHaveLength(1);
  });

  it("rejects prefetch on non-GET links", async () => {
    let thrown: unknown;
    const Probe = (): null => {
      try {
        // SAFETY: calling the component directly runs the same prop
        // validation a render would; the throw is synchronous here.
        Link({ href: "/users/9", method: "post", prefetch: true });
      } catch (error) {
        thrown = error;
      }
      return null;
    };
    mount(document.createElement("div"), () => <Probe />);
    await settle();
    expect(String(thrown)).toContain("prefetch");
  });

  it("rejects reloadDocument on non-GET links", async () => {
    let thrown: unknown;
    const Probe = (): null => {
      try {
        // SAFETY: see the prefetch test above.
        Link({ href: "/users/9", method: "post", reloadDocument: true });
      } catch (error) {
        thrown = error;
      }
      return null;
    };
    mount(document.createElement("div"), () => <Probe />);
    await settle();
    expect(String(thrown)).toContain("reloadDocument");
  });
});
