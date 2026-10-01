import { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function protoRoutes(fastify: FastifyInstance) {
  const protoDir = path.resolve(__dirname, "../../../proto");

  // Redirect /proto ke /proto/
  fastify.get("/proto", async (_request, reply) => {
    return reply.redirect("/proto/");
  });

  // Sajikan halaman utama prototype di /proto/
  fastify.get("/proto/", async (_request, reply) => {
    const indexPath = path.join(protoDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      return reply.status(404).send("File proto/index.html belum ditemukan.");
    }
    const htmlContent = await fs.promises.readFile(indexPath, "utf-8");
    return reply.type("text/html; charset=utf-8").send(htmlContent);
  });

  // Dukungan aset statis di dalam folder proto jika diperlukan
  fastify.get<{ Params: { "*": string } }>("/proto/*", async (request, reply) => {
    const rawPath = request.params["*"];
    const safePath = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
    const targetFile = path.join(protoDir, safePath);

    if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
      const indexPath = path.join(protoDir, "index.html");
      const htmlContent = await fs.promises.readFile(indexPath, "utf-8");
      return reply.type("text/html; charset=utf-8").send(htmlContent);
    }

    const ext = path.extname(targetFile).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };

    const stream = fs.createReadStream(targetFile);
    return reply.type(mimeTypes[ext] || "application/octet-stream").send(stream);
  });
}
