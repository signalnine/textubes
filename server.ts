import index from "./index.html";
import { initDb, saveFlow, getFlow } from "./db";

const MAX_BODY_SIZE = 500 * 1024; // 500KB

export function startServer(
  options: { port?: number; dbPath?: string } = {}
) {
  const db = initDb(options.dbPath ?? "textubes.db");

  return Bun.serve({
    port: options.port ?? 3000,
    routes: {
      "/api/flows": {
        POST: async (req) => {
          const contentLength = parseInt(
            req.headers.get("content-length") ?? "0"
          );
          if (contentLength > MAX_BODY_SIZE) {
            return new Response(
              JSON.stringify({ error: "Payload too large" }),
              { status: 413, headers: { "Content-Type": "application/json" } }
            );
          }

          const body = await req.text();
          if (body.length > MAX_BODY_SIZE) {
            return new Response(
              JSON.stringify({ error: "Payload too large" }),
              { status: 413, headers: { "Content-Type": "application/json" } }
            );
          }

          let flowData: unknown;
          try {
            flowData = JSON.parse(body);
          } catch {
            return new Response(
              JSON.stringify({ error: "Invalid JSON" }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          const id = saveFlow(db, flowData);
          return Response.json({ id });
        },
      },
      "/api/flows/:id": {
        GET: (req) => {
          const id = req.params.id;
          const flow = getFlow(db, id);
          if (!flow) {
            return new Response(
              JSON.stringify({ error: "Not found" }),
              { status: 404, headers: { "Content-Type": "application/json" } }
            );
          }
          return Response.json(flow);
        },
      },
      // SPA routes serve the frontend HTML
      "/": index,
      "/s/:id": index,
      "/edit/:id": index,
    },
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/textubes.png") {
        return new Response(Bun.file("./textubes.png"));
      }
      // Unknown routes get the SPA HTML too
      return new Response(Bun.file(import.meta.dir + "/index.html"), {
        headers: { "Content-Type": "text/html" },
      });
    },
    development: process.env.NODE_ENV !== "production" ? {
      hmr: true,
      console: true,
    } : undefined,
  });
}

// Start the server when run directly
if (import.meta.main) {
  startServer({ port: Number(process.env.PORT) || 3000 });
}
