const CACHE_TTL_SECONDS = 2 * 60; // 2 minuter
const CACHE_KEY = "https://weatherbear-cache.local/api/frames";

const SMHI_LATEST_RADAR =
  "https://opendata-download-radar.smhi.se/api/version/latest/area/sweden/product/comp/latest.png";

function formatLabelSv(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm"
  })
    .format(date)
    .replace(".", "");
}

function arrayBufferToBase64(arrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binary);
}

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

  const freshData = await fetchFreshFrames();

  const response = Response.json(freshData, {
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-weatherbear-cache": "MISS"
    }
  });

  context.waitUntil(cache.put(cacheRequest, response.clone()));

  return response;
}

async function fetchFreshFrames() {
  const now = new Date();

  const upstream = await fetch(SMHI_LATEST_RADAR, {
    headers: {
      "User-Agent": "KustvaderRadar/1.0"
    }
  });

  if (!upstream.ok) {
    throw new Error(`SMHI radar returned ${upstream.status}`);
  }

  const contentType = upstream.headers.get("content-type") || "image/png";
  const arrayBuffer = await upstream.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);

  return {
    source: "SMHI",
    frames: [
      {
        kind: "radar",
        label: `Nu • ${formatLabelSv(now)}`,
        imageUrl: `data:${contentType};base64,${base64}`,
        timestamp: now.toISOString()
      }
    ]
  };
}

export async function onRequestGet(context) {
  try {
    return await getCachedResponse(context);
  } catch (error) {
    return Response.json(
      {
        message: "Det gick inte att hämta radarbild från SMHI",
        details: error?.message || "okänt fel"
      },
      { status: 500 }
    );
  }
}
