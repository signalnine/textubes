import index from "./index.html";
import { initDb, saveFlow, getFlow } from "./db";

const MAX_BODY_SIZE = 500 * 1024; // 500KB

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
          .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function generateDescription(flow: any): string {
  if (!flow.nodes || !Array.isArray(flow.nodes)) {
    return "A text transformation pipeline on Textubes.";
  }
  const sources = flow.nodes.filter((n: any) => n.type === "source").length;
  const results = flow.nodes.filter((n: any) => n.type === "result").length;
  const transforms = flow.nodes.filter((n: any) =>
    !["source", "result", "help"].includes(n.type)
  ).length;
  return `A text pipeline with ${sources} input${sources !== 1 ? "s" : ""}, ` +
         `${transforms} transformation${transforms !== 1 ? "s" : ""}, ` +
         `and ${results} output${results !== 1 ? "s" : ""}.`;
}

export function startServer(
  options: { port?: number; dbPath?: string } = {}
) {
  const db = initDb(options.dbPath ?? "textubes.db");
  let cachedHtml: string | null = null;
  let server: ReturnType<typeof Bun.serve>;

  server = Bun.serve({
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
      "/s/:id": {
        GET: async (req) => {
          const id = req.params.id;
          const flow = getFlow(db, id) as any;

          if (!cachedHtml) {
            const res = await fetch(`${server.url}`);
            cachedHtml = await res.text();
          }

          if (!flow) {
            return new Response(cachedHtml, {
              headers: { "Content-Type": "text/html" },
            });
          }

          const title = flow.title || "Textubes";
          const desc = generateDescription(flow);

          const html = cachedHtml
            .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)} — Textubes</title>`)
            .replace(/(<meta name="title" content=").*?(")/,         `$1${escapeHtml(title)} — Textubes$2`)
            .replace(/(<meta name="description" content=").*?(")/,   `$1${escapeHtml(desc)}$2`)
            .replace(/(<meta property="og:title" content=").*?(")/,  `$1${escapeHtml(title)}$2`)
            .replace(/(<meta property="og:description" content=").*?(")/,  `$1${escapeHtml(desc)}$2`)
            .replace(/(<meta property="twitter:title" content=").*?(")/,   `$1${escapeHtml(title)}$2`)
            .replace(/(<meta property="twitter:description" content=").*?(")/,  `$1${escapeHtml(desc)}$2`);

          return new Response(html, {
            headers: { "Content-Type": "text/html" },
          });
        },
      },
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

  return server;
}

// Start the server when run directly
if (import.meta.main) {
  startServer({ port: Number(process.env.PORT) || 3000 });
}
