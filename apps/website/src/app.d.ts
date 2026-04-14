/// <reference types="vite/client" />
/// <reference types="../.ilha/routes" />

import type { ClientUnhead } from "unhead/client";

declare global {
  interface Window {
    __UNHEAD__: ClientUnhead;
  }
}
