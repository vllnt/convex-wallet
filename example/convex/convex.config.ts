import { defineApp } from "convex/server";
import component from "../../src/component/convex.config.js";

const app = defineApp();
app.use(component);

export default app;
