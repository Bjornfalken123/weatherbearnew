const CACHE_TTL_SECONDS = 5 * 60; // 5 minuter

function makeCacheKey(stationId, period) {
  return `https://weatherbear-cache.local/api/ocean-water-level/${encodeURIComponent(
    stationId
  )}/${encodeURIComponent(period)}`;
}

async function getCachedResponse(context, stationId, period) {
  const cache = caches.default;
  const cacheRequest = new Request(makeCacheKey(stationId, period), {
    method: "GET"
  });

  const cached = await cache.match(cacheRequest);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("x-weatherbear-cache", "HIT");
    return response;
  }

  const freshData = await fetchFreshOceanWaterLevel(stationId, period);

  const response = Response.json(freshData, {
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  context.waitUntil(cache.put(cacheRequest, response.clone()));

  return response;
}

async function fetchFreshOceanWaterLevel(stationId, period) {
  const url =
    `https://opendata-download-ocobs.smhi.se/api/version/latest/parameter/6` +
    `/station/${encodeURIComponent(stationId)}` +
    `/period/${encodeURIComponent(period)}` +
    `/data.json`;

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
  const url = new URL(context.request.url);

  const stationId = String(url.searchParams.get("stationId") || "").trim();
  const period = String(url.searchParams.get("period") || "latest-hour").trim();

  if (!stationId) {
    return Response.json(
      {
        error: true,
        message: "stationId saknas"
      },
      { status: 400 }
    );
  }

  try {
    return await getCachedResponse(context, stationId, period);
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
