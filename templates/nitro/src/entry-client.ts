import "./app.css";
import { pageRouter } from "ilha:pages";
import { registry } from "ilha:registry";

pageRouter.hydrate(registry, { root: document.querySelector("#app")! });
