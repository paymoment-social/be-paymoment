import { cors } from "hono/cors";
import { Hono } from "hono";
import { config } from "./config";
import { auth } from "./modules/auth/auth.routes";

const app = new Hono();
app.use("/api/*", cors({ origin: config().frontendUrl, credentials: true }));
app.get("/health", (c) => c.json({ ok: true, service: "paymoment-auth-api", runtime: "bun" }));
app.route("/api/auth", auth);
app.onError((error, c) => { console.error(error); return c.json({ error: "Internal server error" }, 500); });

const server = { port: config().port, fetch: app.fetch };
export default server;
