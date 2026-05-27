const CACHE_TTL_SECONDS = 60;

function normalizeCoord(value, fallback) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return Number(fallback).toFixed(4);
  }

  return n.toFixed(4);
}

function makeCacheKey(lat, lon) {
  return `https://weatherbear-cache.local/api/yr-nowcast/${encodeURIComponent(
    lat
  )}/${encodeURIComponent(lon)}`;
}

async function fetchFreshNowcast(lat, lon) {
  const apiUrl =
    "https://api.met.no/weatherapi/nowcast/2.0/complete" +
    `?lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lon)}`;

  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Weather Bear bjornfalkenang@gmail.com",
      "Accept": "application/json"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    return {
      error: true,
      status: response.status,
      body: text
    };
  }

  return JSON.parse(text);
}

async function getCachedResponse(context, lat, lon) {
  const cache = caches.default;
  const cacheRequest = new Request(makeCacheKey(lat, lon), {
    method: "GET"
  });

  const cached = await cache.match(cacheRequest);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("x-weatherbear-cache", "HIT");
    return response;
  }

  const freshData = await fetchFreshNowcast(lat, lon);
  const status = freshData && freshData.error ? freshData.status || 502 : 200;

  const response = Response.json(freshData, {
    status,
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  if (status === 200) {
    context.waitUntil(cache.put(cacheRequest, response.clone()));
  }

  return response;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  const lat = normalizeCoord(url.searchParams.get("lat"), 59.3293);
  const lon = normalizeCoord(url.searchParams.get("lon"), 18.0686);

  try {
    return await getCachedResponse(context, lat, lon);
  } catch (error) {
    return Response.json(
      {
        error: true,
        message: error.message
      },
      { status: 500 }
    );
  }
}
