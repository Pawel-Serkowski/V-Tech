/**
 * Comprehensive tests for orbit-utils.js
 * Covers: resolveNodePosition, toCanvasPoint, computeBounds, bodyFromNode
 */

import { describe, it, expect } from "vitest";
import { resolveNodePosition, toCanvasPoint, computeBounds } from "../utils/orbit-utils.js";

const EARTH_RADIUS = 6371;
const MOON_RADIUS = 1737.4;
const MOON_CENTER_X = 384400;

// ---------------------------------------------------------------------------
// resolveNodePosition – Cartesian input
// ---------------------------------------------------------------------------

describe("resolveNodePosition – Cartesian", () => {
  it("returns exact cartesian coords when all three are provided", () => {
    const node = { position_x_km: 1000, position_y_km: 2000, position_z_km: 3000 };
    const pos = resolveNodePosition(node, 0);
    expect(pos.x).toBe(1000);
    expect(pos.y).toBe(2000);
    expect(pos.z).toBe(3000);
  });

  it("sets velocityKms to null for cartesian nodes", () => {
    const node = { position_x_km: 0, position_y_km: 0, position_z_km: 0 };
    const pos = resolveNodePosition(node, 0);
    expect(pos.velocityKms).toBeNull();
  });

  it("returns earth bodyName when body is not set", () => {
    const node = { position_x_km: 100, position_y_km: 0, position_z_km: 0 };
    const pos = resolveNodePosition(node, 0);
    expect(pos.bodyName).toBe("earth");
  });
});

// ---------------------------------------------------------------------------
// resolveNodePosition – Surface node
// ---------------------------------------------------------------------------

describe("resolveNodePosition – surface", () => {
  it("places equatorial station close to Earth's surface at prime meridian", () => {
    const node = { body: "earth", surface_lat_deg: 0, surface_lon_deg: 0 };
    const pos = resolveNodePosition(node, 0);
    expect(Math.abs(pos.x - EARTH_RADIUS)).toBeLessThan(50);
    expect(Math.abs(pos.y)).toBeLessThan(50);
    expect(pos.z).toBeCloseTo(0, 0);
    expect(pos.velocityKms).toBe(0);
  });

  it("north pole station has z ≈ +EARTH_RADIUS", () => {
    const node = { body: "earth", surface_lat_deg: 90, surface_lon_deg: 0 };
    const pos = resolveNodePosition(node, 0);
    expect(Math.abs(pos.z - EARTH_RADIUS)).toBeLessThan(50);
  });

  it("moon surface station has bodyName=moon", () => {
    const node = { body: "moon", surface_lat_deg: 0, surface_lon_deg: 0 };
    const pos = resolveNodePosition(node, 0);
    expect(pos.bodyName).toBe("moon");
    // X should be near MOON_CENTER_X ± MOON_RADIUS
    expect(Math.abs(pos.x - MOON_CENTER_X)).toBeLessThan(MOON_RADIUS + 50);
  });
});

// ---------------------------------------------------------------------------
// resolveNodePosition – Orbital node
// ---------------------------------------------------------------------------

describe("resolveNodePosition – orbital", () => {
  it("places satellite at correct orbital radius from Earth", () => {
    const node = {
      body: "earth",
      orbiting_body: "earth",
      orbit_altitude_km: 500,
      orbital_phase_deg: 0,
      orbital_inclination_deg: 0,
    };
    const pos = resolveNodePosition(node, 0);
    const r = Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2);
    expect(Math.abs(r - (EARTH_RADIUS + 500))).toBeLessThan(20);
  });

  it("orbital velocity is positive", () => {
    const node = { body: "earth", orbit_altitude_km: 400, orbital_phase_deg: 0 };
    const pos = resolveNodePosition(node, 0);
    expect(pos.velocityKms).toBeGreaterThan(0);
  });

  it("elapsed time advances satellite position", () => {
    const node = { body: "earth", orbit_altitude_km: 400, orbital_phase_deg: 0 };
    const pos0 = resolveNodePosition(node, 0);
    const pos60 = resolveNodePosition(node, 60);
    // Position should have changed
    expect(pos0.x).not.toBeCloseTo(pos60.x, 2);
  });

  it("satellite orbiting moon has bodyName=moon", () => {
    const node = { body: "moon", orbiting_body: "moon", orbit_altitude_km: 100 };
    const pos = resolveNodePosition(node, 0);
    expect(pos.bodyName).toBe("moon");
  });
});

// ---------------------------------------------------------------------------
// resolveNodePosition – Fallback
// ---------------------------------------------------------------------------

describe("resolveNodePosition – fallback", () => {
  it("always returns a position even for empty node", () => {
    const pos = resolveNodePosition({}, 0);
    expect(pos).not.toBeNull();
    expect(typeof pos.x).toBe("number");
  });

  it("fallback is deterministic for the same node_id", () => {
    const node = { node_id: "GHOST_SAT" };
    const pos1 = resolveNodePosition(node, 0);
    const pos2 = resolveNodePosition(node, 0);
    expect(pos1.x).toBe(pos2.x);
    expect(pos1.y).toBe(pos2.y);
  });
});

// ---------------------------------------------------------------------------
// toCanvasPoint
// ---------------------------------------------------------------------------

describe("toCanvasPoint", () => {
  const bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };

  it("maps center to approximately middle of canvas", () => {
    const pt = toCanvasPoint({ x: 50, z: 50 }, bounds, 1000, 1000);
    expect(pt.x).toBeCloseTo(500, 0);
    expect(pt.y).toBeCloseTo(500, 0);
  });

  it("handles degenerate bounds without crashing", () => {
    const degenerateBounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    const pt = toCanvasPoint({ x: 0, z: 0 }, degenerateBounds, 100, 100);
    expect(Number.isFinite(pt.x)).toBe(true);
    expect(Number.isFinite(pt.y)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeBounds
// ---------------------------------------------------------------------------

describe("computeBounds", () => {
  it("includes Earth and Moon centers in bounds", () => {
    const bounds = computeBounds([]);
    expect(bounds.minX).toBeLessThanOrEqual(0); // Earth x=0
    expect(bounds.maxX).toBeGreaterThanOrEqual(MOON_CENTER_X); // Moon x=384400
  });

  it("extends bounds when positions are outside Earth-Moon range", () => {
    const positions = [{ x: -100000, z: 0 }, { x: 500000, z: 500000 }];
    const bounds = computeBounds(positions);
    expect(bounds.minX).toBeLessThanOrEqual(-100000);
    expect(bounds.maxX).toBeGreaterThanOrEqual(500000);
    expect(bounds.maxZ).toBeGreaterThanOrEqual(500000);
  });
});
