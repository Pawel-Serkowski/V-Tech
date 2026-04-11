const TERMINAL_STATUSES = new Set(["DELIVERED", "FAILED", "ERROR", "CANCELLED", "FAILED_EXPIRED"]);

export const PRIORITY_LABEL = {
  1: "Critical",
  2: "High",
  3: "Bulk",
};

export function normalizeStatus(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
}

export function formatStatusLabel(value) {
  const normalized = normalizeStatus(value);
  if (!normalized) {
    return "N/A";
  }

  return normalized
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function isTerminalStatus(value) {
  return TERMINAL_STATUSES.has(normalizeStatus(value));
}

export function statusTone(value) {
  const status = normalizeStatus(value);

  if (!status) {
    return "muted";
  }
  if (status.includes("CANCEL_REQUESTED")) {
    return "warning";
  }
  if (status.includes("CANCELLED") || status.includes("FAILED") || status.includes("ERROR")) {
    return "danger";
  }
  if (status.includes("DELIVERED")) {
    return "success";
  }
  if (status.includes("IN_TRANSIT") || status.includes("QUEUED")) {
    return "accent";
  }
  if (status.includes("WAITING")) {
    return "warning";
  }

  return "muted";
}

export function getPriorityLabel(priority) {
  return PRIORITY_LABEL[priority] || `P${priority ?? "?"}`;
}

export function safeDateValue(value) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return timestamp;
}

export function sortPacketsByTime(packets) {
  return [...(Array.isArray(packets) ? packets : [])].sort(
    (left, right) => safeDateValue(right.earth_timestamp) - safeDateValue(left.earth_timestamp)
  );
}

export function computeMetrics(packets) {
  const rows = Array.isArray(packets) ? packets : [];

  const total = rows.length;
  const delivered = rows.filter((packet) => normalizeStatus(packet.current_status).includes("DELIVERED")).length;
  const active = rows.filter((packet) => !isTerminalStatus(packet.current_status)).length;
  const inTransit = rows.filter((packet) => {
    const status = normalizeStatus(packet.current_status);
    return status.includes("IN_TRANSIT") || status.includes("QUEUED") || status.includes("WAITING");
  }).length;
  const critical = rows.filter((packet) => Number(packet.priority) === 1).length;
  const cancelRequested = rows.filter((packet) => Boolean(packet.cancel_requested)).length;
  const successRate = total > 0 ? Math.round((delivered / total) * 100) : 0;

  return {
    total,
    delivered,
    active,
    inTransit,
    critical,
    cancelRequested,
    successRate,
  };
}

export function uniqueFieldValues(rows, fieldName) {
  const uniqueValues = new Set();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const value = row?.[fieldName];
    if (typeof value === "string" && value.trim()) {
      uniqueValues.add(value.trim());
    }
  });

  return [...uniqueValues].sort((left, right) => left.localeCompare(right));
}

export function filterPackets(packets, filters) {
  const rows = sortPacketsByTime(packets);
  const query = String(filters?.query || "").trim().toLowerCase();
  const status = normalizeStatus(filters?.status);
  const source = String(filters?.source || "").trim();
  const destination = String(filters?.destination || "").trim();
  const activeOnly = Boolean(filters?.activeOnly);

  return rows.filter((packet) => {
    if (activeOnly && isTerminalStatus(packet.current_status)) {
      return false;
    }

    if (status && normalizeStatus(packet.current_status) !== status) {
      return false;
    }

    if (source && packet.source_node !== source) {
      return false;
    }

    if (destination && packet.destination_node !== destination) {
      return false;
    }

    if (!query) {
      return true;
    }

    const searchable = [
      packet.packet_id,
      packet.source_node,
      packet.destination_node,
      packet.current_status,
      packet.next_hop,
    ]
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();

    return searchable.includes(query);
  });
}

export function paginate(items, page = 1, pageSize = 10) {
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedSize = Math.max(1, Number(pageSize) || 10);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedSize));
  const safePage = Math.min(normalizedPage, totalPages);
  const start = (safePage - 1) * normalizedSize;

  return {
    page: safePage,
    pageSize: normalizedSize,
    totalItems,
    totalPages,
    items: items.slice(start, start + normalizedSize),
  };
}

export function buildPacketTimeline(packet) {
  const historyRows = Array.isArray(packet?.status_history) ? packet.status_history : [];
  const timeline = historyRows.map((row) => ({
    key: `${row.status}-${row.at}-${row.hop_index ?? "na"}`,
    status: normalizeStatus(row.status),
    at: row.at,
    detail: row.detail || "",
    hopIndex: row.hop_index,
    hopTotal: row.hop_total,
    fromNode: row.from_node,
    toNode: row.to_node,
  }));

  const currentStatus = normalizeStatus(packet?.current_status);
  if (currentStatus && !timeline.some((item) => item.status === currentStatus)) {
    timeline.push({
      key: `current-${currentStatus}`,
      status: currentStatus,
      at: packet.earth_timestamp,
      detail: "Current packet state",
      hopIndex: null,
      hopTotal: null,
      fromNode: null,
      toNode: null,
    });
  }

  return timeline.filter((row) => row.status);
}

export function extractActiveRouteEdges(packets) {
  const rows = [];

  (Array.isArray(packets) ? packets : []).forEach((packet) => {
    if (isTerminalStatus(packet.current_status)) {
      return;
    }

    const historyRows = Array.isArray(packet.status_history) ? packet.status_history : [];
    for (let index = historyRows.length - 1; index >= 0; index -= 1) {
      const row = historyRows[index];
      if (row?.from_node && row?.to_node) {
        rows.push({
          packetId: packet.packet_id,
          from: row.from_node,
          to: row.to_node,
          status: packet.current_status,
        });
        return;
      }
    }

    if (packet.current_node_id && packet.next_hop) {
      rows.push({
        packetId: packet.packet_id,
        from: packet.current_node_id,
        to: packet.next_hop,
        status: packet.current_status,
      });
      return;
    }

    if (packet.source_node && packet.destination_node) {
      rows.push({
        packetId: packet.packet_id,
        from: packet.source_node,
        to: packet.destination_node,
        status: packet.current_status,
      });
    }
  });

  return rows;
}
