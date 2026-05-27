const AIS_CACHE_TTL_SECONDS = 60 * 60 * 6;
const AIS_VISIBLE_MAX_AGE_MS = 60 * 60 * 1000;

const AIS_CACHE_REGIONS = [
  {
    id: "sweden-west",
    name: "Svenska västkusten",
    bbox: [10.0, 55.0, 13.2, 59.5]
  },
  {
    id: "sweden-east",
    name: "Svenska östkusten",
    bbox: [14.0, 55.0, 24.5, 66.0]
  },
  {
    id: "malta",
    name: "Malta",
    bbox: [13.5, 35.3, 15.0, 36.4]
  }
];

export function parseBbox(raw) {
  if (!raw) return null;

  const parts = String(raw)
    .split(",")
    .map((value) => Number(value.trim()));

  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [west, south, east, north] = parts;

  return { west, south, east, north };
}

function getNumberValue() {
  for (const value of arguments) {
    const numberValue = Number(value);

    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }

  return null;
}

function getStringValue() {
  for (const value of arguments) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

export function getAisLat(vessel) {
  return getNumberValue(
    vessel.lat,
    vessel.latitude,
    vessel.Latitude,
    vessel.LAT,
    vessel.position && vessel.position.lat,
    vessel.position && vessel.position.latitude,
    vessel.Position && vessel.Position.Latitude,
    vessel.Message && vessel.Message.PositionReport && vessel.Message.PositionReport.Latitude,
    vessel.Message && vessel.Message.StandardClassBPositionReport && vessel.Message.StandardClassBPositionReport.Latitude,
    vessel.Message && vessel.Message.ExtendedClassBPositionReport && vessel.Message.ExtendedClassBPositionReport.Latitude
  );
}

export function getAisLon(vessel) {
  return getNumberValue(
    vessel.lon,
    vessel.lng,
    vessel.longitude,
    vessel.Longitude,
    vessel.LON,
    vessel.position && vessel.position.lon,
    vessel.position && vessel.position.lng,
    vessel.position && vessel.position.longitude,
    vessel.Position && vessel.Position.Longitude,
    vessel.Message && vessel.Message.PositionReport && vessel.Message.PositionReport.Longitude,
    vessel.Message && vessel.Message.StandardClassBPositionReport && vessel.Message.StandardClassBPositionReport.Longitude,
    vessel.Message && vessel.Message.ExtendedClassBPositionReport && vessel.Message.ExtendedClassBPositionReport.Longitude
  );
}

export function getAisMmsi(vessel) {
  return getStringValue(
    vessel.mmsi,
    vessel.MMSI,
    vessel.mmsiNumber,
    vessel.Mmsi,
    vessel.UserID,
    vessel.userId,
    vessel.user_id,
    vessel.static && vessel.static.mmsi,
    vessel.static && vessel.static.MMSI,
    vessel.MetaData && vessel.MetaData.MMSI,
    vessel.metadata && vessel.metadata.mmsi,
    vessel.Message && vessel.Message.PositionReport && vessel.Message.PositionReport.UserID,
    vessel.Message && vessel.Message.StandardClassBPositionReport && vessel.Message.StandardClassBPositionReport.UserID,
    vessel.Message && vessel.Message.ExtendedClassBPositionReport && vessel.Message.ExtendedClassBPositionReport.UserID
  );
}

function isPointInsideBbox(lat, lon, bbox) {
  if (!bbox) return false;

  return (
    lon >= bbox.west &&
    lon <= bbox.east &&
    lat >= bbox.south &&
    lat <= bbox.north
  );
}

function bboxArrayToObject(bbox) {
  return {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3]
  };
}

function getRegionForVessel(vessel) {
  const lat = getAisLat(vessel);
  const lon = getAisLon(vessel);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return AIS_CACHE_REGIONS.find((region) => {
    return isPointInsideBbox(lat, lon, bboxArrayToObject(region.bbox));
  }) || null;
}

function getCacheKey(regionId, mmsi) {
  return `ais:${regionId}:${mmsi}`;
}

export async function saveAisVesselsToCache(kv, vessels) {
  if (!kv || !Array.isArray(vessels) || !vessels.length) {
    return { saved: 0 };
  }

  let saved = 0;
  const now = Date.now();

  await Promise.all(
    vessels.map(async (vessel) => {
      const mmsi = getAisMmsi(vessel);
      if (!mmsi) return;

      const lat = getAisLat(vessel);
      const lon = getAisLon(vessel);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return;
      }

      const region = getRegionForVessel(vessel);
      if (!region) return;

      const cachedVessel = {
        ...vessel,
        mmsi,
        lat,
        lon,
        lastSeenAt: Number(vessel.lastSeenAt || vessel.receivedAt || vessel.timestamp || vessel.time) || now,
        cachedAt: now,
        cacheRegion: region.id
      };

      await kv.put(
        getCacheKey(region.id, mmsi),
        JSON.stringify(cachedVessel),
        {
          expirationTtl: AIS_CACHE_TTL_SECONDS,
          metadata: {
            regionId: region.id,
            mmsi,
            lat,
            lon,
            cachedAt: now
          }
        }
      );

      saved += 1;
    })
  );

  return { saved };
}

export async function getCachedAisVesselsForBbox(kv, bbox) {
  if (!kv || !bbox) {
    return [];
  }

  const now = Date.now();
  const results = [];

  for (const region of AIS_CACHE_REGIONS) {
    const list = await kv.list({
      prefix: `ais:${region.id}:`
    });

    for (const key of list.keys || []) {
      const metadata = key.metadata || {};
      const lat = Number(metadata.lat);
      const lon = Number(metadata.lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        continue;
      }

      if (!isPointInsideBbox(lat, lon, bbox)) {
        continue;
      }

      const cachedAt = Number(metadata.cachedAt || 0);

      if (cachedAt && now - cachedAt > AIS_VISIBLE_MAX_AGE_MS) {
        continue;
      }

      const vessel = await kv.get(key.name, "json");

      if (vessel) {
        results.push({
          ...vessel,
          fromHostingCache: true
        });
      }
    }
  }

  return results;
}

export function mergeAisVessels(liveVessels, cachedVessels) {
  const merged = new Map();

  for (const vessel of cachedVessels || []) {
    const mmsi = getAisMmsi(vessel);
    if (!mmsi) continue;

    merged.set(mmsi, vessel);
  }

  for (const vessel of liveVessels || []) {
    const mmsi = getAisMmsi(vessel);
    if (!mmsi) continue;

    merged.set(mmsi, {
      ...vessel,
      fromHostingCache: false
    });
  }

  return Array.from(merged.values());
}
