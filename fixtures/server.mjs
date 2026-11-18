// Tiny static server for testing. "bad" site blocks ClaudeBot UA with a 403 challenge.
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const [dir, port] = process.argv.slice(2);
http.createServer((req, res) => {
  const ua = req.headers["user-agent"] || "";
  if (dir.endsWith("bad") && /ClaudeBot/.test(ua)) { res.writeHead(403); return res.end("<html><title>Just a moment...</title></html>"); }
  if (dir.endsWith("good") && /markdown/.test(req.headers.accept || "") && req.url === "/") { res.writeHead(200, {"content-type":"text/markdown"}); return res.end("# Acme"); }
  let p = path.join(dir, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  if (!fs.existsSync(p)) { res.writeHead(404, {"content-type":"text/html"}); return res.end("<html>Not found</html>"); }
  const ct = p.endsWith(".txt") ? "text/plain" : p.endsWith(".xml") ? "application/xml" : "text/html";
  res.writeHead(200, {"content-type": ct}); fs.createReadStream(p).pipe(res);
}).listen(Number(port));
