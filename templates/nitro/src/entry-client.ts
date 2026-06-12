import "./app.css";
import { pageRouter, registry } from "ilha:pages/client";

pageRouter.hydrate(registry, { root: document.querySelector("#app")! });
