import { describe, expect, it } from "bun:test";

import { h } from "ilha";
import type { View } from "ilha";

import {
  Form,
  Link,
  useForm,
  useIslandForm,
  useNavigation,
  useParams,
  useRouter,
  useShared,
} from "./index";
import type { IslandForm, LinkProps, PageForm } from "./index";
import { voidIlha } from "./plugin";

const typecheckHooks = (): void => {
  const params = useParams<{ slug: string }>();
  const slug: string = params.slug;
  const shared = useShared<{ appName: string }>();
  const appName: string = shared.appName;
  const state: "idle" | "loading" | "submitting" = useNavigation().state;
  const visit: Promise<unknown> = useRouter().visit("/next");
  void slug;
  void appName;
  void state;
  void visit;
};

const typecheckForms = (): void => {
  const form = useForm("/todos", { done: false, title: "" });
  form.setData("title", "Milk");
  form.setData("done", true);
  const title: string = form.data.title;
  // @ts-expect-error -- field values keep their declared type.
  form.setData("done", "yes");
  // @ts-expect-error -- unknown fields are rejected.
  form.setData("missing", 1);
  const pending: boolean = form.pending;
  const posted: Promise<void> = form.post({ preserveScroll: true });

  const island: IslandForm<{ body: string }> = useIslandForm({ body: "" });
  const sent: Promise<void> = island.put("/comments/1");
  // @ts-expect-error -- island submits need the action URL.
  void island.post();
  const typed: PageForm<{ done: boolean; title: string }> = form;
  void typed;
  void title;
  void pending;
  void posted;
  void sent;
};

const typecheckComponents = (): View => {
  const props: LinkProps = {
    cacheFor: "1m",
    class: "nav",
    href: "/about",
    prefetch: ["hover", "visible"],
  };
  // @ts-expect-error -- prefetch strategies are a fixed set.
  const bad: LinkProps = { href: "/", prefetch: "always" };
  void bad;
  return h(
    "div",
    null,
    Link(props),
    Form({ form: useForm("/todos", { title: "" }), method: "put" })
  );
};

const typecheckPlugin = (): void => {
  voidIlha({ prefetch: { cacheFor: ["30s", "5m"], hoverDelay: 50 } });
  // @ts-expect-error -- viewTransitions is a boolean flag.
  voidIlha({ viewTransitions: "yes" });
};

describe("type anchors", () => {
  it("exposes the public runtime API", () => {
    for (const anchor of [
      typecheckHooks,
      typecheckForms,
      typecheckComponents,
      typecheckPlugin,
    ]) {
      expect(Object.prototype.toString.call(anchor)).toBe("[object Function]");
    }
  });
});
