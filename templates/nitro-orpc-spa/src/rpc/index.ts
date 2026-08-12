import { os } from "@orpc/server";

export const router = {
  rpc: {
    getTasks: os.handler(() => [
      { id: "1", text: "Start Ilha Dev Server", completed: true },
      { id: "2", text: "Develop my Ilha app", completed: false },
      { id: "3", text: "Deploy my Ilha app", completed: false },
    ]),
  },
};
