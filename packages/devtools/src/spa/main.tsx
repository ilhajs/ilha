import { connectPanelChannel } from "devframe/in-page-channel";
import { mount } from "ilha";

import { ILHA_DEVTOOLS_CHANNEL } from "../protocol";
import type { IlhaDevtoolsProtocol } from "../protocol";
import { createApp } from "./app";

const host = document.querySelector("#app");

if (host) {
  mount(
    host,
    createApp(() =>
      connectPanelChannel<IlhaDevtoolsProtocol>({
        functions: {},
        name: ILHA_DEVTOOLS_CHANNEL,
      })
    )
  );
}
