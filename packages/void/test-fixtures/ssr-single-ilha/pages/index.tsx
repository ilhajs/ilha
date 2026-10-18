import { atom } from "ilha";

import { queryCellVersion } from "./query-cell.ts";

export default function Index() {
  const visits = atom(3);
  queryCellVersion();
  return <p class="home">{visits}</p>;
}
