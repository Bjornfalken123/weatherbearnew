const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";

const DEFAULT_LISTEN_MS = 9000;
const MAX_LISTEN_MS = 10000;
const BACKGROUND_REFRESH_LISTEN_MS = 9000;

const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 timme
const KV_KEY_PREFIX = "ais-region:";

const MANAGED_REGIONS = [
  {
    id: "oresund",
    name: "Öresund / Malmö / Köpenhamn",
    bbox: {
      minLon: 12.35,
      minLat: 55.55,
      maxLon: 12.85,
      maxLat: 55.85
    }
  },
  {
    id: "sweden-west",
    name: "Svenska västkusten",
    bbox: {
      minLon: 10.0,
      minLat: 55.0,
      maxLon: 13.3,
      maxLat: 59.6
    }
  },
  {
    id: "sweden-east",
    name: "Svenska ostkusten",
    bbox: {
      minLon: 13.0,
      minLat: 55.0,
      maxLon: 25.0,
      maxLat: 66.0
    }
  },
  {
    id: "malta",
    name: "Malta",
    bbox: {
      minLon: 13.7,
      minLat: 35.5,
      maxLon: 15.0,
      maxLat: 36.3
    }
  }
];

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function nowMs() {
  return Date.now();
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function cleanString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function normalizeShipType(value) {
  if (value == null || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : cleanString(value);
}

function parseBbox(raw) {
  if (!raw) return null;

  const parts = String(raw)
    .split(",")
    .map((v) => Number(String(v).trim()));

  if (parts.length !== 4) return null;
  if (parts.some((v) => !Number.isFinite(v))) return null;

  let [minLon, minLat, maxLon, maxLat] = parts;

  minLon = clampNumber(minLon, -180, 180);
  maxLon = clampNumber(maxLon, -180, 180);
  minLat = clampNumber(minLat, -90, 90);
  maxLat = clampNumber(maxLat, -90, 90);

  if (
    minLon == null ||
    maxLon == null ||
    minLat == null ||
    maxLat == null
  ) {
    return null;
  }

  if (minLon > maxLon) {
    const tmp = minLon;
    minLon = maxLon;
    maxLon = tmp;
  }

  if (minLat > maxLat) {
    const tmp = minLat;
    minLat = maxLat;
    maxLat = tmp;
  }

  return {
    minLon,
    minLat,
    maxLon,
    maxLat
  };
}

function bboxOverlaps(a, b) {
  return !(
    a.maxLon < b.minLon ||
    a.minLon > b.maxLon ||
    a.maxLat < b.minLat ||
    a.minLat > b.maxLat
  );
}

function isPointInsideBbox(vessel, bbox) {
  const lat = Number(vessel && vessel.lat);
  const lon = Number(vessel && vessel.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  return (
    lon >= bbox.minLon &&
    lon <= bbox.maxLon &&
    lat >= bbox.minLat &&
    lat <= bbox.maxLat
  );
}

function isPointInsideRegion(vessel, region) {
  return isPointInsideBbox(vessel, region.bbox);
}

function getManagedRegionsForBbox(bbox) {
  return MANAGED_REGIONS.filter((region) => bboxOverlaps(bbox, region.bbox));
}

function getKv(env) {
  return env.AIS_CACHE || null;
}

async function readRegionCache(env, regionId) {
  const kv = getKv(env);
  if (!kv) return null;

  const raw = await kv.get(KV_KEY_PREFIX + regionId, "json");

  if (!raw || !Array.isArray(raw.vessels)) {
    return {
      regionId,
      updatedAt: null,
      vesselCount: 0,
      vessels: []
    };
  }

  return raw;
}

async function writeRegionCache(env, regionId, payload) {
  const kv = getKv(env);
  if (!kv) return false;

  await kv.put(KV_KEY_PREFIX + regionId, JSON.stringify(payload));
  return true;
}

function getMessagePayload(msg) {
  if (!msg) return null;
  return msg.Message || msg;
}

function getMmsi(report) {
  return firstDefined(
    report && report.UserID,
    report && report.UserId,
    report && report.userId,
    report && report.MMSI,
    report && report.Mmsi,
    report && report.mmsi,
    report && report.MmsiNumber,
    report && report.mmsiNumber
  );
}

async function normalizeIncomingData(data) {
  if (typeof data === "string") return data;

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (data && typeof data.text === "function") {
    return data.text();
  }

  return String(data || "");
}

function extractPosition(payload, metadata) {
  const report =
    (payload && payload.PositionReport) ||
    (payload && payload.StandardClassBPositionReport) ||
    (payload && payload.ExtendedClassBPositionReport) ||
    (payload && payload.LongRangeAisBroadcastMessage) ||
    (payload && payload.BaseStationReport) ||
    (payload && payload.AidsToNavigationReport) ||
    (payload && payload.SearchAndRescueAircraftPositionReport) ||
    null;

  if (!report) return null;

  const lat = firstDefined(
    report.Latitude,
    report.latitude,
    report.Lat,
    report.lat,
    metadata && metadata.latitude,
    metadata && metadata.Latitude
  );

  const lon = firstDefined(
    report.Longitude,
    report.longitude,
    report.Lon,
    report.lon,
    report.Lng,
    report.lng,
    metadata && metadata.longitude,
    metadata && metadata.Longitude
  );

  const latNum = Number(lat);
  const lonNum = Number(lon);

  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return null;
  if (Math.abs(latNum) > 90 || Math.abs(lonNum) > 180) return null;

  const mmsi = firstDefined(
    getMmsi(report),
    metadata && metadata.MMSI,
    metadata && metadata.MMSI_String,
    metadata && metadata.mmsi
  );

  return {
    mmsi: mmsi == null ? null : String(mmsi),
    lat: latNum,
    lon: lonNum,
    cog: firstDefined(
      report.Cog,
      report.COG,
      report.CourseOverGround,
      report.courseOverGround,
      report.Course,
      report.course,
      0
    ),
    sog: firstDefined(
      report.Sog,
      report.SOG,
      report.SpeedOverGround,
      report.speedOverGround,
      report.Speed,
      report.speed
    ),
    heading: firstDefined(
      report.TrueHeading,
      report.Heading,
      report.heading
    ),
    navStatus: firstDefined(
      report.NavigationalStatus,
      report.NavigationStatus,
      report.navStatus
    ),
    name:
      cleanString(metadata && metadata.ShipName) ||
      cleanString(metadata && metadata.shipName) ||
      null,
    callsign:
      cleanString(metadata && metadata.CallSign) ||
      cleanString(metadata && metadata.callsign) ||
      null
  };
}

function extractStaticData(payload, metadata) {
  const ship =
    (payload && payload.ShipStaticData) ||
    (payload && payload.StaticDataReport) ||
    (payload && payload.StaticVoyageData) ||
    null;

  if (!ship) return null;

  let source = ship;

  if (ship.ReportA || ship.ReportB) {
    source = {
      ...ship,
      ...(ship.ReportA || {}),
      ...(ship.ReportB || {})
    };
  }

  const mmsi = firstDefined(
    source && getMmsi(source),
    metadata && metadata.MMSI,
    metadata && metadata.MMSI_String,
    metadata && metadata.mmsi
  );

  if (!mmsi) return null;

  return {
    mmsi: String(mmsi),
    name:
      cleanString(source && source.Name) ||
      cleanString(source && source.ShipName) ||
      cleanString(source && source.VesselName) ||
      cleanString(metadata && metadata.ShipName) ||
      cleanString(metadata && metadata.shipName),
    callsign:
      cleanString(source && source.CallSign) ||
      cleanString(source && source.Callsign) ||
      cleanString(source && source.CallsSignName) ||
      cleanString(metadata && metadata.CallSign) ||
      cleanString(metadata && metadata.callsign),
    imo: firstDefined(
      source && source.ImoNumber,
      source && source.IMO,
      source && source.Imo,
      source && source.imo,
      metadata && metadata.IMO,
      metadata && metadata.imo
    ),
    shipType: normalizeShipType(
      firstDefined(
        source && source.Type,
        source && source.ShipType,
        source && source.ShipAndCargoType,
        source && source.shipType
      )
    ),
    destination:
      cleanString(source && source.Destination) ||
      cleanString(source && source.destination),
    eta: firstDefined(
      source && source.Eta,
      source && source.ETA,
      source && source.eta
    ),
    dimensionToBow: firstDefined(
      source && source.DimensionToBow,
      source && source.ToBow
    ),
    dimensionToStern: firstDefined(
      source && source.DimensionToStern,
      source && source.ToStern
    ),
    dimensionToPort: firstDefined(
      source && source.DimensionToPort,
      source && source.ToPort
    ),
    dimensionToStarboard: firstDefined(
      source && source.DimensionToStarboard,
      source && source.ToStarboard
    )
  };
}

function vesselKey(vessel) {
  if (vessel && vessel.mmsi) return "mmsi:" + String(vessel.mmsi);

  if (
    Number.isFinite(Number(vessel && vessel.lat)) &&
    Number.isFinite(Number(vessel && vessel.lon))
  ) {
    return (
      "pos:" +
      Number(vessel.lat).toFixed(5) +
      ":" +
      Number(vessel.lon).toFixed(5)
    );
  }

  return "";
}

function getSeenTime(vessel) {
  const value = Number(
    vessel &&
      (vessel.lastSeenAt ||
        vessel.receivedAt ||
        vessel.cachedAt ||
        vessel.createdAt ||
        0)
  );

  return Number.isFinite(value) ? value : 0;
}

function hasValidPosition(vessel) {
  return (
    Number.isFinite(Number(vessel && vessel.lat)) &&
    Number.isFinite(Number(vessel && vessel.lon))
  );
}

function mergeVessel(existing, next) {
  const oldTime = getSeenTime(existing);
  const nextTime = getSeenTime(next);

  const existingHasPosition = hasValidPosition(existing);
  const nextHasPosition = hasValidPosition(next);

  let base = {
    ...(existing || {})
  };

  if (!existing || !existingHasPosition || (nextHasPosition && nextTime >= oldTime)) {
    base = {
      ...base,
      ...(next || {})
    };
  } else {
    base = {
      ...base,
      ...(next || {}),
      lat: existing.lat,
      lon: existing.lon,
      cog: existing.cog,
      sog: existing.sog,
      heading: existing.heading,
      navStatus: existing.navStatus,
      lastSeenAt: existing.lastSeenAt,
      receivedAt: Math.max(
        Number(existing.receivedAt || 0),
        Number(next && next.receivedAt ? next.receivedAt : 0)
      ) || existing.receivedAt
    };
  }

  base.static = {
    ...((existing && existing.static) || {}),
    ...((next && next.static) || {})
  };

  base.name =
    (next && next.name) ||
    (existing && existing.name) ||
    (base.static && base.static.name) ||
    null;

  base.callsign =
    (next && next.callsign) ||
    (existing && existing.callsign) ||
    (base.static && base.static.callsign) ||
    null;

  base.imo =
    (next && next.imo) ||
    (existing && existing.imo) ||
    (base.static && base.static.imo) ||
    null;

  base.shipType =
    (next && next.shipType) ??
    (existing && existing.shipType) ??
    (base.static && base.static.shipType) ??
    null;

  base.destination =
    (next && next.destination) ||
    (existing && existing.destination) ||
    (base.static && base.static.destination) ||
    null;

  base.eta =
    (next && next.eta) ||
    (existing && existing.eta) ||
    (base.static && base.static.eta) ||
    null;

  return base;
}

function pruneOldVessels(vessels) {
  const cutoff = nowMs() - CACHE_MAX_AGE_MS;

  return vessels.filter((vessel) => {
    const t = getSeenTime(vessel);
    return Number.isFinite(t) && t >= cutoff;
  });
}

function sortVessels(vessels) {
  return vessels.sort((a, b) => {
    return getSeenTime(b) - getSeenTime(a);
  });
}

function aisStreamBboxFromBbox(bbox) {
  return [
    [
      [bbox.minLat, bbox.minLon],
      [bbox.maxLat, bbox.maxLon]
    ]
  ];
}

async function fetchFreshAis({ apiKey, bbox, safeListenMs, debug }) {
  const vessels = new Map();

  const debugInfo = {
    connected: false,
    closed: false,
    errored: false,
    messages: 0,
    positionMessages: 0,
    staticMessages: 0,
    ignoredMessages: 0,
    messageTypes: {},
    firstMessages: [],
    lastError: null,
    bbox: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    aisStreamBbox: aisStreamBboxFromBbox(bbox),
    listenMs: safeListenMs
  };

  return new Promise((resolve) => {
    let finished = false;
    let finishTimer = null;
    let ws = null;

    function finish() {
      if (finished) return;
      finished = true;

      if (finishTimer) {
        clearTimeout(finishTimer);
        finishTimer = null;
      }

      try {
        if (ws && ws.readyState === 1) {
          ws.close();
        }
      } catch (_) {}

      const payload = {
        vessels: Array.from(vessels.values())
      };

      if (debug) {
        payload.debug = debugInfo;
      }

      resolve(payload);
    }

    try {
      ws = new WebSocket(AISSTREAM_URL);

      ws.addEventListener("open", () => {
        debugInfo.connected = true;

        ws.send(
          JSON.stringify({
            APIKey: apiKey,
            BoundingBoxes: aisStreamBboxFromBbox(bbox)
          })
        );

        finishTimer = setTimeout(finish, safeListenMs);
      });

      ws.addEventListener("message", async (event) => {
        try {
          const rawText = await normalizeIncomingData(event.data);

          if (debug && debugInfo.firstMessages.length < 3) {
            debugInfo.firstMessages.push(rawText.slice(0, 1200));
          }

          const msg = JSON.parse(rawText);

          debugInfo.messages += 1;

          const messageType =
            msg.MessageType ||
            msg.messageType ||
            "unknown";

          debugInfo.messageTypes[messageType] =
            (debugInfo.messageTypes[messageType] || 0) + 1;

          if (msg.Error || msg.error) {
            debugInfo.lastError = msg.Error || msg.error;
            return;
          }

          const payload = getMessagePayload(msg);
          const metadata = msg.MetaData || msg.metadata || null;

          if (!payload) {
            debugInfo.ignoredMessages += 1;
            return;
          }

          const position = extractPosition(payload, metadata);

          if (position) {
            debugInfo.positionMessages += 1;

            if (!isPointInsideBbox(position, bbox)) {
              return;
            }

            const key = vesselKey(position);
            if (!key) return;

            const existing = vessels.get(key);
            const ts = nowMs();

            const merged = mergeVessel(existing, {
              ...position,
              receivedAt: ts,
              lastSeenAt: ts,
              fromHostingCache: false
            });

            vessels.set(key, merged);
          }

          const staticData = extractStaticData(payload, metadata);

          if (staticData) {
            debugInfo.staticMessages += 1;

            const key = vesselKey(staticData);
            if (!key) return;

            const existing = vessels.get(key);
            const ts = nowMs();

            const merged = mergeVessel(existing, {
              mmsi: staticData.mmsi,
              name: staticData.name || (existing && existing.name) || null,
              callsign:
                staticData.callsign || (existing && existing.callsign) || null,
              imo: staticData.imo || (existing && existing.imo) || null,
              shipType:
                staticData.shipType ?? ((existing && existing.shipType) ?? null),
              destination:
                staticData.destination ||
                (existing && existing.destination) ||
                null,
              eta: staticData.eta || (existing && existing.eta) || null,
              static: staticData,
              receivedAt: ts,
              fromHostingCache: false
            });

            vessels.set(key, merged);
          }

          if (!position && !staticData) {
            debugInfo.ignoredMessages += 1;
          }
        } catch (error) {
          debugInfo.ignoredMessages += 1;
          debugInfo.lastError =
            error && error.message ? error.message : String(error);
        }
      });

      ws.addEventListener("error", () => {
        debugInfo.errored = true;
        finish();
      });

      ws.addEventListener("close", () => {
        debugInfo.closed = true;
        finish();
      });
    } catch (error) {
      debugInfo.errored = true;
      debugInfo.lastError =
        error && error.message ? error.message : String(error);
      finish();
    }
  });
}

async function getCachedVesselsForRequestBbox(env, requestBbox, overlappingRegions) {
  const cached = [];

  for (const region of overlappingRegions) {
    const regionCache = await readRegionCache(env, region.id);

    if (!regionCache || !Array.isArray(regionCache.vessels)) {
      continue;
    }

    for (const vessel of regionCache.vessels) {
      if (!isPointInsideBbox(vessel, requestBbox)) continue;

      cached.push({
        ...vessel,
        cacheRegion: vessel.cacheRegion || region.id,
        fromHostingCache: true
      });
    }
  }

  return pruneOldVessels(cached);
}

async function saveLiveVesselsToManagedRegionCaches(env, liveVessels) {
  const kv = getKv(env);

  if (!kv || !Array.isArray(liveVessels) || !liveVessels.length) {
    return 0;
  }

  let savedCount = 0;

  for (const region of MANAGED_REGIONS) {
    const liveInRegion = liveVessels.filter((vessel) =>
      isPointInsideRegion(vessel, region)
    );

    if (!liveInRegion.length) continue;

    const oldCache = await readRegionCache(env, region.id);

    const oldVessels =
      oldCache && Array.isArray(oldCache.vessels)
        ? oldCache.vessels
        : [];

    const merged = new Map();

    for (const oldVessel of oldVessels) {
      if (!isPointInsideRegion(oldVessel, region)) continue;

      const key = vesselKey(oldVessel);
      if (!key) continue;

      const existing = merged.get(key);

      merged.set(
        key,
        mergeVessel(existing, {
          ...oldVessel,
          fromHostingCache: true
        })
      );
    }

    for (const liveVessel of liveInRegion) {
      const key = vesselKey(liveVessel);
      if (!key) continue;

      const existing = merged.get(key);

      merged.set(
        key,
        mergeVessel(existing, {
          ...liveVessel,
          cachedAt: nowMs(),
          cacheRegion: region.id,
          fromHostingCache: false
        })
      );

      savedCount += 1;
    }

    const payloadVessels = sortVessels(
      pruneOldVessels(Array.from(merged.values()))
    );

    await writeRegionCache(env, region.id, {
      regionId: region.id,
      regionName: region.name,
      updatedAt: new Date().toISOString(),
      vesselCount: payloadVessels.length,
      vessels: payloadVessels
    });
  }

  return savedCount;
}

function mergeCachedAndLive(cachedVessels, liveVessels) {
  const merged = new Map();

  for (const cached of cachedVessels || []) {
    const key = vesselKey(cached);
    if (!key) continue;

    const existing = merged.get(key);

    merged.set(
      key,
      mergeVessel(existing, {
        ...cached,
        fromHostingCache: true
      })
    );
  }

  for (const live of liveVessels || []) {
    const key = vesselKey(live);
    if (!key) continue;

    const existing = merged.get(key);

    merged.set(
      key,
      mergeVessel(existing, {
        ...live,
        fromHostingCache: false
      })
    );
  }

  return sortVessels(pruneOldVessels(Array.from(merged.values())));
}

function runBackgroundRefresh(context, { apiKey, bbox, debug }) {
  if (!context || !context.waitUntil || !apiKey || !bbox) return;

  context.waitUntil(
    fetchFreshAis({
      apiKey,
      bbox,
      safeListenMs: BACKGROUND_REFRESH_LISTEN_MS,
      debug: false
    })
      .then(async (livePayload) => {
        const liveVessels = Array.isArray(livePayload.vessels)
          ? livePayload.vessels.filter((vessel) => isPointInsideBbox(vessel, bbox))
          : [];

        if (liveVessels.length) {
          await saveLiveVesselsToManagedRegionCaches(context.env, liveVessels);
        }

        if (debug) {
          console.log(
            "AIS background refresh",
            JSON.stringify({
              liveCount: liveVessels.length
            })
          );
        }
      })
      .catch((error) => {
        console.log(
          "AIS background refresh error",
          error && error.message ? error.message : String(error)
        );
      })
  );
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  const debug = url.searchParams.get("debug") === "1";
  const forceLive =
    url.searchParams.get("live") === "1" ||
    url.searchParams.get("forceLive") === "1";

  const bbox = parseBbox(url.searchParams.get("bbox"));

  const safeListenMs =
    clampNumber(url.searchParams.get("listenMs"), 1000, MAX_LISTEN_MS) ||
    DEFAULT_LISTEN_MS;

  if (!bbox) {
    return jsonResponse(
      {
        error: "bbox required",
        example: "/api/ais?bbox=10,55,13,59"
      },
      400
    );
  }

  const apiKey = context.env.AISSTREAM_API_KEY;

  if (!apiKey) {
    return jsonResponse(
      {
        error: "AISSTREAM_API_KEY missing",
        vessels: []
      },
      500
    );
  }

  const overlappingRegions = getManagedRegionsForBbox(bbox);
  const kvAvailable = !!getKv(context.env);

  let cachedVessels = [];
  let livePayload = null;
  let liveVessels = [];
  let savedCount = 0;

  try {
    if (overlappingRegions.length && kvAvailable) {
      cachedVessels = await getCachedVesselsForRequestBbox(
        context.env,
        bbox,
        overlappingRegions
      );
    }

    if (cachedVessels.length && !forceLive) {
      runBackgroundRefresh(context, {
        apiKey,
        bbox,
        debug
      });

      const mergedVessels = mergeCachedAndLive(cachedVessels, []);

      return jsonResponse({
        vessels: mergedVessels,
        cache: {
          mode: "KV_HOSTING_CACHE_FAST_BACKGROUND_REFRESH",
          kvAvailable,
          overlappingRegions: overlappingRegions.map((r) => r.id),
          liveCount: 0,
          cachedCount: cachedVessels.length,
          mergedCount: mergedVessels.length,
          savedCount: 0,
          backgroundRefresh: true
        }
      });
    }

    livePayload = await fetchFreshAis({
      apiKey,
      bbox,
      safeListenMs,
      debug
    });

    liveVessels = Array.isArray(livePayload.vessels)
      ? livePayload.vessels.filter((vessel) => isPointInsideBbox(vessel, bbox))
      : [];

    if (kvAvailable && liveVessels.length) {
      savedCount = await saveLiveVesselsToManagedRegionCaches(
        context.env,
        liveVessels
      );
    }

    const mergedVessels = mergeCachedAndLive(cachedVessels, liveVessels);

    const response = {
      vessels: mergedVessels,
      cache: {
        mode:
          overlappingRegions.length && kvAvailable
            ? "KV_HOSTING_CACHE_PLUS_LIVE"
            : "LIVE_GLOBAL_ONLY",
        kvAvailable,
        overlappingRegions: overlappingRegions.map((r) => r.id),
        liveCount: liveVessels.length,
        cachedCount: cachedVessels.length,
        mergedCount: mergedVessels.length,
        savedCount,
        backgroundRefresh: false
      }
    };

    if (debug) {
      response.debug = livePayload && livePayload.debug ? livePayload.debug : null;
    }

    return jsonResponse(response);
  } catch (error) {
    return jsonResponse(
      {
        error: true,
        message: error && error.message ? error.message : String(error),
        vessels: [],
        cache: {
          mode: "ERROR",
          kvAvailable,
          overlappingRegions: overlappingRegions.map((r) => r.id),
          liveCount: liveVessels.length,
          cachedCount: cachedVessels.length,
          savedCount,
          backgroundRefresh: false
        }
      },
      500
    );
  }
}
