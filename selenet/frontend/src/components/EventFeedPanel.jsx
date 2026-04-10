import { CBadge, CCard, CCardBody, CCardHeader, CListGroup, CListGroupItem } from "@coreui/react";

function statusColor(status) {
  if (!status) {
    return "secondary";
  }

  const normalized = String(status).toUpperCase();

  if (normalized.includes("CANCEL_REQUESTED")) {
    return "warning";
  }
  if (normalized.includes("CANCELLED")) {
    return "dark";
  }
  if (normalized.includes("DELIVERED")) {
    return "success";
  }
  if (normalized.includes("ERROR") || normalized.includes("FAILED")) {
    return "danger";
  }
  if (normalized.includes("WAITING")) {
    return "warning";
  }
  return "info";
}

export default function EventFeedPanel({ events, title = "Realtime Event Feed" }) {
  return (
    <CCard className="surface-card h-100">
      <CCardHeader className="d-flex justify-content-between align-items-center">
        <h2 className="h6 mb-0">{title}</h2>
        <CBadge color="info">{events.length} recent events</CBadge>
      </CCardHeader>
      <CCardBody>
        {events.length === 0 ? (
          <p className="mb-0 text-body-secondary">No live status events yet.</p>
        ) : (
          <CListGroup>
            {events.map((event, index) => (
              <CListGroupItem key={`${event.packet_id || "evt"}-${index}`}>
                <div className="d-flex justify-content-between flex-wrap gap-2">
                  <div>
                    <span className="mono fw-semibold">{event.packet_id || "unknown-packet"}</span>
                    <span className="mx-2 text-body-secondary">{"->"}</span>
                    <CBadge color={statusColor(event.status)}>{event.status || "unknown-status"}</CBadge>
                    {typeof event.hop_index === "number" && typeof event.hop_total === "number" && (
                      <small className="text-body-secondary ms-2">
                        hop {event.hop_index}/{event.hop_total}
                        {event.from_node && event.to_node
                          ? ` ${event.from_node} -> ${event.to_node}`
                          : ""}
                        {event.from_location && event.to_location
                          ? ` (${event.from_location} -> ${event.to_location})`
                          : ""}
                      </small>
                    )}
                    {event.next_hop && <small className="text-body-secondary ms-2">via {event.next_hop}</small>}
                  </div>
                  <small className="mono text-body-secondary">{event.at || "no timestamp"}</small>
                </div>
              </CListGroupItem>
            ))}
          </CListGroup>
        )}
      </CCardBody>
    </CCard>
  );
}
