import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://localhost:${port}`).pathname);
  const target = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(join(root, target));

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const stats = statSync(filePath);
  const etag = `W/"${stats.size}-${Math.trunc(stats.mtimeMs)}"`;
  const isImageAsset = pathname.startsWith("/assets/") && [".jpg", ".jpeg", ".png", ".webp"].includes(extname(filePath));
  const headers = {
    "Content-Type": types[extname(filePath)] || "application/octet-stream",
    "Content-Length": stats.size,
    "Last-Modified": stats.mtime.toUTCString(),
    ETag: etag,
    "Cache-Control": isImageAsset
      ? "public, max-age=3600, stale-while-revalidate=86400"
      : "no-cache",
  };

  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }

  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  const localAddress = getLocalAddress();
  console.log(`现金流人生地图已启动：http://127.0.0.1:${port}`);
  if (localAddress) console.log(`手机局域网测试地址：http://${localAddress}:${port}`);
});

function getLocalAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return "";
}
