import { CBadge, CCard, CCardBody, CCardHeader, CProgress } from "@coreui/react";

export default function QueueLoadPanel({ queueLoad }) {
  const sorted = [...queueLoad].sort((a, b) => b.queued_packets - a.queued_packets);
  const maxLoad = Math.max(...sorted.map((item) => item.queued_packets), 1);

  return (
    <CCard className="surface-card queue-progress h-100">
      <CCardHeader>
        <h2 className="h6 mb-0">Node Queue Load</h2>
        <small className="text-body-secondary">Current packet pressure per node/satellite</small>
      </CCardHeader>
      <CCardBody className="d-flex flex-column gap-3">
        {sorted.length === 0 && <p className="mb-0 text-body-secondary">No queued packets right now.</p>}

        {sorted.map((item) => {
          const ratio = Math.max((item.queued_packets / maxLoad) * 100, 8);
          return (
            <div key={item.node_id}>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-semibold">{item.node_id}</div>
                <CBadge color="info" shape="rounded-pill">
                  {item.queued_packets}
                </CBadge>
              </div>
              <CProgress value={ratio} color={ratio > 75 ? "danger" : ratio > 45 ? "warning" : "success"} />
            </div>
          );
        })}
      </CCardBody>
    </CCard>
  );
}