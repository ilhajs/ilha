import { useHead } from "@rspress/core/runtime";
import { useEffect } from "react";

import Landing from "./_landing";

const META_DESCRIPTION =
  "Ilha is a lightweight UI framework under 2,500 lines of code. Simple enough to fit in a single AI context window, powerful enough to build modern interfaces your way.";

export const frontmatter = {
  pageType: "custom",
  title: "Build Modern UI, Your Way",
  description: META_DESCRIPTION,
};

export default async () => {
  useHead({
    title: "Build Modern UI, Your Way",
    meta: [
      {
        name: "description",
        content: META_DESCRIPTION,
      },
    ],
  });
  useEffect(() => {
    const landing = document.getElementById("landing");
    if (!landing) return;
    Landing.mount(landing);
  }, []);
  const landingHtml = await Landing.hydratable({}, { name: "Landing", snapshot: true });
  return <div id="landing" dangerouslySetInnerHTML={{ __html: landingHtml }}></div>;
};
