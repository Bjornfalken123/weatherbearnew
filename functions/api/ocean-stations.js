const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 timmar
const CACHE_KEY = "https://weatherbear-cache.local/api/ocean-stations";

async function getCachedResponse(context) {
  const cache = caches.default;
  const cacheRequest = new Request(CACHE_KEY, {
    method: "GET"
  });

  const cached = await cache.match(cacheRequest);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("x-weatherbear-cache", "HIT");
    return response;
  }

  const freshData = await fetchFreshOceanStations();

  const response = Response.json(freshData, {
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  context.waitUntil(cache.put(cacheRequest, response.clone()));

  return response;
}

async function fetchFreshOceanStations() {
  const url =
    "https://opendata-download-ocobs.smhi.se/api/version/latest/parameter/6.json";

  const response = await fetch(url, {
    headers: {
      "User-Agent": "weather-dashboard/1.0 bjorn.falkenang@gmail.com"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    return {
      error: true,
      source: "SMHI",
      status: response.status,
      body: text
    };
  }

  return JSON.parse(text);
}

export async function onRequestGet(context) {
  try {
    return await getCachedResponse(context);
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
