import {
  CBadge,
  CCard,
  CCardBody,
  CCardHeader,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from "@coreui/react";

const PRIORITY_LABEL = {
  1: "Critical",
  2: "High",
  3: "Bulk",
};

function statusColor(status) {
  if (!status) {
    return "secondary";
  }
  if (status.includes("DELIVERED")) {
    return "success";
  }
  if (status.includes("ERROR") || status.includes("FAILED")) {
    return "danger";
  }
  if (status.includes("WAITING")) {
    return "warning";
  }
  return "info";
}

function priorityColor(priority) {
  if (priority === 1) {
    return "danger";
  }
  if (priority === 2) {
    return "warning";
  }
  return "secondary";
}

function getLatestHopRow(packet) {
  if (!Array.isArray(packet.status_history)) {
    return null;
  }

  for (let index = packet.status_history.length - 1; index >= 0; index -= 1) {
    const row = packet.status_history[index];
    if (typeof row?.hop_index === "number" && typeof row?.hop_total === "number") {
      return row;
    }
  }

  return null;
}

export default function PacketTable({ packets, loading }) {
  return (
    <CCard className="surface-card">
      <CCardHeader className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <h2 className="h6 mb-0">Packet Routing Monitor</h2>
          <small className="text-body-secondary">Live DTN packet telemetry with current delivery state</small>
        </div>
        <CBadge color="primary" shape="rounded-pill">
          {packets.length} packets
        </CBadge>
      </CCardHeader>
      <CCardBody>
        {loading && (
          <div className="d-flex align-items-center gap-2">
            <CSpinner size="sm" />
            <span>Loading packet telemetry...</span>
          </div>
        )}

        {!loading && packets.length === 0 && (
          <p className="mb-0 text-body-secondary">No packets yet. Send your first IoT payload from the dispatch console.</p>
        )}

        {!loading && packets.length > 0 && (
          <div className="table-responsive">
            <CTable hover align="middle" className="mb-0">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell scope="col">Packet ID</CTableHeaderCell>
                  <CTableHeaderCell scope="col">Route</CTableHeaderCell>
                  <CTableHeaderCell scope="col">Planned Hops</CTableHeaderCell>
                  <CTableHeaderCell scope="col">Priority</CTableHeaderCell>
                  <CTableHeaderCell scope="col">Next Hop</CTableHeaderCell>
                  <CTableHeaderCell scope="col">Status</CTableHeaderCell>
                  <CTableHeaderCell scope="col">Earth Timestamp</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                {packets.map((packet) => {
                  const latestHop = getLatestHopRow(packet);

                  return (
                    <CTableRow key={packet.packet_id}>
                      <CTableDataCell className="mono">{packet.packet_id.slice(0, 8)}</CTableDataCell>
                      <CTableDataCell>
                        {packet.source_node}
                        {" -> "}
                        {packet.destination_node}
                      </CTableDataCell>
                      <CTableDataCell className="mono">
                        {Array.isArray(packet.route_hops) && packet.route_hops.length > 0
                          ? packet.route_hops.join(" -> ")
                          : "n/a"}
                      </CTableDataCell>
                      <CTableDataCell>
                        <CBadge color={priorityColor(packet.priority)}>
                          {PRIORITY_LABEL[packet.priority] || `P${packet.priority}`}
                        </CBadge>
                      </CTableDataCell>
                      <CTableDataCell>{packet.next_hop || "unassigned"}</CTableDataCell>
                      <CTableDataCell>
                        <CBadge color={statusColor(packet.current_status)}>{packet.current_status}</CBadge>
                        {latestHop && (
                          <small className="d-block text-body-secondary mt-1 mono">
                            hop {latestHop.hop_index}/{latestHop.hop_total}
                            {latestHop.from_node && latestHop.to_node
                              ? ` ${latestHop.from_node} -> ${latestHop.to_node}`
                              : ""}
                          </small>
                        )}
                      </CTableDataCell>
                      <CTableDataCell className="text-body-secondary mono">
                        {packet.earth_timestamp}
                      </CTableDataCell>
                    </CTableRow>
                  );
                })}
              </CTableBody>
            </CTable>
          </div>
        )}
      </CCardBody>
    </CCard>
  );
}