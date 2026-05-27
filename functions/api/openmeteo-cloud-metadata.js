const OPEN_METEO_METADATA_URL =
  "https://map-tiles.open-meteo.com/data_spatial/dwd_icon/latest.json";

export async function onRequestGet(context) {
  const { request, waitUntil } = context;

  const cache = caches.default;
  const cacheUrl = new URL(request.url);

  // Stabil cache key för just denna endpoint
  const cacheKey = new Request(cacheUrl.toString(), {
    method: "GET"
  });

  const cached = await cache.match(cacheKey);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("x-weatherbear-cache", "HIT");
    return response;
  }

  const originResponse = await fetch(OPEN_METEO_METADATA_URL, {
    headers: {
      "accept": "application/json"
    }
  });

  if (!originResponse.ok) {
    return new Response(
      JSON.stringify({
        error: "Open-Meteo metadata kunde inte hämtas",
        status: originResponse.status
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-weatherbear-cache": "ERROR"
        }
      }
    );
  }

  const data = await originResponse.text();

  const response = new Response(data, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",

      // Browsern får återanvända kort, Cloudflare får hålla 1 timme.
      "cache-control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=300",

      "access-control-allow-origin": "*",
      "x-weatherbear-cache": "MISS"
    }
  });

  waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
