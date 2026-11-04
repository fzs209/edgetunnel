import { connect } from "cloudflare:sockets";

const TIMEOUT_MS = 5000;

const DEFAULT_TARGETS = [
  {
    id: "google-domain-443",
    hostname: "www.google.com",
    port: 443,
    category: "public-domain"
  },
  {
    id: "google-dns-ip-53",
    hostname: "8.8.8.8",
    port: 53,
    category: "public-ip"
  },
  {
    id: "cloudflare-dns-ip-53",
    hostname: "1.1.1.1",
    port: 53,
    category: "cloudflare-ip"
  }
];

async function probeTcp(target) {
  const startedAt = Date.now();
  let socket;
  let timeoutId;

  try {
    socket = connect({
      hostname: target.hostname,
      port: target.port
    });

    const openedInfo = await Promise.race([
      socket.opened,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(`TCP open timeout after ${TIMEOUT_MS}ms`);
          error.name = "TimeoutError";
          reject(error);
        }, TIMEOUT_MS);
      })
    ]);

    return {
      id: target.id,
      category: target.category,
      target: `${target.hostname}:${target.port}`,
      success: true,
      elapsedMs: Date.now() - startedAt,
      remoteAddress: openedInfo?.remoteAddress ?? null,
      localAddress: openedInfo?.localAddress ?? null
    };
  } catch (error) {
    return {
      id: target.id,
      category: target.category,
      target: `${target.hostname}:${target.port}`,
      success: false,
      elapsedMs: Date.now() - startedAt,
      errorName: error?.name || null,
      error: error?.message || String(error)
    };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    try {
      const closing = socket?.close?.();
      closing?.catch?.(() => {});
    } catch (_) {}
  }
}

async function probeHttpFetch() {
  const target = "https://example.com/";
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });

    const result = {
      target,
      success: true,
      elapsedMs: Date.now() - startedAt,
      status: response.status,
      ok: response.ok,
      redirected: response.redirected
    };

    try {
      const cancelPromise = response.body?.cancel();
      cancelPromise?.catch?.(() => {});
    } catch (_) {}

    return result;
  } catch (error) {
    return {
      target,
      success: false,
      elapsedMs: Date.now() - startedAt,
      errorName: error?.name || null,
      error: error?.message || String(error)
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") {
      return new Response("GET only", {
        status: 405,
        headers: { Allow: "GET" }
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/") {
      return new Response("Not Found", { status: 404 });
    }

    const targets = [...DEFAULT_TARGETS];
    const customHost = String(env.TCP_PROBE_HOST || "").trim();
    const customPort = Number(env.TCP_PROBE_PORT || 443);

    if (
      customHost &&
      Number.isInteger(customPort) &&
      customPort >= 1 &&
      customPort <= 65535
    ) {
      targets.push({
        id: "custom-vps",
        hostname: customHost,
        port: customPort,
        category: "user-configured"
      });
    }

    // HTTP Fetch is a control test; TCP probes use cloudflare:sockets only.
    const httpFetch = await probeHttpFetch();
    const tcpResults = [];

    // Run sequentially to avoid concurrent dials affecting the comparison.
    for (const target of targets) {
      tcpResults.push(await probeTcp(target));
    }

    return Response.json(
      {
        diagnostic: "isolated-cloudflare-tcp-socket-probe",
        timestamp: new Date().toISOString(),
        note: "TCP probes only await socket.opened and then close the socket. No TLS handshake or application payload is sent. HTTP Fetch is a separate control request.",
        runtime: {
          colo: request.cf?.colo ?? null,
          hostname: url.hostname,
          path: url.pathname
        },
        timeoutMs: TIMEOUT_MS,
        httpFetch,
        tcpResults,
        customTargetConfigured: Boolean(customHost)
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache"
        }
      }
    );
  }
};
