import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { resolveNodePosition } from "../utils/orbit-utils";

export function mountVisualization(options = {}) {
const root = options.root ?? document;
const getTelemetrySnapshot =
  typeof options.getTelemetrySnapshot === "function"
    ? options.getTelemetrySnapshot
    : () => ({ packets: [], nodes: [] });

const app = root.querySelector("#app");
const networkHost = root.querySelector('[data-canvas-host="network"]');
const plannerHost = root.querySelector('[data-canvas-host="planner"]');
const tabs = [...root.querySelectorAll("[data-tab]")];
const views = [...root.querySelectorAll("[data-view]")];
const satelliteName = root.querySelector("[data-satellite-name]");
const satelliteMeta = root.querySelector("[data-satellite-meta]");
const satelliteDescription = root.querySelector("[data-satellite-description]");
const satelliteHint = root.querySelector("[data-satellite-hint]");
const mqttTopic = root.querySelector("[data-mqtt-topic]");
const mqttRoute = root.querySelector("[data-mqtt-route]");
const mqttPayload = root.querySelector("[data-mqtt-payload]");
const mqttStatus = root.querySelector("[data-mqtt-status]");

if (!app || !networkHost || !plannerHost || !mqttTopic || !mqttRoute || !mqttPayload || !mqttStatus) {
  return () => {};
}

const getViewportSize = () => {
  if (document.fullscreenElement) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  const width = Math.max(networkHost.clientWidth, app.clientWidth, 1);
  const height = Math.max(networkHost.clientHeight, app.clientHeight, 1);
  return { width, height };
};

const getPacketText = (packet) => {
  if (!packet) {
    return null;
  }
  if (typeof packet.payload === "string") {
    return packet.payload;
  }
  try {
    return JSON.stringify(packet.payload ?? {});
  } catch {
    return "{payload:unavailable}";
  }
};

const ACTIVE_ROUTE_STATUSES = new Set(["IN_TRANSIT"]);

const getLivePacket = () => {
  const snapshot = getTelemetrySnapshot();
  const packets = Array.isArray(snapshot?.packets) ? snapshot.packets : [];
  if (packets.length === 0) {
    return null;
  }

  const preferred = packets.find((packet) => {
    const status = String(packet?.current_status ?? "").toUpperCase();
    return ACTIVE_ROUTE_STATUSES.has(status);
  });

  return preferred ?? null;
};

const scene = new THREE.Scene();
scene.background = new THREE.Color("#02030b");
scene.fog = new THREE.FogExp2("#02030b", 0.012);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const initialViewport = getViewportSize();
renderer.setSize(initialViewport.width, initialViewport.height);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
networkHost.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(55, initialViewport.width / initialViewport.height, 0.1, 240);
camera.position.set(0, 6.4, 17.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 2.5;
controls.maxDistance = 250;
controls.target.set(0, 1.1, 0);

scene.add(new THREE.AmbientLight("#4f5d82", 0.18));
scene.add(new THREE.HemisphereLight("#9db8ff", "#02030b", 0.22));

const sunLight = new THREE.DirectionalLight("#fff3d1", 3.4);
sunLight.position.set(20, 8, 14);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 80;
sunLight.shadow.camera.left = -14;
sunLight.shadow.camera.right = 14;
sunLight.shadow.camera.top = 14;
sunLight.shadow.camera.bottom = -14;
scene.add(sunLight);

const backLight = new THREE.PointLight("#4db8ff", 7, 80, 2);
backLight.position.set(-18, -5, -20);
scene.add(backLight);

const sunGroup = new THREE.Group();
sunGroup.position.copy(sunLight.position).multiplyScalar(2.8);
scene.add(sunGroup);
sunGroup.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(3.8, 48, 48),
    new THREE.MeshBasicMaterial({ color: "#ffd977" })
  )
);
const sunHalo = new THREE.Mesh(
  new THREE.SphereGeometry(5.2, 32, 32),
  new THREE.MeshBasicMaterial({
    color: "#ffcc66",
    transparent: true,
    opacity: 0.12,
    side: THREE.BackSide,
  })
);
sunGroup.add(sunHalo);

const textureLoader = new THREE.TextureLoader();
const earthDayTexture = textureLoader.load("/textures/earth_day.jpg");
const earthNormalTexture = textureLoader.load("/textures/earth_normal.jpg");
const earthSpecularTexture = textureLoader.load("/textures/earth_specular.jpg");
const earthCloudTexture = textureLoader.load("/textures/earth_clouds.png");
const earthNightTexture = textureLoader.load("/textures/earth_night.png");
const moonTexture = textureLoader.load("/textures/moon.jpg");

[earthDayTexture, earthCloudTexture, earthNightTexture, moonTexture].forEach((texture) => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
});
[earthNormalTexture, earthSpecularTexture].forEach((texture) => {
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
});

const earthGroup = new THREE.Group();
scene.add(earthGroup);
const earthSurfaceGroup = new THREE.Group();
earthGroup.add(earthSurfaceGroup);

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(2, 96, 96),
  new THREE.MeshPhongMaterial({
    map: earthDayTexture,
    normalMap: earthNormalTexture,
    specularMap: earthSpecularTexture,
    shininess: 20,
    specular: new THREE.Color("#28446b"),
    emissive: "#050812",
    emissiveIntensity: 0.08,
  })
);
earth.castShadow = true;
earth.receiveShadow = true;
earthSurfaceGroup.add(earth);

const earthNightLayer = new THREE.Mesh(
  new THREE.SphereGeometry(2.012, 96, 96),
  new THREE.MeshBasicMaterial({
    map: earthNightTexture,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
earthSurfaceGroup.add(earthNightLayer);

const cloudLayer = new THREE.Mesh(
  new THREE.SphereGeometry(2.05, 96, 96),
  new THREE.MeshStandardMaterial({
    map: earthCloudTexture,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
  })
);
earthSurfaceGroup.add(cloudLayer);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(2.12, 64, 64),
  new THREE.MeshPhongMaterial({
    color: "#77d2ff",
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
);
earthSurfaceGroup.add(atmosphere);

const earthGlow = new THREE.Mesh(
  new THREE.SphereGeometry(2.22, 64, 64),
  new THREE.MeshBasicMaterial({
    color: "#2da6ff",
    transparent: true,
    opacity: 0.08,
    side: THREE.BackSide,
  })
);
earthSurfaceGroup.add(earthGlow);

const moonPivot = new THREE.Group();
scene.add(moonPivot);
moonPivot.rotation.z = THREE.MathUtils.degToRad(16);

const moonGroup = new THREE.Group();
moonGroup.position.x = 28.0;
moonPivot.add(moonGroup);
const moonSurfaceGroup = new THREE.Group();
moonGroup.add(moonSurfaceGroup);

const moon = new THREE.Mesh(
  new THREE.SphereGeometry(0.68, 64, 64),
  new THREE.MeshStandardMaterial({
    map: moonTexture,
    bumpMap: moonTexture,
    bumpScale: 0.03,
    roughness: 1,
    metalness: 0.01,
    emissive: "#0c1018",
    emissiveIntensity: 0.04,
  })
);
moon.castShadow = true;
moon.receiveShadow = true;
moonSurfaceGroup.add(moon);

moonSurfaceGroup.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(0.77, 32, 32),
    new THREE.MeshBasicMaterial({
      color: "#dce7ff",
      transparent: true,
      opacity: 0.05,
      side: THREE.BackSide,
    })
  )
);

const orbitingBodies = [];
const selectableSatellites = [];
const nodeLookup = new Map();
const relayBeams = [];
const earthRelayIds = [];
const moonRelayIds = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const timer = new THREE.Timer();
timer.connect(document);

const EARTH_RADIUS = 2.22;
const MOON_RADIUS = 0.77;
const bodies = [
  { id: "earth", getCenter: () => earthGroup.getWorldPosition(new THREE.Vector3()), radius: EARTH_RADIUS },
  { id: "moon", getCenter: () => moonGroup.getWorldPosition(new THREE.Vector3()), radius: MOON_RADIUS },
];

function getOrbitalAngularSpeed(radius, system, direction = 1) {
  const baseSpeed = system === "earth" ? 1.05 : 0.82;
  const normalizedRadius = Math.max(radius, 0.5);
  return direction * (baseSpeed / normalizedRadius ** 1.5);
}

function updateSatellitePanel(data) {
  if (!satelliteName || !satelliteMeta || !satelliteDescription || !satelliteHint) {
    return;
  }

  if (!data) {
    satelliteName.textContent = "Wybierz obiekt";
    satelliteMeta.textContent = "Kliknij satelite lub baze na Ziemi/Ksiezycu";
    satelliteDescription.textContent =
      "Po zaznaczeniu pokaze nazwe, typ obiektu i krotka informacje o polaczeniach.";
    satelliteHint.textContent = "Aktywne: brak";
    return;
  }

  satelliteName.textContent = data.name;
  satelliteMeta.textContent = `${data.family} | ${data.orbit}`;
  satelliteDescription.textContent = data.description;
  satelliteHint.textContent = `Aktywne: ${data.status}`;
}

function updateMqttPanel(route) {
  if (!route) {
    mqttTopic.textContent = "Temat: mqtt/relay/idle";
    mqttRoute.textContent = "Trasa: oczekiwanie na aktywna sciezke";
    mqttPayload.textContent = "Payload: brak aktywnych pakietow";
    mqttStatus.textContent = "Status: broker gotowy";
    return;
  }

  mqttTopic.textContent = `Temat: ${route.topic}`;
  mqttRoute.textContent = `Trasa: ${route.names.join(" -> ")}`;
  mqttPayload.textContent = `Payload: ${route.payload}`;
  mqttStatus.textContent = `Status: QoS ${route.qos} | ${route.status}`;
}

function setSatelliteSelection(data) {
  selectableSatellites.forEach((item) => {
    const active = data && item.data.id === data.id;
    item.parts.forEach((part) => {
      part.material.emissiveIntensity = active ? item.baseEmissive * 2.2 : item.baseEmissive;
      part.scale.setScalar(active ? 1.12 : 1);
    });
  });

  relayBeams.forEach((beam) => {
    const related =
      data &&
      beam.currentNodes &&
      beam.currentNodes.some((node) => node.id === data.id);
    beam.line.material.opacity = related ? 0.82 : beam.baseOpacity;
    beam.marker.material.opacity = related ? 1 : 0.84;
    beam.marker.scale.setScalar(related ? 1.2 : 1);
  });

  updateSatellitePanel(data);
}

function createOrbitLine(radius, color, opacity, parent, squash = 0.82) {
  const curve = new THREE.EllipseCurve(0, 0, radius, radius * squash, 0, Math.PI * 2, false, 0);
  const points = curve.getPoints(280).map((point) => new THREE.Vector3(point.x, 0, point.y));
  const orbitLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  );
  parent.add(orbitLine);
  return orbitLine;
}

function registerNode(id, data) {
  nodeLookup.set(id, data);
}

function createBase(parent, options) {
  const base = new THREE.Group();
  const normal = new THREE.Vector3(...options.normal).normalize();
  base.position.copy(normal.clone().multiplyScalar(options.radius));
  base.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

  const data = {
    id: options.id,
    name: options.name,
    family: options.family,
    orbit: options.orbit,
    description: options.description,
    status: options.status,
  };

  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.08, 20),
    new THREE.MeshStandardMaterial({
      color: options.color,
      emissive: options.color,
      emissiveIntensity: 0.18,
      roughness: 0.6,
      metalness: 0.35,
    })
  );
  pad.castShadow = true;
  base.add(pad);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 20, 20),
    new THREE.MeshBasicMaterial({ color: options.glowColor, transparent: true, opacity: 0.9 })
  );
  dome.position.y = 0.08;
  dome.scale.y = 0.7;
  base.add(dome);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.18, 12),
    new THREE.MeshStandardMaterial({ color: "#f1f5ff", roughness: 0.4, metalness: 0.7 })
  );
  mast.position.y = 0.16;
  base.add(mast);

  const hitTarget = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 16),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hitTarget.position.y = 0.12;
  hitTarget.userData.satellite = data;
  base.add(hitTarget);

  parent.add(base);

  const selectableEntry = {
    data,
    hitTarget,
    parts: [pad],
    baseEmissive: 0.18,
  };
  selectableSatellites.push(selectableEntry);

  registerNode(options.id, {
    ...data,
    kind: "base",
    bodyId: options.bodyId,
    getWorldPosition: () => base.getWorldPosition(new THREE.Vector3()),
  });

  return { mesh: base, hitTarget, data, selectableEntry };
}

function createSatellite(parent, options) {
  const satellite = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: options.bodyColor,
    emissive: options.bodyColor,
    emissiveIntensity: 0.16,
    roughness: 0.52,
    metalness: 0.72,
  });
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: options.panelColor,
    emissive: options.panelColor,
    emissiveIntensity: 0.22,
    roughness: 0.28,
    metalness: 0.84,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.22), bodyMaterial);
  body.castShadow = true;
  satellite.add(body);

  const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.12), panelMaterial);
  leftPanel.position.x = -0.21;
  satellite.add(leftPanel);

  const rightPanel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.12), panelMaterial);
  rightPanel.position.x = 0.21;
  satellite.add(rightPanel);

  const hitTarget = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 16),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  satellite.add(hitTarget);
  parent.add(satellite);

  const data = {
    id: options.id,
    name: options.name,
    family: options.family,
    orbit: options.orbit,
    description: options.description,
    status: options.status,
  };

  hitTarget.userData.satellite = data;
  const selectableEntry = {
    data,
    hitTarget,
    parts: [body, leftPanel, rightPanel],
    baseEmissive: 0.16,
  };
  selectableSatellites.push(selectableEntry);

  registerNode(options.id, {
    ...data,
    kind: "satellite",
    bodyId: options.bodyId,
    getWorldPosition: () => satellite.getWorldPosition(new THREE.Vector3()),
  });

  if (options.network === "earth") {
    earthRelayIds.push(options.id);
  } else if (options.network === "moon") {
    moonRelayIds.push(options.id);
  }

  let orbitEntry = null;

  if (options.staticPlacement?.position) {
    satellite.position.copy(options.staticPlacement.position);
    if (options.staticPlacement.lookAt) {
      satellite.lookAt(options.staticPlacement.lookAt);
    }
  } else {
    orbitEntry = {
      mesh: satellite,
      radiusX: options.radius,
      radiusZ: options.radius * options.eccentricity,
      speed: getOrbitalAngularSpeed(options.radius, options.network, options.direction ?? 1),
      angle: options.angle,
      tiltX: options.tiltX,
      tiltZ: options.tiltZ,
    };
    orbitingBodies.push(orbitEntry);
  }

  return {
    mesh: satellite,
    hitTarget,
    data,
    selectableEntry,
    orbitEntry,
  };
}

function createRelayBeam(color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(line);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 16, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.84 })
  );
  scene.add(marker);

  relayBeams.push({
    line,
    marker,
    color,
    baseOpacity: 0.22,
    currentNodes: null,
  });
}

const liveNodeVisuals = new Map();
let liveNodeSignature = "";

function hashNumber(input, seed = 0) {
  let hash = seed;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function classifyNetwork(node) {
  const explicitBody = String(node?.body ?? node?.orbiting_body ?? "").toLowerCase();
  if (explicitBody === "moon") {
    return "moon";
  }
  if (explicitBody === "earth") {
    return "earth";
  }

  const text = [node.node_id, node.orbit, node.location_label]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/moon|luna|lunar|nrho|selene/.test(text)) {
    return "moon";
  }

  return "earth";
}

const BODY_WORLD_CENTER = {
  earth: new THREE.Vector3(0, 0, 0),
  moon: new THREE.Vector3(384400, 0, 0),
};

const BODY_WORLD_RADIUS_KM = {
  earth: 6371,
  moon: 1737.4,
};

const BODY_SCENE_SURFACE_RADIUS = {
  earth: 2.08,
  moon: 0.76,
};

function fallbackDirection(nodeId) {
  const hashA = hashNumber(nodeId, 71);
  const hashB = hashNumber(nodeId, 73);
  const theta = ((hashA % 1000) / 1000) * Math.PI * 2;
  const phi = ((hashB % 1000) / 1000) * Math.PI;
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  ).normalize();
}

function computeNodePlacement(node, network) {
  const bodyId = network === "moon" ? "moon" : "earth";
  const worldCenter = BODY_WORLD_CENTER[bodyId];
  const worldRadiusKm = BODY_WORLD_RADIUS_KM[bodyId];
  const sceneSurfaceRadius = BODY_SCENE_SURFACE_RADIUS[bodyId];

  let resolvedX = node.actual_position_x_km;
  let resolvedY = node.actual_position_y_km;
  let resolvedZ = node.actual_position_z_km;
  
  if (resolvedX === undefined || resolvedX === null) {
    const fallback = resolveNodePosition(node, 0);
    resolvedX = fallback?.x ?? 0;
    resolvedY = fallback?.y ?? 0;
    resolvedZ = fallback?.z ?? 0;
  }

  const local = new THREE.Vector3(
    Number(resolvedX) - worldCenter.x,
    Number(resolvedY) - worldCenter.y,
    Number(resolvedZ) - worldCenter.z
  );

  const localMagnitude = local.length();
  const normal = localMagnitude > 1e-8
    ? local.clone().multiplyScalar(1 / localMagnitude)
    : fallbackDirection(node.node_id || bodyId);
  const rawRadiusKm = Number.isFinite(localMagnitude) && localMagnitude > 1e-8
    ? Math.max(worldRadiusKm, localMagnitude)
    : worldRadiusKm;
  const altitudeKm = node.altitude_km !== undefined && node.altitude_km !== null
    ? Number(node.altitude_km)
    : Math.max(0, rawRadiusKm - worldRadiusKm);
  const kmToScene = sceneSurfaceRadius / worldRadiusKm;
  const altitudeScale = bodyId === "moon" ? 1.9 : 1.6;
  const radiusScene = THREE.MathUtils.clamp(
    sceneSurfaceRadius + altitudeKm * kmToScene * altitudeScale,
    sceneSurfaceRadius + 0.06,
    sceneSurfaceRadius * 6.8
  );

  return {
    bodyId,
    normal,
    radiusScene,
    positionScene: normal.clone().multiplyScalar(radiusScene),
  };
}

function resolveOrbitLabel(node) {
  return node.location_label || node.orbit || "Orbit Unknown";
}

function isBaseNode(node) {
  const nodeType = String(node?.node_type ?? "").toLowerCase();
  if (nodeType === "ground_station") {
    return true;
  }

  const text = [node?.orbit, node?.location_label].filter(Boolean).join(" ").toLowerCase();
  return /surface|base|station|gateway/.test(text);
}

function buildRouteNodeIds(packet) {
  const hops = Array.isArray(packet?.route_hops) ? [...packet.route_hops] : [];
  const routeIds = [packet?.source_node, ...hops].filter(Boolean);

  if (routeIds.length === 1 && packet?.next_hop) {
    routeIds.push(packet.next_hop);
  }

  if (packet?.destination_node && routeIds.at(-1) !== packet.destination_node) {
    routeIds.push(packet.destination_node);
  }

  return routeIds.filter((nodeId, index, all) => index === 0 || nodeId !== all[index - 1]);
}

function createLiveSatelliteConfig(node, index, activeLoad) {
  const network = classifyNetwork(node);
  const placement = computeNodePlacement(node, network);

  const paletteByType = {
    ground_station: ["#68c8ff", "#b5f2ff"],
    relay: ["#ffd084", "#ffeec2"],
    satellite: ["#e8f2ff", "#7fd8ff"],
  };

  const [bodyColor, panelColor] =
    paletteByType[node.node_type] || paletteByType.satellite;

  const linkInfo = Array.isArray(node.links) && node.links.length > 0
    ? `Polaczenia: ${node.links.join(", ")}`
    : "Brak aktywnych linkow.";

  return {
    id: node.node_id,
    name: node.node_id,
    family: `Node: ${node.node_type || "satellite"}`,
    orbit: resolveOrbitLabel(node),
    description: linkInfo,
    status: activeLoad > 0 ? `aktywny ruch: ${activeLoad} pkt` : "idle",
    bodyId: placement.bodyId,
    network,
    bodyColor,
    panelColor,
    staticPlacement: {
      position: placement.positionScene,
      lookAt: new THREE.Vector3(0, 0, 0),
    },
  };
}

function createLiveBaseConfig(node, activeLoad) {
  const network = classifyNetwork(node);
  const placement = computeNodePlacement(node, network);
  const normal = [placement.normal.x, placement.normal.y, placement.normal.z];

  const linkInfo = Array.isArray(node.links) && node.links.length > 0
    ? `Polaczenia: ${node.links.join(", ")}`
    : "Brak aktywnych linkow.";

  const isMoon = network === "moon";

  return {
    id: node.node_id,
    name: node.node_id,
    family: `Baza: ${node.node_type || "ground_station"}`,
    orbit: resolveOrbitLabel(node),
    description: linkInfo,
    status: activeLoad > 0 ? `aktywny ruch: ${activeLoad} pkt` : "idle",
    bodyId: placement.bodyId,
    network,
    radius: isMoon ? 0.76 : 2.08,
    normal,
    color: isMoon ? "#ffe38d" : "#4dc0ff",
    glowColor: isMoon ? "#fff2b8" : "#8ef0ff",
  };
}

function removeFromList(list, predicate) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (predicate(list[i])) {
      list.splice(i, 1);
    }
  }
}

function removeLiveNode(nodeId) {
  const visual = liveNodeVisuals.get(nodeId);
  if (!visual) {
    return;
  }

  visual.orbitLine?.removeFromParent();
  visual.mesh?.removeFromParent();

  removeFromList(selectableSatellites, (entry) => entry === visual.selectableEntry);
  removeFromList(orbitingBodies, (entry) => entry === visual.orbitEntry);
  removeFromList(earthRelayIds, (id) => id === nodeId);
  removeFromList(moonRelayIds, (id) => id === nodeId);

  nodeLookup.delete(nodeId);
  liveNodeVisuals.delete(nodeId);
}

function syncLiveNodes() {
  const snapshot = getTelemetrySnapshot();
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  const packets = Array.isArray(snapshot?.packets) ? snapshot.packets : [];

  const orderedNodes = nodes
    .filter((node) => typeof node?.node_id === "string" && node.node_id.length > 0)
    .sort((a, b) => a.node_id.localeCompare(b.node_id));

  const signature = orderedNodes
    .map((node) => [
      node.node_id,
      node.node_type,
      node.orbit,
      node.location_label,
      node.body,
      node.orbiting_body,
      node.position_x_km,
      node.position_y_km,
      node.position_z_km,
      node.surface_lat_deg,
      node.surface_lon_deg,
      node.orbit_altitude_km,
      node.orbital_phase_deg,
      node.orbital_inclination_deg,
    ].join("|"))
    .join(";");

  const activeLoadByNode = new Map();
  packets.forEach((packet) => {
    const status = String(packet?.current_status ?? "").toUpperCase();
    if (!ACTIVE_ROUTE_STATUSES.has(status)) {
      return;
    }
    const routeIds = buildRouteNodeIds(packet);
    routeIds.forEach((nodeId) => {
      activeLoadByNode.set(nodeId, (activeLoadByNode.get(nodeId) ?? 0) + 1);
    });
  });

  if (signature !== liveNodeSignature) {
    [...liveNodeVisuals.keys()].forEach((nodeId) => {
      removeLiveNode(nodeId);
    });

    orderedNodes.forEach((node, index) => {
      const activeLoad = activeLoadByNode.get(node.node_id) ?? 0;

      if (isBaseNode(node)) {
        const baseConfig = createLiveBaseConfig(node, activeLoad);
        const parent = baseConfig.network === "moon" ? moonSurfaceGroup : earthSurfaceGroup;
        const baseEntry = createBase(parent, baseConfig);

        liveNodeVisuals.set(node.node_id, {
          ...baseEntry,
          kind: "base",
          node,
        });
        return;
      }

      const liveConfig = createLiveSatelliteConfig(node, index, activeLoad);
      const parent = liveConfig.network === "moon" ? moonGroup : earthGroup;
      const satelliteEntry = createSatellite(parent, liveConfig);

      liveNodeVisuals.set(node.node_id, {
        ...satelliteEntry,
        orbitLine: null,
        kind: "satellite",
        node,
      });
    });

    liveNodeSignature = signature;
  }

  orderedNodes.forEach((node, index) => {
    const visual = liveNodeVisuals.get(node.node_id);
    if (!visual) {
      return;
    }

    visual.node = node;
    const activeLoad = activeLoadByNode.get(node.node_id) ?? 0;
    const nextData = isBaseNode(node)
      ? createLiveBaseConfig(node, activeLoad)
      : createLiveSatelliteConfig(node, index, activeLoad);

    const lookupNode = nodeLookup.get(node.node_id);
    if (lookupNode) {
      lookupNode.name = nextData.name;
      lookupNode.family = nextData.family;
      lookupNode.orbit = nextData.orbit;
      lookupNode.description = nextData.description;
      lookupNode.status = nextData.status;
    }

    if (visual.data) {
      visual.data.name = nextData.name;
      visual.data.family = nextData.family;
      visual.data.orbit = nextData.orbit;
      visual.data.description = nextData.description;
      visual.data.status = nextData.status;
      if (visual.hitTarget) {
        visual.hitTarget.userData.satellite = visual.data;
      }
    }

    if (visual.kind === "base" && visual.mesh && Array.isArray(nextData.normal)) {
      const normal = new THREE.Vector3(...nextData.normal).normalize();
      visual.mesh.position.copy(normal.clone().multiplyScalar(nextData.radius));
      visual.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    }

    if (visual.kind === "satellite" && visual.mesh && nextData.staticPlacement?.position) {
      visual.targetPosition = nextData.staticPlacement.position.clone();
      if (visual.mesh.position.lengthSq() < 0.1) {
          visual.mesh.position.copy(visual.targetPosition);
      }
      if (nextData.staticPlacement.lookAt) {
        visual.mesh.lookAt(nextData.staticPlacement.lookAt);
      }
    }
  });
}

function closestPointOnSegment(point, a, b) {
  const ab = b.clone().sub(a);
  const lengthSq = ab.lengthSq();
  if (lengthSq < 1e-8) {
    return {
      point: a.clone(),
      t: 0,
    };
  }
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / lengthSq, 0, 1);
  return {
    point: a.clone().add(ab.multiplyScalar(t)),
    t,
  };
}

function hasLineOfSight(fromNode, toNode) {
  const from = fromNode.getWorldPosition();
  const to = toNode.getWorldPosition();
  bodies.forEach((body) => {
    body.center = body.getCenter();
  });

  return !bodies.some((body) => {
    const closest = closestPointOnSegment(body.center, from, to);
    const touchingFromBody = fromNode.bodyId === body.id && closest.t < 0.03;
    const touchingToBody = toNode.bodyId === body.id && closest.t > 0.97;
    if (touchingFromBody || touchingToBody) {
      return false;
    }
    return closest.point.distanceTo(body.center) < body.radius + 0.02;
  });
}

function findBlockingBody(fromNode, toNode) {
  const from = fromNode.getWorldPosition();
  const to = toNode.getWorldPosition();
  bodies.forEach((body) => {
    body.center = body.getCenter();
  });

  let selected = null;
  let minDistance = Number.POSITIVE_INFINITY;

  bodies.forEach((body) => {
    const closest = closestPointOnSegment(body.center, from, to);
    const touchingFromBody = fromNode.bodyId === body.id && closest.t < 0.03;
    const touchingToBody = toNode.bodyId === body.id && closest.t > 0.97;
    if (touchingFromBody || touchingToBody) {
      return;
    }

    const distance = closest.point.distanceTo(body.center);
    if (distance < body.radius + 0.02 && distance < minDistance) {
      minDistance = distance;
      selected = body;
    }
  });

  return selected;
}

function buildRelayPathPoints(fromNode, toNode) {
  const from = fromNode.getWorldPosition();
  const to = toNode.getWorldPosition();

  if (hasLineOfSight(fromNode, toNode)) {
    return [from, to];
  }

  const blockingBody = findBlockingBody(fromNode, toNode);
  if (!blockingBody) {
    return [from, to];
  }

  const center = blockingBody.center;
  const fromDir = from.clone().sub(center).normalize();
  const toDir = to.clone().sub(center).normalize();

  let aroundAxis = fromDir.clone().cross(toDir);
  if (aroundAxis.lengthSq() < 1e-8) {
    aroundAxis = fromDir.clone().cross(new THREE.Vector3(0, 1, 0));
  }
  if (aroundAxis.lengthSq() < 1e-8) {
    aroundAxis = fromDir.clone().cross(new THREE.Vector3(0, 0, 1));
  }
  aroundAxis.normalize();

  const detourRadius = blockingBody.radius + 0.95;
  const control1 = center
    .clone()
    .add(fromDir.clone().multiplyScalar(detourRadius))
    .add(aroundAxis.clone().multiplyScalar(detourRadius * 0.42));
  const control2 = center
    .clone()
    .add(toDir.clone().multiplyScalar(detourRadius))
    .add(aroundAxis.clone().multiplyScalar(detourRadius * 0.42));

  const curve = new THREE.CubicBezierCurve3(from, control1, control2, to);
  return curve.getPoints(28);
}

function samplePolylinePoint(points, t) {
  if (!points || points.length === 0) {
    return new THREE.Vector3();
  }
  if (points.length === 1) {
    return points[0].clone();
  }

  const segmentCount = points.length - 1;
  const scaled = THREE.MathUtils.clamp(t, 0, 1) * segmentCount;
  const index = Math.min(Math.floor(scaled), segmentCount - 1);
  const localT = scaled - index;
  return points[index].clone().lerp(points[index + 1], localT);
}

function createDynamicRoute() {
  syncLiveNodes();

  const snapshot = getTelemetrySnapshot();
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  const nodeDocById = new Map(nodes.map((node) => [node.node_id, node]));

  const livePacket = getLivePacket();

  if (livePacket) {
    const routeIds = buildRouteNodeIds(livePacket);
    const routeNodes = routeIds
      .map((nodeId) => nodeLookup.get(nodeId))
      .filter(Boolean);

    const routeLocations =
      livePacket.route_locations && typeof livePacket.route_locations === "object"
        ? livePacket.route_locations
        : {};

    const routeNames = routeIds.map((nodeId) => {
      const locationLabel = routeLocations[nodeId] || resolveOrbitLabel(nodeDocById.get(nodeId) ?? {});
      return locationLabel ? `${nodeId} (${locationLabel})` : nodeId;
    });

    const payloadText = getPacketText(livePacket);
    const missingNodes = routeIds.length - routeNodes.length;
    const suffix = missingNodes > 0 ? ` | brak wizualizacji dla ${missingNodes} node` : "";

    const isActive = livePacket.current_status === "IN_TRANSIT";
    const activeHopNodes = isActive ? [livePacket.current_node_id, livePacket.next_hop] : [];

    return {
      nodes: routeNodes,
      names: routeNames,
      payload: payloadText ?? "{payload:empty}",
      topic: `api/packets/${livePacket.packet_id}`,
      qos: livePacket.priority === 1 ? 2 : 1,
      status: `status: ${livePacket.current_status ?? "UNKNOWN"}${suffix}`,
      activeHopNodes: activeHopNodes.filter(Boolean)
    };
  }

  return null;
}

const legacyBaseEntries = [];
legacyBaseEntries.push(createBase(earthSurfaceGroup, {
  id: "earth-main-base",
  name: "Earth Main Transmitter",
  family: "Baza naziemna",
  orbit: "Powierzchnia Ziemi",
  description: "Glowny nadajnik kierujacy ruch miedzy Ziemia a Ksiezycem.",
  status: "uplink gotowy",
  bodyId: "earth",
  radius: 2.08,
  normal: [0.35, 0.42, 0.84],
  color: "#4dc0ff",
  glowColor: "#8ef0ff",
}));

legacyBaseEntries.push(createBase(moonSurfaceGroup, {
  id: "moon-main-base",
  name: "Moon Main Transmitter",
  family: "Baza ksiezycowa",
  orbit: "Powierzchnia Ksiezyca",
  description: "Glowny odbiornik i nadajnik dla lacza Ziemia-Ksiezyc.",
  status: "downlink aktywny",
  bodyId: "moon",
  radius: 0.76,
  normal: [-0.62, 0.28, 0.73],
  color: "#ffe38d",
  glowColor: "#fff2b8",
}));

const earthSatellites = [
  {
    id: "aurora-watch",
    name: "Aurora Watch",
    family: "Satelita Ziemski",
    orbit: "Niska orbita polarno-obserwacyjna",
    description: "Platforma do obserwacji zorzy, chmur i nocnych swiatel duzych aglomeracji.",
    status: "sledzenie zorzy nad polkula polnocna",
    radius: 3.1,
    eccentricity: 0.86,
    direction: 1,
    angle: 0.2,
    tiltX: 0.55,
    tiltZ: 0.1,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#f6f3ea",
    panelColor: "#59b6ff",
  },
  {
    id: "geo-relay",
    name: "Geo Relay",
    family: "Satelita Ziemski",
    orbit: "Orbita komunikacyjna o wysokiej inklinacji",
    description: "Wezel przekaznikowy do komunikacji szerokopasmowej i transmisji danych pogodowych.",
    status: "utrzymuje lacza nad Atlantykiem",
    radius: 4.2,
    eccentricity: 0.8,
    direction: -1,
    angle: 2.2,
    tiltX: -0.4,
    tiltZ: 0.7,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#f3c969",
    panelColor: "#5ee8ff",
  },
  {
    id: "climate-scan",
    name: "Climate Scan",
    family: "Satelita Ziemski",
    orbit: "Orbita heliosynchroniczna",
    description: "Zbiera dane klimatyczne, analizuje pokrywe chmur i temperatury oceanow.",
    status: "mapuje strefy rownikowe",
    radius: 5.3,
    eccentricity: 0.9,
    direction: 1,
    angle: 4.15,
    tiltX: 0.2,
    tiltZ: -0.6,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#f0f4fa",
    panelColor: "#6ac8ff",
  },
  {
    id: "equator-link",
    name: "Equator Link",
    family: "Satelita Ziemski",
    orbit: "Orbita srednia rownikowa",
    description: "Wspiera lacza relay dla transmisji miedzykontynentalnych.",
    status: "przejmuje ruch relay",
    radius: 6.1,
    eccentricity: 0.87,
    direction: 1,
    angle: 1.3,
    tiltX: 0.08,
    tiltZ: 0.32,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#d7f0ff",
    panelColor: "#70d6ff",
  },
  {
    id: "polar-bridge",
    name: "Polar Bridge",
    family: "Satelita Ziemski",
    orbit: "Orbita wysoka polarna",
    description: "Zapewnia relay dla lacz wysokiej szerokosci geograficznej.",
    status: "widocznosc do bazy chwilowo dobra",
    radius: 4.7,
    eccentricity: 0.82,
    direction: -1,
    angle: 5.0,
    tiltX: 0.92,
    tiltZ: -0.22,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#ffe0a3",
    panelColor: "#8cc8ff",
  },
  {
    id: "ocean-mesh",
    name: "Ocean Mesh",
    family: "Satelita Ziemski",
    orbit: "Orbita relay oceaniczna",
    description: "Przejmuje pakiety mostkujace dla tras Ziemia-Ksiezyc.",
    status: "przelacza role posrednika",
    radius: 3.45,
    eccentricity: 0.91,
    direction: 1,
    angle: 3.35,
    tiltX: -0.22,
    tiltZ: 0.88,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#f4f6ff",
    panelColor: "#56c7ff",
  },
  {
    id: "storm-guard",
    name: "Storm Guard",
    family: "Satelita Ziemski",
    orbit: "Orbita meteorologiczna srednia",
    description: "Monitoruje fronty burzowe i moze przejmowac role relay dla kanalu pogodowego.",
    status: "przechwytuje dane burzowe",
    radius: 3.8,
    eccentricity: 0.84,
    direction: -1,
    angle: 0.95,
    tiltX: 0.44,
    tiltZ: -0.72,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#e9eef8",
    panelColor: "#66e0ff",
  },
  {
    id: "sunrise-net",
    name: "Sunrise Net",
    family: "Satelita Ziemski",
    orbit: "Orbita relay niska",
    description: "Szybki wezel relay dla porannej strony planety i ruchu uplink.",
    status: "niskie opoznienie uplink",
    radius: 2.85,
    eccentricity: 0.89,
    direction: 1,
    angle: 2.55,
    tiltX: -0.18,
    tiltZ: 0.54,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#fdf2c8",
    panelColor: "#63c6ff",
  },
  {
    id: "night-grid",
    name: "Night Grid",
    family: "Satelita Ziemski",
    orbit: "Orbita nocna wysoka",
    description: "Wspiera routing nad ciemna strona Ziemi i obserwacje nocnych swiatel.",
    status: "kanal nocny aktywny",
    radius: 5.8,
    eccentricity: 0.83,
    direction: -1,
    angle: 5.45,
    tiltX: 0.36,
    tiltZ: 0.18,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#dfe8ff",
    panelColor: "#88bfff",
  },
  {
    id: "atlas-node",
    name: "Atlas Node",
    family: "Satelita Ziemski",
    orbit: "Orbita relay geodezyjna",
    description: "Stabilny punkt relay dla dlugich przeskokow do segmentu ksiezycowego.",
    status: "utrzymuje punkt referencyjny",
    radius: 4.95,
    eccentricity: 0.88,
    direction: 1,
    angle: 1.78,
    tiltX: 0.68,
    tiltZ: 0.46,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#f6dcc2",
    panelColor: "#76ddff",
  },
  {
    id: "terminator-hop",
    name: "Terminator Hop",
    family: "Satelita Ziemski",
    orbit: "Orbita granicy dnia i nocy",
    description: "Przelacza ruch relay w strefie terminatora i pomaga szukac krotszych tras.",
    status: "dynamiczny hop relay",
    radius: 4.35,
    eccentricity: 0.93,
    direction: -1,
    angle: 3.92,
    tiltX: -0.62,
    tiltZ: 0.74,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#fff0db",
    panelColor: "#5cd4ff",
  },
  {
    id: "meridian-link",
    name: "Meridian Link",
    family: "Satelita Ziemski",
    orbit: "Orbita relay meridianowa",
    description: "Laczy poludnikowe trasy przesylu danych i odciaza glowny most relay.",
    status: "widocznosc dla poludnikow dobra",
    radius: 6.45,
    eccentricity: 0.85,
    direction: 1,
    angle: 4.82,
    tiltX: 0.14,
    tiltZ: -0.48,
    bodyId: "earth",
    network: "earth",
    bodyColor: "#e8f3ff",
    panelColor: "#72cfff",
  },
];

const legacySatelliteEntries = [];

earthSatellites.forEach((config, index) => {
  const orbitLine = createOrbitLine(
    config.radius,
    ["#5fd1ff", "#7f9dff", "#9de6ff", "#76d7ff", "#a4c6ff", "#83f0ff"][index % 6],
    0.16 + index * 0.02,
    earthGroup,
    config.eccentricity
  );
  const satelliteEntry = createSatellite(earthGroup, config);
  legacySatelliteEntries.push({ ...satelliteEntry, orbitLine });
});

const moonSatellites = [
  {
    id: "luna-mapper",
    name: "Luna Mapper",
    family: "Satelita Ksiezycowy",
    orbit: "Niska orbita kartograficzna",
    description: "Skanuje kratery i uskoki w rejonie poludniowego bieguna Ksiezyca.",
    status: "tworzy mape topografii",
    radius: 1.6,
    eccentricity: 0.88,
    direction: 1,
    angle: 0.6,
    tiltX: 0.8,
    tiltZ: 0.25,
    bodyId: "moon",
    network: "moon",
    bodyColor: "#fff1c4",
    panelColor: "#8ff0ff",
  },
  {
    id: "regolith-lab",
    name: "Regolith Lab",
    family: "Satelita Ksiezycowy",
    orbit: "Orbita naukowa sredniej wysokosci",
    description: "Bada sklad regolitu i dobiera miejsca pod przyszle ladowania zalogowe.",
    status: "analizuje pasmo terminatora",
    radius: 2.35,
    eccentricity: 0.76,
    direction: -1,
    angle: 2.7,
    tiltX: -0.55,
    tiltZ: -0.3,
    bodyId: "moon",
    network: "moon",
    bodyColor: "#dfe5ef",
    panelColor: "#62c8ff",
  },
  {
    id: "far-side-link",
    name: "Far Side Link",
    family: "Satelita Ksiezycowy",
    orbit: "Orbita eliptyczna dla lacznosci",
    description: "Zapewnia stale polaczenie z infrastruktura po niewidocznej stronie Ksiezyca.",
    status: "utrzymuje rele komunikacyjna",
    radius: 3.0,
    eccentricity: 0.93,
    direction: 1,
    angle: 4.2,
    tiltX: 0.3,
    tiltZ: 0.55,
    bodyId: "moon",
    network: "moon",
    bodyColor: "#ffd39a",
    panelColor: "#77f3ff",
  },
  {
    id: "polar-beacon",
    name: "Polar Beacon",
    family: "Satelita Ksiezycowy",
    orbit: "Orbita polarna relay",
    description: "Wzmacnia lacznosc nad rejonami polarnymi Ksiezyca i pomaga domknac sciezki do bazy.",
    status: "utrzymuje relay nad biegunem",
    radius: 2.65,
    eccentricity: 0.84,
    direction: -1,
    angle: 5.35,
    tiltX: -0.92,
    tiltZ: 0.18,
    bodyId: "moon",
    network: "moon",
    bodyColor: "#f5e7ff",
    panelColor: "#7fdcff",
  },
];

moonSatellites.forEach((config, index) => {
  const orbitLine = createOrbitLine(
    config.radius,
    ["#f7f1c8", "#89f0ff", "#8eb8ff"][index % 3],
    0.18 + index * 0.03,
    moonGroup,
    config.eccentricity
  );
  const satelliteEntry = createSatellite(moonGroup, config);
  legacySatelliteEntries.push({ ...satelliteEntry, orbitLine });
});

legacyBaseEntries.forEach((entry) => {
  if (entry?.mesh) {
    entry.mesh.visible = false;
  }
});

legacySatelliteEntries.forEach((entry) => {
  if (entry?.mesh) {
    entry.mesh.visible = false;
  }
  if (entry?.hitTarget) {
    entry.hitTarget.visible = false;
  }
  if (entry?.orbitLine) {
    entry.orbitLine.visible = false;
  }
});

syncLiveNodes();

["#59d8ff", "#7eb6ff", "#ff8eb8", "#ffe28b", "#8ef3ff"].forEach((color) => createRelayBeam(color));
const starsGeometry = new THREE.BufferGeometry();
const starCount = 6500;
const starVertices = new Float32Array(starCount * 3);
const starColors = new Float32Array(starCount * 3);

for (let i = 0; i < starCount; i += 1) {
  const radius = 55 + Math.random() * 120;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const color = new THREE.Color().setHSL(
    THREE.MathUtils.lerp(0.52, 0.14, Math.random()),
    THREE.MathUtils.lerp(0.25, 0.7, Math.random()),
    THREE.MathUtils.lerp(0.72, 1, Math.random())
  );

  starVertices[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
  starVertices[i * 3 + 1] = radius * Math.cos(phi);
  starVertices[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  starColors[i * 3] = color.r;
  starColors[i * 3 + 1] = color.g;
  starColors[i * 3 + 2] = color.b;
}

starsGeometry.setAttribute("position", new THREE.BufferAttribute(starVertices, 3));
starsGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
const stars = new THREE.Points(
  starsGeometry,
  new THREE.PointsMaterial({
    size: 0.12,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    vertexColors: true,
  })
);
scene.add(stars);

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

const handlePointerDown = (event) => {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(
    selectableSatellites.map((item) => item.hitTarget),
    false
  );
  setSatelliteSelection(hits[0]?.object.userData.satellite ?? null);
};

const handleDoubleClick = (event) => {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([earth, moon], false);
  if (hits.length > 0) {
    const targetPos = new THREE.Vector3();
    hits[0].object.getWorldPosition(targetPos);
    controls.target.copy(targetPos);
  } else {
    controls.target.set(0, 1.1, 0); // reset to Earth
  }
};

renderer.domElement.addEventListener("pointerdown", handlePointerDown);
renderer.domElement.addEventListener("dblclick", handleDoubleClick);

updateSatellitePanel(null);
updateMqttPanel(null);

const earthCenter = new THREE.Vector3();
const fromPosition = new THREE.Vector3();
const toPosition = new THREE.Vector3();
const markerPosition = new THREE.Vector3();
let simulatedElapsed = 0;
let simulationSlow = false;

function animate() {
  timer.update();
  const delta = timer.getDelta();
  const rawElapsed = timer.getElapsed();
  
  simulatedElapsed += simulationSlow ? delta * 0.12 : delta;
  const elapsed = simulatedElapsed;

  earthSurfaceGroup.rotation.y = elapsed * 0.12;
  cloudLayer.rotation.y = elapsed * 0.04;
  atmosphere.rotation.y = -elapsed * 0.03;
  earthGlow.rotation.y = elapsed * 0.02;

  earth.getWorldPosition(earthCenter);
  const lightDirection = earthCenter.clone().sub(sunLight.position).normalize();
  const cameraDirection = camera.position.clone().sub(earthCenter).normalize();
  earthNightLayer.material.opacity = THREE.MathUtils.clamp(
    0.82 - Math.max(0, lightDirection.dot(cameraDirection)),
    0.18,
    0.82
  );

  moonPivot.rotation.y = 0;
  moonSurfaceGroup.rotation.y = elapsed * 0.12;

  liveNodeVisuals.forEach((visual) => {
    if (visual.kind === "satellite" && visual.targetPosition && visual.mesh) {
       visual.mesh.position.lerp(visual.targetPosition, 0.08);
    }
  });

  const route = createDynamicRoute();
  relayBeams.forEach((beam, index) => {
    beam.line.visible = false;
    beam.marker.visible = false;
    beam.currentNodes = null;
  });

  const routeNodes = route?.nodes ?? [];
  routeNodes.slice(0, -1).forEach((node, index) => {
    const nextNode = routeNodes[index + 1];
    if (!node || !nextNode || !relayBeams[index]) {
      return;
    }
    const beamPoints = buildRelayPathPoints(node, nextNode);
    fromPosition.copy(beamPoints[0]);
    toPosition.copy(beamPoints[beamPoints.length - 1]);
    if (!Number.isFinite(fromPosition.lengthSq()) || !Number.isFinite(toPosition.lengthSq())) {
      return;
    }
    const pulse = (rawElapsed * (0.7 + index * 0.18)) % 1;

    const isActiveHop =
      route.activeHopNodes &&
      route.activeHopNodes.includes(node.id) &&
      route.activeHopNodes.includes(nextNode.id);

    relayBeams[index].currentNodes = [node, nextNode];
    relayBeams[index].line.visible = true;
    relayBeams[index].marker.visible = isActiveHop;
    relayBeams[index].line.geometry.setFromPoints(beamPoints);
    if (isActiveHop) {
      markerPosition.copy(samplePolylinePoint(beamPoints, pulse));
      relayBeams[index].marker.position.copy(markerPosition);
    }
    const baseOpacity = 0.28 + 0.44 * Math.sin((elapsed + index) * 1.4) ** 2;
    relayBeams[index].line.material.opacity = isActiveHop ? baseOpacity + 0.5 : 0.08;
  });

  const routeKey = route ? route.names.join("|") : "idle";
  const payloadLine = route ? `Payload: ${route.payload}` : "Payload: brak aktywnych pakietow";
  if (mqttStatus.dataset.routeKey !== routeKey || mqttPayload.textContent !== payloadLine) {
    mqttStatus.dataset.routeKey = routeKey;
    updateMqttPanel(route);
  }

  stars.rotation.y = elapsed * 0.004;
  sunHalo.scale.setScalar(1 + Math.sin(elapsed * 0.4) * 0.04);
  controls.update();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

const handleNetworkResize = () => {
  const viewport = getViewportSize();
  camera.aspect = viewport.width / viewport.height;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.width, viewport.height);
};

window.addEventListener("resize", handleNetworkResize);
document.addEventListener("fullscreenchange", handleNetworkResize);

function setupPlannerView() {
  const plannerRenderer = new THREE.WebGLRenderer({ antialias: true });
  plannerRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const initialPlannerViewport = getViewportSize();
  plannerRenderer.setSize(initialPlannerViewport.width, initialPlannerViewport.height);
  plannerRenderer.outputColorSpace = THREE.SRGBColorSpace;
  plannerHost.appendChild(plannerRenderer.domElement);

  const plannerScene = new THREE.Scene();
  plannerScene.background = new THREE.Color("#01030a");
  plannerScene.fog = new THREE.FogExp2("#01030a", 0.0012);

  const plannerCamera = new THREE.PerspectiveCamera(
    46,
    initialPlannerViewport.width / initialPlannerViewport.height,
    0.1,
    4000
  );
  plannerCamera.position.set(-90, 90, 240);

  const plannerControls = new OrbitControls(plannerCamera, plannerRenderer.domElement);
  plannerControls.enableDamping = true;
  plannerControls.minDistance = 24;
  plannerControls.maxDistance = 600;
  plannerControls.target.set(0, 0, 0);

  plannerScene.add(new THREE.AmbientLight("#89a2d8", 0.26));
  plannerScene.add(new THREE.HemisphereLight("#98b8ff", "#040711", 0.2));
  const plannerSunLight = new THREE.DirectionalLight("#ffe2a3", 3.4);
  plannerSunLight.position.set(-180, 80, 120);
  plannerSunLight.castShadow = false;
  plannerScene.add(plannerSunLight);
  const sunMarker = new THREE.Group();
  sunMarker.position.copy(plannerSunLight.position.clone().setLength(260));
  sunMarker.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(9, 32, 32),
      new THREE.MeshBasicMaterial({ color: "#ffcf72" })
    )
  );
  sunMarker.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(14, 24, 24),
      new THREE.MeshBasicMaterial({
        color: "#ffd884",
        transparent: true,
        opacity: 0.18,
        side: THREE.BackSide,
      })
    )
  );
  plannerScene.add(sunMarker);

  const starsGeometry = new THREE.BufferGeometry();
  const starVertices = new Float32Array(3600 * 3);
  for (let i = 0; i < 3600; i += 1) {
    const radius = 800 + Math.random() * 2600;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starVertices[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    starVertices[i * 3 + 1] = radius * Math.cos(phi);
    starVertices[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  starsGeometry.setAttribute("position", new THREE.BufferAttribute(starVertices, 3));
  plannerScene.add(
    new THREE.Points(
      starsGeometry,
      new THREE.PointsMaterial({ color: "#d8e2ff", size: 1.6, transparent: true, opacity: 0.88 })
    )
  );

  const plannerUi = {
    leoAltitude: root.querySelector('[data-planner-input="leo-altitude"]'),
    flightDays: root.querySelector('[data-planner-input="flight-days"]'),
    perilune: root.querySelector('[data-planner-input="perilune"]'),
    leoAltitudeValue: root.querySelector('[data-planner-value="leo-altitude"]'),
    flightDaysValue: root.querySelector('[data-planner-value="flight-days"]'),
    periluneValue: root.querySelector('[data-planner-value="perilune"]'),
    run: root.querySelector("[data-planner-run]"),
    deltaV: root.querySelector('[data-result="delta-v"]'),
    vinf: root.querySelector('[data-result="vinf"]'),
    closest: root.querySelector('[data-result="closest"]'),
    tof: root.querySelector('[data-result="tof"]'),
    summary: root.querySelector('[data-result="summary"]'),
    status: root.querySelector('[data-result="status"]'),
  };

  const constants = {
    astronomicalUnit: 149597870.7,
    muEarth: 398600.4418,
    muMoon: 4902.800066,
    earthRadius: 6378.136,
    moonRadius: 1737.4,
    moonOrbitRadius: 384400,
    moonPeriod: 27.321661 * 86400,
  };

  const planetConfigs = [
    { id: "mercury", name: "Mercury", relativeAu: 0.613, periodDays: 116.0, size: 2.8, color: "#c4b39a" },
    { id: "venus", name: "Venus", relativeAu: 0.277, periodDays: 584.0, size: 4.2, color: "#d8b07a" },
    { id: "mars", name: "Mars", relativeAu: 0.524, periodDays: 780.0, size: 3.6, color: "#c5654b" },
    { id: "jupiter", name: "Jupiter", relativeAu: 4.203, periodDays: 399.0, size: 8.8, color: "#d7b18e" },
    { id: "saturn", name: "Saturn", relativeAu: 8.537, periodDays: 378.0, size: 8.2, color: "#e2cd96", ring: true },
  ];

  function solarOrbitRadius(relativeAu) {
    return 85 + Math.sqrt(Math.max(relativeAu, 0.2)) * 95;
  }

  function orbitPoints(radius, segments = 260) {
    return new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2, false, 0)
      .getPoints(segments)
      .map((point) => new THREE.Vector3(point.x, 0, point.y));
  }

  const orbitMaterial = new THREE.LineBasicMaterial({
    color: "#8b8bba",
    transparent: true,
    opacity: 0.28,
  });

  const planets = new Map();
  planetConfigs.forEach((config, index) => {
    const orbitLine = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(orbitPoints(solarOrbitRadius(config.relativeAu))),
      orbitMaterial.clone()
    );
    plannerScene.add(orbitLine);

    const mesh =
      config.id === "earth"
        ? new THREE.Group()
        : new THREE.Mesh(
            new THREE.SphereGeometry(config.size, 40, 40),
            new THREE.MeshPhongMaterial({
              color: config.color,
              emissive: new THREE.Color(config.color).multiplyScalar(0.12),
              shininess: 10,
            })
          );

    if (config.id !== "earth") {
      plannerScene.add(mesh);
      if (config.ring) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(config.size * 1.35, config.size * 2.05, 64),
          new THREE.MeshBasicMaterial({
            color: "#cdb98a",
            transparent: true,
            opacity: 0.42,
            side: THREE.DoubleSide,
          })
        );
        ring.rotation.x = Math.PI / 2.4;
        mesh.add(ring);
      }
    }

    planets.set(config.id, {
      ...config,
      mesh,
      orbitAngleOffset: index * 0.7,
      orbitRadius: solarOrbitRadius(config.relativeAu),
    });
  });
  const earthSystem = new THREE.Group();
  plannerScene.add(earthSystem);

  const plannerEarth = new THREE.Mesh(
    new THREE.SphereGeometry(7.2, 64, 64),
    new THREE.MeshPhongMaterial({
      map: earthDayTexture,
      normalMap: earthNormalTexture,
      specularMap: earthSpecularTexture,
      shininess: 20,
      specular: new THREE.Color("#2c4774"),
      emissive: "#0a1021",
      emissiveIntensity: 0.08,
    })
  );
  earthSystem.add(plannerEarth);

  earthSystem.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(7.55, 40, 40),
      new THREE.MeshPhongMaterial({
        map: earthCloudTexture,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      })
    )
  );

  earthSystem.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(8.2, 32, 32),
      new THREE.MeshBasicMaterial({
        color: "#57b8ff",
        transparent: true,
        opacity: 0.08,
        side: THREE.BackSide,
      })
    )
  );

  const cislunarGroup = new THREE.Group();
  cislunarGroup.rotation.z = THREE.MathUtils.degToRad(9);
  earthSystem.add(cislunarGroup);

  const KM_TO_SCENE = 1 / 10000;

  const moonOrbitVisual = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(orbitPoints(constants.moonOrbitRadius * KM_TO_SCENE, 320)),
    new THREE.LineBasicMaterial({ color: "#7d87ce", transparent: true, opacity: 0.48 })
  );
  cislunarGroup.add(moonOrbitVisual);

  const plannerMoon = new THREE.Mesh(
    new THREE.SphereGeometry(2.7, 48, 48),
    new THREE.MeshStandardMaterial({
      map: moonTexture,
      bumpMap: moonTexture,
      bumpScale: 0.05,
      roughness: 1,
      metalness: 0,
      emissive: "#0f1320",
      emissiveIntensity: 0.05,
    })
  );
  cislunarGroup.add(plannerMoon);

  const parkingLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([]),
    new THREE.LineBasicMaterial({ color: "#64d4ff", transparent: true, opacity: 0.6 })
  );
  cislunarGroup.add(parkingLine);

  const trajectoryLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: "#9cfaa3", transparent: true, opacity: 1 })
  );
  cislunarGroup.add(trajectoryLine);

  const transferGlow = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: "#d7ffd6", transparent: true, opacity: 0.28 })
  );
  transferGlow.scale.setScalar(1.002);
  cislunarGroup.add(transferGlow);

  const burnVector = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 12, 0xffd98a, 4, 2);
  cislunarGroup.add(burnVector);

  const thrustVector = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 10, 0xffb347, 3, 1.5);
  cislunarGroup.add(thrustVector);

  const thrustVectorSecondary = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(),
    6,
    0x7ee7ff,
    2.2,
    1
  );
  cislunarGroup.add(thrustVectorSecondary);

  const spacecraft = new THREE.Group();
  const rocketBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 3.8, 20),
    new THREE.MeshStandardMaterial({
      color: "#f2f6ff",
      metalness: 0.22,
      roughness: 0.48,
      emissive: "#0d1321",
      emissiveIntensity: 0.05,
    })
  );
  rocketBody.rotation.z = Math.PI / 2;
  spacecraft.add(rocketBody);

  const rocketNose = new THREE.Mesh(
    new THREE.ConeGeometry(0.38, 1.1, 20),
    new THREE.MeshStandardMaterial({ color: "#ff8d72", metalness: 0.18, roughness: 0.5 })
  );
  rocketNose.position.x = 2.35;
  rocketNose.rotation.z = -Math.PI / 2;
  spacecraft.add(rocketNose);

  const rocketEngine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.18, 0.65, 16),
    new THREE.MeshStandardMaterial({ color: "#697a96", metalness: 0.45, roughness: 0.42 })
  );
  rocketEngine.position.x = -2.15;
  rocketEngine.rotation.z = Math.PI / 2;
  spacecraft.add(rocketEngine);

  const finGeometry = new THREE.BoxGeometry(0.18, 0.85, 0.48);
  for (const finOffset of [-0.42, 0.42]) {
    const fin = new THREE.Mesh(
      finGeometry,
      new THREE.MeshStandardMaterial({ color: "#7fc8ff", metalness: 0.12, roughness: 0.62 })
    );
    fin.position.set(-1.55, finOffset, 0);
    spacecraft.add(fin);
  }

  const plume = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 1.4, 18),
    new THREE.MeshBasicMaterial({
      color: "#8ee8ff",
      transparent: true,
      opacity: 0.55,
    })
  );
  plume.position.x = -2.85;
  plume.rotation.z = Math.PI / 2;
  spacecraft.add(plume);
  cislunarGroup.add(spacecraft);

  const spacecraftTrace = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: "#7ee7ff", transparent: true, opacity: 0.9 })
  );
  cislunarGroup.add(spacecraftTrace);

  const approachMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 16, 16),
    new THREE.MeshBasicMaterial({ color: "#ffe79a" })
  );
  cislunarGroup.add(approachMarker);

  const plannerState = {
    solution: null,
    active: false,
    elapsedRealSeconds: 0,
    lastAnimationTime: 0,
    tracePoints: [],
  };

  function moonPositionAt(time, phase) {
    const angle = phase + (time / constants.moonPeriod) * Math.PI * 2;
    return new THREE.Vector3(
      Math.cos(angle) * constants.moonOrbitRadius,
      Math.sin(angle) * constants.moonOrbitRadius,
      0
    );
  }

  function moonVelocityAt(time, phase) {
    const angle = phase + (time / constants.moonPeriod) * Math.PI * 2;
    const omega = (Math.PI * 2) / constants.moonPeriod;
    return new THREE.Vector3(
      -Math.sin(angle) * constants.moonOrbitRadius * omega,
      Math.cos(angle) * constants.moonOrbitRadius * omega,
      0
    );
  }

  function accelerationAt(position, moonPos) {
    const earthAcc = position.clone().multiplyScalar(-constants.muEarth / Math.max(position.length(), 1) ** 3);
    const moonAcc = position
      .clone()
      .sub(moonPos)
      .multiplyScalar(-constants.muMoon / Math.max(position.clone().sub(moonPos).length(), 1) ** 3);
    return earthAcc.add(moonAcc);
  }

  function scalePoint(pointKm) {
    return new THREE.Vector3(pointKm.x, pointKm.z, pointKm.y).multiplyScalar(KM_TO_SCENE);
  }

  function planetAngle(config, simDays) {
    return config.orbitAngleOffset + (simDays / config.periodDays) * Math.PI * 2;
  }

  function updateSolarSystem(simDays) {
    planets.forEach((planet) => {
      const angle = planetAngle(planet, simDays);
      const position = new THREE.Vector3(
        Math.cos(angle) * planet.orbitRadius,
        0,
        Math.sin(angle) * planet.orbitRadius
      );
      planet.mesh.position.copy(position);
      if (planet.mesh.isMesh) {
        planet.mesh.rotation.y += 0.0025;
      }
    });

    const moonPhase =
      (plannerState.solution?.phase ?? 0) + ((simDays * 86400) / constants.moonPeriod) * Math.PI * 2;
    plannerMoon.position.copy(scalePoint(moonPositionAt(0, moonPhase)));
    plannerMoon.rotation.y += 0.0018;
    plannerEarth.rotation.y += 0.003;
  }

  function solveTrajectory() {
    const leoAltitude = Number(plannerUi.leoAltitude.value);
    const flightTime = Number(plannerUi.flightDays.value) * 86400;
    const perilune = Number(plannerUi.perilune.value);
    const r0 = constants.earthRadius + leoAltitude;
    const vCircular = Math.sqrt(constants.muEarth / r0);
    const expectedPhase = Math.PI - ((Math.PI * 2) / constants.moonPeriod) * flightTime * 0.92;

    let best = null;

    for (let dv = 3.02; dv <= 3.34; dv += 0.012) {
      for (let phase = expectedPhase - 0.42; phase <= expectedPhase + 0.42; phase += 0.016) {
        let position = new THREE.Vector3(r0, 0, 0);
        let velocity = new THREE.Vector3(0, vCircular + dv, 0);
        const dt = 600;
        const steps = Math.floor(flightTime / dt);
        const points = [];
        let minDistance = Infinity;
        let closestIndex = 0;
        let closestRelVelocity = Infinity;
        let velocityAtClosest = velocity.clone();

        for (let i = 0; i <= steps; i += 1) {
          const time = i * dt;
          const moonPos = moonPositionAt(time, phase);
          points.push(position.clone());
          const distance = position.distanceTo(moonPos);
          if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
            velocityAtClosest = velocity.clone();
          }

          const k1v = accelerationAt(position, moonPos).multiplyScalar(dt);
          const k1r = velocity.clone().multiplyScalar(dt);
          const moonPos2 = moonPositionAt(time + dt * 0.5, phase);
          const k2v = accelerationAt(position.clone().add(k1r.clone().multiplyScalar(0.5)), moonPos2).multiplyScalar(dt);
          const k2r = velocity.clone().add(k1v.clone().multiplyScalar(0.5)).multiplyScalar(dt);
          const k3v = accelerationAt(position.clone().add(k2r.clone().multiplyScalar(0.5)), moonPos2).multiplyScalar(dt);
          const k3r = velocity.clone().add(k2v.clone().multiplyScalar(0.5)).multiplyScalar(dt);
          const moonPos4 = moonPositionAt(time + dt, phase);
          const k4v = accelerationAt(position.clone().add(k3r), moonPos4).multiplyScalar(dt);
          const k4r = velocity.clone().add(k3v).multiplyScalar(dt);

          position = position
            .clone()
            .add(k1r.clone().add(k2r.clone().multiplyScalar(2)).add(k3r.clone().multiplyScalar(2)).add(k4r).multiplyScalar(1 / 6));
          velocity = velocity
            .clone()
            .add(k1v.clone().add(k2v.clone().multiplyScalar(2)).add(k3v.clone().multiplyScalar(2)).add(k4v).multiplyScalar(1 / 6));
        }

        const closestTime = closestIndex * dt;
        const relVel = velocityAtClosest.clone().sub(moonVelocityAt(closestTime, phase));
        closestRelVelocity = relVel.length();
        const targetPerilune = constants.moonRadius + perilune;
        const score =
          Math.abs(minDistance - targetPerilune) * 1.2 +
          dv * 220 +
          Math.abs(closestTime - flightTime) * 0.0025 +
          closestRelVelocity * 38;

        if (!best || score < best.score) {
          best = {
            deltaV: dv,
            phase,
            score,
            points,
            closestDistance: minDistance,
            closestTime,
            relVel,
            moonAtClosest: moonPositionAt(closestTime, phase),
          };
        }
      }
    }

    return best;
  }

  function updatePlannerLabels() {
    plannerUi.leoAltitudeValue.textContent = `${plannerUi.leoAltitude.value} km`;
    plannerUi.flightDaysValue.textContent = `${plannerUi.flightDays.value} dni`;
    plannerUi.periluneValue.textContent = `${plannerUi.perilune.value} km`;
  }

  function runPlanner() {
    plannerUi.status.textContent = "Status: licze trajektorie...";
    const solution = solveTrajectory();
    plannerState.solution = solution;
    plannerState.elapsedRealSeconds = 0;
    plannerState.lastAnimationTime = 0;
    plannerState.tracePoints = [];

    trajectoryLine.geometry.setFromPoints(solution.points.map(scalePoint));
    transferGlow.geometry.setFromPoints(solution.points.map(scalePoint));
    spacecraftTrace.geometry.setFromPoints([scalePoint(solution.points[0]), scalePoint(solution.points[0])]);

    const r0 = constants.earthRadius + Number(plannerUi.leoAltitude.value);
    parkingLine.geometry.setFromPoints(
      new THREE.EllipseCurve(0, 0, r0 * KM_TO_SCENE, r0 * KM_TO_SCENE, 0, Math.PI * 2, false, 0)
        .getPoints(220)
        .map((point) => new THREE.Vector3(point.x, 0, point.y))
    );

    burnVector.position.copy(scalePoint(new THREE.Vector3(r0, 0, 0)));
    burnVector.setDirection(new THREE.Vector3(0, 1, 0));
    burnVector.setLength(8 + solution.deltaV * 4.2, 3, 1.6);
    spacecraft.position.copy(scalePoint(solution.points[0]));
    spacecraft.rotation.set(0, 0, 0);
    approachMarker.position.copy(scalePoint(solution.points[Math.floor(solution.closestTime / 600)] ?? solution.points.at(-1)));
    plannerMoon.position.copy(scalePoint(solution.moonAtClosest));
    thrustVector.position.copy(scalePoint(new THREE.Vector3(r0 - 2.3, 0, 0)));
    thrustVector.setDirection(new THREE.Vector3(0, 1, 0));
    thrustVector.setLength(11, 3.2, 1.6);
    thrustVectorSecondary.position.copy(scalePoint(new THREE.Vector3(r0 - 2.1, 0, 0)));
    thrustVectorSecondary.setDirection(new THREE.Vector3(0, 1, 0));
    thrustVectorSecondary.setLength(6.5, 2.2, 1.1);

    plannerUi.deltaV.textContent = `${solution.deltaV.toFixed(3)} km/s`;
    plannerUi.vinf.textContent = `${solution.relVel.length().toFixed(3)} km/s`;
    plannerUi.closest.textContent = `${solution.closestDistance.toFixed(0)} km`;
    plannerUi.tof.textContent = `${(solution.closestTime / 86400).toFixed(2)} dni`;
    plannerUi.summary.textContent =
      `Nowy solver szuka impulsu TLI z LEO i propaguje statek w ukladzie Ziemia-Ksiezyc, a scena pokazuje caly Uklad Sloneczny jako kontekst. ` +
      `Najlepsze przeciecie strefy ksiezycowej wypada po ${(solution.closestTime / 86400).toFixed(2)} dniach.`;
    plannerUi.status.textContent = "Status: trajektoria i planety sa zsynchronizowane";
  }

  plannerUi.run.addEventListener("click", runPlanner);
  const plannerInputs = [plannerUi.leoAltitude, plannerUi.flightDays, plannerUi.perilune];
  plannerInputs.forEach((input) => input.addEventListener("input", updatePlannerLabels));
  updatePlannerLabels();

  function resize() {
    const viewport = getViewportSize();
    plannerCamera.aspect = viewport.width / viewport.height;
    plannerCamera.updateProjectionMatrix();
    plannerRenderer.setSize(viewport.width, viewport.height);
  }

  function setActive(value) {
    plannerState.active = value;
    plannerRenderer.domElement.style.display = value ? "block" : "none";
    plannerControls.enabled = value;
    if (value && !plannerState.solution) {
      runPlanner();
    }
  }

  function animatePlanner(time) {
    if (!plannerState.active) {
      return;
    }

    const timeSeconds = time * 0.001;
    if (plannerState.lastAnimationTime === 0) {
      plannerState.lastAnimationTime = timeSeconds;
    }
    const deltaSeconds = Math.min(timeSeconds - plannerState.lastAnimationTime, 0.05);
    plannerState.lastAnimationTime = timeSeconds;
    plannerState.elapsedRealSeconds += deltaSeconds;

    const simDays = plannerState.elapsedRealSeconds * 0.12;
    updateSolarSystem(simDays);

    if (plannerState.solution) {
      const missionDuration = Math.max(plannerState.solution.closestTime, 3600);
      const missionSeconds = (plannerState.elapsedRealSeconds * 86400 * 0.12) % missionDuration;
      const missionIndex = Math.min(
        Math.floor(missionSeconds / 600),
        plannerState.solution.points.length - 1
      );
      const moonLocal = moonPositionAt(missionSeconds, plannerState.solution.phase);
      plannerMoon.position.copy(scalePoint(moonLocal));
      const currentPoint = scalePoint(plannerState.solution.points[missionIndex]);
      spacecraft.position.copy(currentPoint);
      const nextPoint = scalePoint(
        plannerState.solution.points[Math.min(missionIndex + 1, plannerState.solution.points.length - 1)]
      );
      const tangent = nextPoint.clone().sub(currentPoint);
      if (tangent.lengthSq() > 0.000001) {
        spacecraft.quaternion.setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          tangent.clone().normalize()
        );
      }

      const burnWindow = Math.max(Math.floor(plannerState.solution.points.length * 0.08), 12);
      const thrustActive = missionIndex <= burnWindow;
      plume.visible = thrustActive;
      thrustVector.visible = true;
      thrustVectorSecondary.visible = true;
      if (tangent.lengthSq() > 0.000001) {
        const thrustDirection = tangent.clone().normalize();
        const engineOffset = thrustDirection.clone().multiplyScalar(-2.7);
        const sideOffset = new THREE.Vector3(-thrustDirection.y, thrustDirection.x, 0).multiplyScalar(0.55);
        const pulse = thrustActive ? 1 + Math.sin(plannerState.elapsedRealSeconds * 18) * 0.18 : 0.82;
        thrustVector.position.copy(currentPoint.clone().add(engineOffset));
        thrustVector.setDirection(thrustDirection);
        thrustVector.setLength((thrustActive ? 8.5 : 5.8) * pulse, 2.8, 1.4);
        thrustVectorSecondary.position.copy(currentPoint.clone().add(engineOffset).add(sideOffset));
        thrustVectorSecondary.setDirection(thrustDirection);
        thrustVectorSecondary.setLength((thrustActive ? 5.2 : 3.4) * pulse, 2, 0.95);
        if (thrustActive) {
          plume.scale.set(1.1, pulse, 1.1);
        }
      }

      if (plannerState.tracePoints.length === 0 || plannerState.tracePoints.at(-1).distanceToSquared(currentPoint) > 0.02) {
        plannerState.tracePoints.push(currentPoint.clone());
        if (plannerState.tracePoints.length > 360) {
          plannerState.tracePoints.shift();
        }
        spacecraftTrace.geometry.setFromPoints(plannerState.tracePoints);
      }

      approachMarker.position.copy(scalePoint(plannerState.solution.moonAtClosest));
    }

    plannerControls.update();
    plannerRenderer.render(plannerScene, plannerCamera);
  }

  window.addEventListener("resize", resize);
  plannerRenderer.setAnimationLoop(animatePlanner);
  resize();

  function destroy() {
    window.removeEventListener("resize", resize);
    plannerUi.run.removeEventListener("click", runPlanner);
    plannerInputs.forEach((input) => input.removeEventListener("input", updatePlannerLabels));
    plannerRenderer.setAnimationLoop(null);
    plannerControls.dispose();
    plannerRenderer.dispose();
    plannerRenderer.domElement.remove();
  }

  return { setActive, resize, destroy };
}

const plannerView = setupPlannerView();

function setActiveTab(name) {
  tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
  views.forEach((view) => view.classList.toggle("is-active", view.dataset.view === name));
  const networkActive = name === "network";
  renderer.domElement.style.display = networkActive ? "block" : "none";
  controls.enabled = networkActive;
  plannerView.setActive(name === "planner");
}

const tabListeners = tabs.map((tab) => {
  const handler = () => setActiveTab(tab.dataset.tab);
  tab.addEventListener("click", handler);
  return { tab, handler };
});
setActiveTab("network");

function setCameraTopDown() {
  const moonWorldPos = moonGroup.getWorldPosition(new THREE.Vector3());
  const midX = moonWorldPos.x / 2;
  controls.target.set(midX, 0, 0);
  camera.position.set(midX, 55, 0.01);
  camera.up.set(0, 0, -1);
  controls.update();
}

function setCameraDefault() {
  camera.up.set(0, 1, 0);
  controls.target.set(0, 1.1, 0);
  camera.position.set(0, 6.4, 17.5);
  controls.update();
}

function setSimulationSlow(slow) {
  simulationSlow = slow;
}

return {
  unmount: () => {
    tabListeners.forEach(({ tab, handler }) => tab.removeEventListener("click", handler));
    renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
    renderer.domElement.removeEventListener("dblclick", handleDoubleClick);
    window.removeEventListener("resize", handleNetworkResize);
    document.removeEventListener("fullscreenchange", handleNetworkResize);
    plannerView.destroy();
    renderer.setAnimationLoop(null);
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  },
  setCameraTopDown,
  setCameraDefault,
  setSimulationSlow,
};
}
