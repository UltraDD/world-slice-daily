import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "creator-daily",
  pages: [{ path: "ideas", file: "page.tsx", id: "creator-ideas" }, { path: "signals", file: "signals.tsx", id: "creator-signals" }, { path: "queue", file: "queue.tsx", id: "creator-queue" }],
  redirects: [{ match: "exact", path: "/", status: 302, location: "/ideas" }],
  apiPaths: [/^\/api\/creator\//],
});
