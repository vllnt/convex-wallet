import { defineComponent } from "convex/server";

/** Component definition. Mount it with `app.use(wallet)` in `convex/convex.config.ts`. */
const component = defineComponent("wallet");

// Nest official child components here, e.g.:
// import sharded from "@convex-dev/sharded-counter/convex.config";
// component.use(sharded);

export default component;
