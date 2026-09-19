export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "https://callpilot.vattams.net",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        service: "VATTAMS CallPilot Mappls Proxy",
        status: "ready",
        credentialsConfigured: Boolean(
          env.MAPPLS_CLIENT_ID && env.MAPPLS_CLIENT_SECRET
        ),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "https://callpilot.vattams.net",
        },
      }
    );
  },
};
