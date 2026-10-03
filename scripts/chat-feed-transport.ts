// Evaluation-only loopback forwarding barrier. Forwards genuine app SSE bytes;
// drop() destroys actual owned sockets, holds reconnect requests, and never
// buffers/replays missed events. Does not mutate app or fabricate settled state.
import http from "node:http";
import type { Socket } from "node:net";

export async function makeFeedTransport(baseUrl: string) {
  let paused = false;
  const sockets = new Set<Socket>();
  const parked = new Set<() => void>();
  const observations: any[] = [];
  const server = http.createServer((req, res) => {
    const row = { path: req.url, at: Date.now(), paused, status: null as number | null, bytes: 0, closed: false, headers: {} };
    observations.push(row);
    if (!/^\/api\/me\/chats\/[^/?]+\/events$/.test(req.url ?? "")) { res.writeHead(404); res.end(); return; }
    const forward = () => {
    parked.delete(forward);
    if (res.destroyed) return;
    const upstream = http.get(`${baseUrl}${req.url}`, { headers: { Cookie: req.headers.cookie ?? "" } }, response => {
      row.status = response.statusCode ?? null;
      row.headers = response.headers;
      res.writeHead(response.statusCode ?? 502, { ...response.headers,
        "access-control-allow-origin": baseUrl, "access-control-allow-credentials": "true" });
      res.flushHeaders();
      response.on("data", chunk => { row.bytes += chunk.length; });
      response.pipe(res);
    });
    upstream.on("error", error => {
      observations.push({ kind: "upstream-close", path: req.url, message: error.message });
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on("close", () => { row.closed = true; upstream.destroy(); });
    };
    if (paused) { parked.add(forward); res.on("close", () => parked.delete(forward)); }
    else forward();
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing feed transport address");
  return {
    url: `http://127.0.0.1:${address.port}`, observations,
    drop() { paused = true; observations.push({ kind: "drop", at: Date.now(), sockets: sockets.size });
      for (const socket of sockets) socket.destroy(); },
    restore() { paused = false; observations.push({ kind: "restore", at: Date.now(), parked: parked.size });
      for (const forward of parked) forward(); },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>(r => server.close(() => r())); },
  };
}
