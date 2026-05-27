const CACHE_TTL_SECONDS = 5 * 60; // 5 minuter

function normalizeCoord(value, fallback) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return Number(fallback).toFixed(4);
  }

  return n.toFixed(4);
}

function makeCacheKey(lat, lon) {
  return `https://weatherbear-cache.local/api/weather/${encodeURIComponent(
    lat
  )}/${encodeURIComponent(lon)}`;
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

  const freshData = await fetchFreshWeather(lat, lon);

  const response = Response.json(freshData, {
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  context.waitUntil(cache.put(cacheRequest, response.clone()));

  return response;
}

async function fetchFreshWeather(lat, lon) {
  const apiUrl =
    "https://api.met.no/weatherapi/locationforecast/2.0/compact" +
    `?lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lon)}`;

  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "weather-dashboard/1.0 bjorn.falkenang@gmail.com"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    return {
      error: true,
      source: "MET Norway",
      status: response.status,
      body: text
    };
  }

  return JSON.parse(text);
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
