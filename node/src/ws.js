import { WebSocketServer } from 'ws';
import { config } from './config.js';

const MAX_CONNECTIONS = 20; // per process (spec 7)
const MAX_PAYLOAD = 1024; // bytes; ws closes with 1009 above this

const BUSY_BODY = '{"error":"server_busy"}';

function refuse(socket, status, reason, body) {
  const payload = body ?? '';
  const head = [
    `HTTP/1.1 ${status} ${reason}`,
    'Connection: close',
    `X-Stack: ${config.APP_STACK}`,
  ];
  if (body !== undefined) {
    head.push('Content-Type: application/json', `Content-Length: ${Buffer.byteLength(payload)}`);
  } else {
    head.push('Content-Length: 0');
  }
  socket.end(`${head.join('\r\n')}\r\n\r\n${payload}`, () => socket.destroy());
  setTimeout(() => socket.destroy(), 1000).unref(); // never leave a half-closed socket
}

/**
 * Attach the /ws ping endpoint to an http.Server. Client {"type":"ping","t":n} gets
 * {"type":"pong","t":n}; everything else is ignored. No server pings, no idle timeout,
 * never closes on its own. Message contents are never logged.
 */
export function attachWs(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  let open = 0;

  wss.on('connection', (ws) => {
    open += 1;
    ws.on('close', () => { open -= 1; });
    ws.on('error', () => { /* e.g. 1009 oversize: ws closes the socket itself */ });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(data.toString('utf8')); } catch { return; }
      if (m && m.type === 'ping' && typeof m.t === 'number' && Number.isFinite(m.t)) {
        ws.send(JSON.stringify({ type: 'pong', t: m.t }));
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => { /* client vanished mid-handshake */ });
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { pathname = ''; }
    if (pathname !== '/ws') {
      refuse(socket, 404, 'Not Found');
      return;
    }
    if (open >= MAX_CONNECTIONS) {
      refuse(socket, 503, 'Service Unavailable', BUSY_BODY);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return wss;
}
