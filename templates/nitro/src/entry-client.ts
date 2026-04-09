import "./style.css";
import { mount } from "ilha";
import { pageRouter } from "ilha:pages";
import { registry } from "ilha:registry";

// ilha.mount FIRST — finds [data-ilha] in SSR HTML and attaches reactivity
mount(registry, { root: document.querySelector("#app")! });

// router SECOND — but must not wipe #app innerHTML on first load
pageRouter.mount("#app", { hydrate: true });
