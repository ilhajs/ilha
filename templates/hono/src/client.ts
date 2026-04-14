import { router } from "@ilha/router";

import Layout from "./pages/+layout.js";
import HomePage from "./pages/index.js";
import LearnPage from "./pages/learn.js";
import notFoundPage from "./pages/not-found.js";

router()
  .route("/", Layout(HomePage))
  .route("/learn", Layout(LearnPage))
  .route("/**", Layout(notFoundPage))
  .mount("#app");
