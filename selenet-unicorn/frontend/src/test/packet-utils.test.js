/**
 * Comprehensive tests for packet-utils.js
 */

import { describe, it, expect } from "vitest";
import {
  normalizeStatus,
  formatStatusLabel,
  isTerminalStatus,
  statusTone,
  getPriorityLabel,
  safeDateValue,
  sortPacketsByTime,
  computeMetrics,
  uniqueFieldValues,
  filterPackets,
  paginate,
  buildPacketTimeline,
  extractActiveRouteEdges,
} from "../utils/packet-utils.js";

// ---------------------------------------------------------------------------
// normalizeStatus
// ---------------------------------------------------------------------------

describe("normalizeStatus", () => {
  it("uppercases and trims", () => {
    expect(normalizeStatus("  in_transit  ")).toBe("IN_TRANSIT");
  });

  it("returns empty string for non-string input", () => {
    expect(normalizeStatus(null)).toBe("");
    expect(normalizeStatus(undefined)).toBe("");
    expect(normalizeStatus(42)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatStatusLabel
// ---------------------------------------------------------------------------

describe("formatStatusLabel", () => {
  it("converts IN_TRANSIT to In Transit", () => {
    expect(formatStatusLabel("IN_TRANSIT")).toBe("In Transit");
  });

  it("returns N/A for empty input", () => {
    expect(formatStatusLabel("")).toBe("N/A");
    expect(formatStatusLabel(null)).toBe("N/A");
  });

  it("handles single word", () => {
    expect(formatStatusLabel("DELIVERED")).toBe("Delivered");
  });
});

// ---------------------------------------------------------------------------
// isTerminalStatus
// ---------------------------------------------------------------------------

describe("isTerminalStatus", () => {
  it.each(["DELIVERED", "FAILED", "ERROR", "CANCELLED", "FAILED_EXPIRED"])(
    "%s is terminal",
    (status) => {
      expect(isTerminalStatus(status)).toBe(true);
    }
  );

  it.each(["IN_TRANSIT", "QUEUED_ON_SOURCE", "WAITING_RETRY"])(
    "%s is not terminal",
    (status) => {
      expect(isTerminalStatus(status)).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// statusTone
// ---------------------------------------------------------------------------

describe("statusTone", () => {
  it("DELIVERED → success", () => expect(statusTone("DELIVERED")).toBe("success"));
  it("CANCELLED → danger", () => expect(statusTone("CANCELLED")).toBe("danger"));
  it("FAILED → danger", () => expect(statusTone("FAILED")).toBe("danger"));
  it("IN_TRANSIT → accent", () => expect(statusTone("IN_TRANSIT")).toBe("accent"));
  it("QUEUED_ON_SOURCE → accent", () => expect(statusTone("QUEUED_ON_SOURCE")).toBe("accent"));
  it("WAITING_RETRY → warning", () => expect(statusTone("WAITING_RETRY")).toBe("warning"));
  it("CANCEL_REQUESTED → warning", () => expect(statusTone("CANCEL_REQUESTED")).toBe("warning"));
  it("empty → muted", () => expect(statusTone("")).toBe("muted"));
  it("unknown → muted", () => expect(statusTone("UNKNOWN_CUSTOM")).toBe("muted"));
});

// ---------------------------------------------------------------------------
// getPriorityLabel
// ---------------------------------------------------------------------------

describe("getPriorityLabel", () => {
  it("maps 1 → Critical, 2 → High, 3 → Bulk", () => {
    expect(getPriorityLabel(1)).toBe("Critical");
    expect(getPriorityLabel(2)).toBe("High");
    expect(getPriorityLabel(3)).toBe("Bulk");
  });

  it("unknown priority falls back to P<n>", () => {
    expect(getPriorityLabel(99)).toBe("P99");
    expect(getPriorityLabel(undefined)).toBe("P?");
  });
});

// ---------------------------------------------------------------------------
// safeDateValue
// ---------------------------------------------------------------------------

describe("safeDateValue", () => {
  it("returns 0 for invalid date", () => {
    expect(safeDateValue("not-a-date")).toBe(0);
    expect(safeDateValue(null)).toBe(0);
  });

  it("returns positive number for valid ISO string", () => {
    expect(safeDateValue("2026-01-01T00:00:00Z")).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// sortPacketsByTime
// ---------------------------------------------------------------------------

describe("sortPacketsByTime", () => {
  const packets = [
    { earth_timestamp: "2026-01-03T00:00:00Z", packet_id: "C" },
    { earth_timestamp: "2026-01-01T00:00:00Z", packet_id: "A" },
    { earth_timestamp: "2026-01-02T00:00:00Z", packet_id: "B" },
  ];

  it("sorts descending by earth_timestamp", () => {
    const sorted = sortPacketsByTime(packets);
    expect(sorted[0].packet_id).toBe("C");
    expect(sorted[1].packet_id).toBe("B");
    expect(sorted[2].packet_id).toBe("A");
  });

  it("does not mutate original array", () => {
    const original = [...packets];
    sortPacketsByTime(packets);
    expect(packets[0].packet_id).toBe(original[0].packet_id);
  });

  it("handles empty array", () => {
    expect(sortPacketsByTime([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeMetrics – extended
// ---------------------------------------------------------------------------

describe("computeMetrics – extended", () => {
  const packets = [
    { current_status: "DELIVERED", priority: 1, cancel_requested: false },
    { current_status: "IN_TRANSIT", priority: 2, cancel_requested: false },
    { current_status: "CANCELLED", priority: 3, cancel_requested: true },
    { current_status: "QUEUED_ON_SOURCE", priority: 1, cancel_requested: false },
  ];

  it("counts cancel_requested packets", () => {
    expect(computeMetrics(packets).cancelRequested).toBe(1);
  });

  it("computes successRate correctly", () => {
    expect(computeMetrics(packets).successRate).toBe(25);
  });

  it("returns zeros for empty array", () => {
    const m = computeMetrics([]);
    expect(m.total).toBe(0);
    expect(m.successRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// uniqueFieldValues
// ---------------------------------------------------------------------------

describe("uniqueFieldValues", () => {
  it("returns sorted unique values for a field", () => {
    const rows = [
      { source_node: "B" },
      { source_node: "A" },
      { source_node: "B" },
      { source_node: "C" },
    ];
    expect(uniqueFieldValues(rows, "source_node")).toEqual(["A", "B", "C"]);
  });

  it("ignores missing or empty values", () => {
    const rows = [{ source_node: "" }, { source_node: null }, { source_node: "A" }];
    expect(uniqueFieldValues(rows, "source_node")).toEqual(["A"]);
  });
});

// ---------------------------------------------------------------------------
// filterPackets – extended
// ---------------------------------------------------------------------------

describe("filterPackets – extended", () => {
  const packets = [
    { packet_id: "p1", source_node: "EARTH", destination_node: "MOON", current_status: "IN_TRANSIT", next_hop: "SAT_1", earth_timestamp: "2026-01-01T00:00:00Z" },
    { packet_id: "p2", source_node: "EARTH", destination_node: "MOON", current_status: "DELIVERED", next_hop: null, earth_timestamp: "2026-01-02T00:00:00Z" },
    { packet_id: "p3", source_node: "MOON", destination_node: "EARTH", current_status: "CANCELLED", next_hop: null, earth_timestamp: "2026-01-03T00:00:00Z" },
  ];

  it("returns all packets with no filters", () => {
    expect(filterPackets(packets, {})).toHaveLength(3);
  });

  it("filters by status", () => {
    const result = filterPackets(packets, { status: "DELIVERED" });
    expect(result).toHaveLength(1);
    expect(result[0].packet_id).toBe("p2");
  });

  it("filters activeOnly excludes terminal packets", () => {
    const result = filterPackets(packets, { activeOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].packet_id).toBe("p1");
  });

  it("filters by source node", () => {
    const result = filterPackets(packets, { source: "MOON" });
    expect(result).toHaveLength(1);
    expect(result[0].packet_id).toBe("p3");
  });

  it("filters by query string matching packet_id", () => {
    const result = filterPackets(packets, { query: "p2" });
    expect(result).toHaveLength(1);
    expect(result[0].packet_id).toBe("p2");
  });
});

// ---------------------------------------------------------------------------
// paginate – extended
// ---------------------------------------------------------------------------

describe("paginate – extended", () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);

  it("returns first page items", () => {
    const result = paginate(items, 1, 10);
    expect(result.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.totalPages).toBe(3);
  });

  it("clamps page to valid range", () => {
    const result = paginate(items, 99, 10);
    expect(result.page).toBe(3);
  });

  it("handles empty items", () => {
    const result = paginate([], 1, 10);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildPacketTimeline – extended
// ---------------------------------------------------------------------------

describe("buildPacketTimeline – extended", () => {
  it("maps status_history to timeline rows", () => {
    const packet = {
      current_status: "DELIVERED",
      earth_timestamp: "2026-01-01T00:00:00Z",
      status_history: [
        { status: "SAVED_ON_EARTH", at: "2026-01-01T00:00:00Z", detail: "saved" },
        { status: "DELIVERED", at: "2026-01-01T00:01:00Z", detail: "done" },
      ],
    };
    const timeline = buildPacketTimeline(packet);
    expect(timeline).toHaveLength(2);
    expect(timeline[0].status).toBe("SAVED_ON_EARTH");
  });

  it("does not duplicate current status if already in history", () => {
    const packet = {
      current_status: "DELIVERED",
      earth_timestamp: "2026-01-01T00:00:00Z",
      status_history: [{ status: "DELIVERED", at: "2026-01-01T00:01:00Z", detail: "done" }],
    };
    const timeline = buildPacketTimeline(packet);
    expect(timeline.filter((r) => r.status === "DELIVERED")).toHaveLength(1);
  });

  it("returns empty array for null packet", () => {
    expect(buildPacketTimeline(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractActiveRouteEdges – extended
// ---------------------------------------------------------------------------

describe("extractActiveRouteEdges – extended", () => {
  it("extracts last from_node/to_node from history", () => {
    const packets = [
      {
        packet_id: "p1",
        current_status: "IN_TRANSIT",
        current_node_id: "SAT_1",
        next_hop: "MOON",
        source_node: "EARTH",
        destination_node: "MOON",
        status_history: [
          { from_node: "EARTH", to_node: "SAT_1" },
          { from_node: "SAT_1", to_node: "MOON" },
        ],
      },
    ];
    const edges = extractActiveRouteEdges(packets);
    expect(edges[0].from).toBe("SAT_1");
    expect(edges[0].to).toBe("MOON");
  });

  it("skips terminal packets", () => {
    const packets = [
      {
        packet_id: "p2",
        current_status: "DELIVERED",
        source_node: "A",
        destination_node: "B",
        status_history: [],
      },
    ];
    expect(extractActiveRouteEdges(packets)).toHaveLength(0);
  });

  it("falls back to current_node_id/next_hop", () => {
    const packets = [
      {
        packet_id: "p3",
        current_status: "IN_TRANSIT",
        current_node_id: "SAT_X",
        next_hop: "LUNAR",
        source_node: "EARTH",
        destination_node: "LUNAR",
        status_history: [],
      },
    ];
    const edges = extractActiveRouteEdges(packets);
    expect(edges[0].from).toBe("SAT_X");
    expect(edges[0].to).toBe("LUNAR");
  });
});
