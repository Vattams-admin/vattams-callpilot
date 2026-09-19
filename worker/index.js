const ALLOWED_ORIGINS = new Set([
  "https://callpilot.vattams.net",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const TEXT_SEARCH_BASE = "https://atlas.mappls.com/api/places/textsearch/json";
const NEARBY_BASE = "https://atlas.mappls.com/api/places/nearby/json";
const PLACE_DETAILS_BASE = "https://place.mappls.com/O2O/entity/place-details";

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://callpilot.vattams.net";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin),
  });
}

async function mapplsGet(url, origin) {
  let response;

  try {
    response = await fetch(url);
  } catch {
    return json(
      { error: "Could not reach Mappls." },
      503,
      origin,
    );
  }

  if (response.status === 204) {
    return json(null, 200, origin);
  }

  if (!response.ok) {
    if (response.status === 401) {
      return json({ error: "Mappls rejected the static key." }, 401, origin);
    }

    if (response.status === 403) {
      return json({ error: "Mappls access is restricted or rate-limited." }, 403, origin);
    }

    if (response.status === 429) {
      return json({ error: "Mappls rate limit was reached." }, 429, origin);
    }

    if (response.status >= 500) {
      return json({ error: "Mappls is temporarily unavailable." }, 503, origin);
    }

    return json({ error: "Mappls rejected the request." }, 400, origin);
  }

  try {
    const data = await response.json();
    return json(data, 200, origin);
  } catch {
    return json({ error: "Mappls returned invalid JSON." }, 502, origin);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== "POST") {
      return json({ error: "POST required." }, 405, origin);
    }

    const staticKey = env.MAPPLS_STATIC_KEY;

    if (!staticKey) {
      return json(
        { error: "Mappls static key is not configured." },
        500,
        origin,
      );
    }

    let data;

    try {
      data = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400, origin);
    }

    const action = data?.action;

    if (action === "resolveLocation" || action === "textSearch") {
      const query = String(data?.query || "").trim();

      if (!query) {
        return json({ error: "Search query is required." }, 400, origin);
      }

      const url = new URL(TEXT_SEARCH_BASE);
      url.searchParams.set("query", query);
      url.searchParams.set("region", "IND");
      url.searchParams.set("access_token", staticKey);

      return mapplsGet(url, origin);
    }

    if (action === "nearbySearch") {
      const keywords = String(data?.query || "").trim();
      const eLoc = String(data?.eLoc || "").trim();

      if (!keywords || !eLoc) {
        return json(
          { error: "Nearby search requires keywords and a location." },
          400,
          origin,
        );
      }

      const url = new URL(NEARBY_BASE);
      url.searchParams.set("keywords", keywords);
      url.searchParams.set("refLocation", eLoc);
      url.searchParams.set("radius", "10000");
      url.searchParams.set("region", "IND");
      url.searchParams.set("sortBy", "dist:asc");
      url.searchParams.set("access_token", staticKey);

      return mapplsGet(url, origin);
    }

    if (action === "placeDetails") {
      const eLoc = String(data?.eLoc || "").trim();

      if (!eLoc) {
        return json({ error: "Place eLoc is required." }, 400, origin);
      }

      const url = new URL(
        `${PLACE_DETAILS_BASE}/${encodeURIComponent(eLoc)}`,
      );
      url.searchParams.set("access_token", staticKey);

      return mapplsGet(url, origin);
    }

    return json({ error: "Unknown Mappls operation." }, 400, origin);
  },
};
