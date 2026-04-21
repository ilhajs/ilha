import { localMd } from "@fumadocs/local-md";
import { dynamicLoader } from "fumadocs-core/source/dynamic";

const docs = localMd({
  dir: "src/pages/docs",
  // options
});

export const docsLoader = dynamicLoader(docs.dynamicSource(), {
  baseUrl: "/docs",
});
