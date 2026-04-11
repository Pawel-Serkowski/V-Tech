const EARTH = {
  center: { x: 0, y: 0, z: 0 },
  radiusKm: 6371,
  mu: 398600.4418,
};

const MOON = {
  center: { x: 384400, y: 0, z: 0 },
  radiusKm: 1737.4,
  mu: 4902.8001,
};

function degToRad(value) {
  return (Number(value) * Math.PI) / 180;
}

function hashStringTo01(value) {
  const text = String(value || "node");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 1000000;
  }
  return hash / 1000000;
}

function bodyFromNode(node) {
  const direct = String(node?.body || "").toLowerCase();
  const orbiting = String(node?.orbiting_body || "").toLowerCase();
  const orbit = String(node?.orbit || "").toLowerCase();

  if (direct === "earth" || orbiting === "earth" || orbit.includes("earth")) {
    return "earth";
  }
  if (direct === "moon" || orbiting === "moon" || orbit.includes("moon") || orbit.includes("lunar")) {
    return "moon";
  }
  return "earth";
}

function parseCartesian(node) {
  const x = Number(node?.position_x_km);
  const y = Number(node?.position_y_km);
  const z = Number(node?.position_z_km);

  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    return { x, y, z };
  }

  return null;
}

function surfacePosition(node, body) {
  const lat = Number(node?.surface_lat_deg);
  const lon = Number(node?.surface_lon_deg);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const latRad = degToRad(lat);
  const lonRad = degToRad(lon);

  const cosLat = Math.cos(latRad);

  return {
    x: body.center.x + body.radiusKm * cosLat * Math.cos(lonRad),
    y: body.center.y + body.radiusKm * cosLat * Math.sin(lonRad),
    z: body.center.z + body.radiusKm * Math.sin(latRad),
  };
}

function orbitalPosition(node, bodyName, elapsedSeconds = 0) {
  const body = bodyName === "moon" ? MOON : EARTH;
  const altitude = Number(node?.orbit_altitude_km);

  if (!Number.isFinite(altitude)) {
    return null;
  }

  const radius = body.radiusKm + Math.max(0, altitude);
  const inclination = degToRad(node?.orbital_inclination_deg || 0);
  const basePhase = degToRad(node?.orbital_phase_deg || 0);
  const angularVelocity = Math.sqrt(body.mu / Math.max(radius ** 3, 1));
  const phase = basePhase + angularVelocity * elapsedSeconds;

  const xLocal = radius * Math.cos(phase);
  const yBase = radius * Math.sin(phase);
  const yLocal = yBase * Math.cos(inclination);
  const zLocal = yBase * Math.sin(inclination);

  return {
    x: body.center.x + xLocal,
    y: body.center.y + yLocal,
    z: body.center.z + zLocal,
    velocityKms: Math.sqrt(body.mu / Math.max(radius, 1)),
    orbitalRadiusKm: radius,
  };
}

function fallbackPosition(node) {
  const bodyName = bodyFromNode(node);
  const body = bodyName === "moon" ? MOON : EARTH;
  const t = hashStringTo01(node?.node_id || "node");
  const radius = body.radiusKm + (node?.node_type === "ground_station" ? 120 : 1200 + 4200 * t);
  const angle = t * Math.PI * 2;

  return {
    x: body.center.x + radius * Math.cos(angle),
    y: body.center.y + radius * Math.sin(angle),
    z: body.center.z + radius * Math.sin(angle * 0.6) * 0.2,
  };
}

export function resolveNodePosition(node, elapsedSeconds = 0) {
  const bodyName = bodyFromNode(node);
  const body = bodyName === "moon" ? MOON : EARTH;

  const direct = parseCartesian(node);
  if (direct) {
    return {
      ...direct,
      velocityKms: null,
      bodyName,
    };
  }

  const surface = surfacePosition(node, body);
  if (surface) {
    return {
      ...surface,
      velocityKms: 0,
      bodyName,
    };
  }

  const orbital = orbitalPosition(node, bodyName, elapsedSeconds);
  if (orbital) {
    return {
      ...orbital,
      bodyName,
    };
  }

  return {
    ...fallbackPosition(node),
    velocityKms: null,
    bodyName,
  };
}

export function toCanvasPoint(position, bounds, width, height) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  const padX = safeWidth * 0.08;
  const padY = safeHeight * 0.14;
  const xSpan = Math.max(1, bounds.maxX - bounds.minX);
  const zSpan = Math.max(1, bounds.maxZ - bounds.minZ);

  const xRatio = (position.x - bounds.minX) / xSpan;
  const zRatio = (position.z - bounds.minZ) / zSpan;

  return {
    x: padX + xRatio * (safeWidth - padX * 2),
    y: safeHeight - (padY + zRatio * (safeHeight - padY * 2)),
  };
}

export function computeBounds(positions) {
  const points = [
    ...positions,
    { x: EARTH.center.x, z: EARTH.center.z },
    { x: MOON.center.x, z: MOON.center.z },
  ];

  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}
