# Isolated Cloudflare TCP Socket Probe

This probe is deliberately independent of the edgetunnel `forwardataTCP()`,
ProxyIP parsing, WebSocket proxying, and `request.fetcher.connect()`.

It runs one ordinary HTTP `fetch()` control request, then sequentially tests
these raw TCP destinations with `cloudflare:sockets.connect()`:

- `www.google.com:443` — public-domain TCP destination
- `8.8.8.8:53` — Google Public DNS over TCP
- `1.1.1.1:53` — Cloudflare IP range control (expected to be blocked)

Each TCP test only waits for `socket.opened` and immediately closes the socket.
It does not perform a TLS handshake or send application data.

## Deploy as a separate Worker

From the repository root, on branch `diagnostics/tcp-connect-comparison`:

```powershell
npx wrangler deploy --config wrangler.tcp-probe.toml
```

Wrangler will create a separate Worker named `edgetunnel-tcp-socket-probe`
and publish its `workers.dev` URL. This does not change the existing edgetunnel
Worker's entry point or `main` branch.

Open the new Worker URL in a browser. The root path returns the JSON results.

Optional: set `TCP_PROBE_HOST` and `TCP_PROBE_PORT` as Worker variables to
include a TCP service on a VPS you control. The default custom port is 443.

## Reading the result

- HTTP Fetch succeeds, public TCP tests fail: HTTP subrequests work, but raw TCP
  Socket creation is failing independently of edgetunnel's forwarding code.
- Public TCP succeeds and the Cloudflare control fails: the expected Cloudflare
  IP-range restriction is being enforced.
- All tests succeed here but fail in edgetunnel: investigate the original
  Worker deployment, request path, bindings, and forwarding context.
- Public TCP returns `TCP Loop detected` even in this isolated Worker: retain
  the JSON, Worker name, timestamp, and colo for a Cloudflare Support case.

If this Worker is deployed through Workers for Platforms dispatch with an
Outbound Worker configured, test it as a normal standalone Worker instead:
Cloudflare documents that Outbound Workers disable outbound TCP Socket use
for dispatched customer Workers.
