import { useEffect, useMemo, useState } from "react";

import {
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CFormCheck,
  CFormInput,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from "@coreui/react";

const STATUS_PRIORITY = [
  "QUEUED_ON_EARTH",
  "IN_TRANSIT",
  "WAITING_RETRY",
  "CANCELLED",
  "DELIVERED",
  "FAILED",
  "ERROR",
];

function normalizeStatus(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
}

function statusLabel(value) {
  const normalized = normalizeStatus(value);
  if (!normalized) {
    return "N/A";
  }

  return normalized
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function toMillis(value) {
  const parsed = new Date(value);
  const millis = parsed.getTime();
  if (Number.isNaN(millis)) {
    return 0;
  }
  return millis;
}

function isTerminalStatus(value) {
  const normalized = normalizeStatus(value);
  return (
    normalized === "DELIVERED"
    || normalized === "FAILED"
    || normalized === "ERROR"
    || normalized === "CANCELLED"
  );
}

function derivePacketMeta(packet) {
  const historyRows = Array.isArray(packet.status_history) ? packet.status_history : [];
  const visitedSet = new Set();
  const latestByStatus = new Map();

  historyRows.forEach((row) => {
    const status = normalizeStatus(row?.status);
    if (!status) {
      return;
    }

    visitedSet.add(status);
    latestByStatus.set(status, row?.at || row?.timestamp || "");
  });

  const currentStatus = normalizeStatus(packet.current_status);
  if (currentStatus) {
    visitedSet.add(currentStatus);
    if (!latestByStatus.has(currentStatus)) {
      latestByStatus.set(currentStatus, packet.earth_timestamp || "");
    }
  }

  return {
    visitedSet,
    latestByStatus,
    currentStatus,
    historyRows,
  };
}

function buildStatusList(packetRows) {
  const set = new Set();

  STATUS_PRIORITY.forEach((item) => set.add(item));

  packetRows.forEach((packet) => {
    const current = normalizeStatus(packet.current_status);
    if (current) {
      set.add(current);
    }

    const historyRows = Array.isArray(packet.status_history) ? packet.status_history : [];
    historyRows.forEach((row) => {
      const status = normalizeStatus(row?.status);
      if (status) {
        set.add(status);
      }
    });
  });

  const rank = (status) => {
    const index = STATUS_PRIORITY.indexOf(status);
    return index >= 0 ? index : STATUS_PRIORITY.length + 100;
  };

  return [...set.values()].sort((left, right) => {
    const rankDiff = rank(left) - rank(right);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return left.localeCompare(right);
  });
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString();
}

function statusClassName(status, meta) {
  if (!meta) {
    return "pending";
  }

  if (meta.currentStatus && status === meta.currentStatus) {
    return "current";
  }

  if (meta.visitedSet.has(status)) {
    return "done";
  }

  return "pending";
}

export default function PacketStatusGraphPage({ packets, loadingPackets }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [selectedPacketIds, setSelectedPacketIds] = useState([]);
  const [focusedPacketId, setFocusedPacketId] = useState(null);

  const packetMap = useMemo(() => {
    return new Map(packets.map((packet) => [packet.packet_id, packet]));
  }, [packets]);

  const packetMetaMap = useMemo(() => {
    const map = new Map();
    packets.forEach((packet) => {
      map.set(packet.packet_id, derivePacketMeta(packet));
    });
    return map;
  }, [packets]);

  const visiblePackets = useMemo(() => {
    let rows = [...packets].sort((left, right) => toMillis(right.earth_timestamp) - toMillis(left.earth_timestamp));

    if (onlyActive) {
      rows = rows.filter((packet) => !isTerminalStatus(packet.current_status));
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return rows;
    }

    return rows.filter((packet) => {
      const id = String(packet.packet_id || "").toLowerCase();
      const route = `${packet.source_node || ""} ${packet.destination_node || ""}`.toLowerCase();
      const status = String(packet.current_status || "").toLowerCase();
      return id.includes(query) || route.includes(query) || status.includes(query);
    });
  }, [packets, onlyActive, searchQuery]);

  useEffect(() => {
    const visibleIdSet = new Set(visiblePackets.map((packet) => packet.packet_id));

    setSelectedPacketIds((current) => {
      const next = current.filter((packetId) => visibleIdSet.has(packetId));
      if (next.length > 0) {
        return next;
      }
      return visiblePackets.slice(0, 3).map((packet) => packet.packet_id);
    });
  }, [visiblePackets]);

  useEffect(() => {
    if (selectedPacketIds.length === 0) {
      setFocusedPacketId(null);
      return;
    }

    if (!focusedPacketId || !selectedPacketIds.includes(focusedPacketId)) {
      setFocusedPacketId(selectedPacketIds[0]);
    }
  }, [selectedPacketIds, focusedPacketId]);

  const selectedPackets = useMemo(() => {
    return selectedPacketIds.map((packetId) => packetMap.get(packetId)).filter(Boolean);
  }, [selectedPacketIds, packetMap]);

  const allStatuses = useMemo(() => {
    if (selectedPackets.length > 0) {
      return buildStatusList(selectedPackets);
    }
    return buildStatusList(visiblePackets);
  }, [selectedPackets, visiblePackets]);

  const statusCoverage = useMemo(() => {
    const coverage = new Map();

    allStatuses.forEach((status) => {
      let count = 0;
      selectedPackets.forEach((packet) => {
        const meta = packetMetaMap.get(packet.packet_id);
        if (meta?.visitedSet.has(status)) {
          count += 1;
        }
      });
      coverage.set(status, count);
    });

    return coverage;
  }, [allStatuses, packetMetaMap, selectedPackets]);

  const focusedPacket = focusedPacketId ? packetMap.get(focusedPacketId) : null;
  const focusedMeta = focusedPacket ? packetMetaMap.get(focusedPacket.packet_id) : null;

  const togglePacket = (packetId) => {
    setSelectedPacketIds((current) => {
      if (current.includes(packetId)) {
        return current.filter((id) => id !== packetId);
      }
      return [...current, packetId];
    });
  };

  const selectAllVisible = () => {
    setSelectedPacketIds(visiblePackets.map((packet) => packet.packet_id));
  };

  const clearSelection = () => {
    setSelectedPacketIds([]);
    setFocusedPacketId(null);
  };

  return (
    <>
      <CRow className="g-4 mb-3">
        <CCol xs={12}>
          <CCard className="surface-card">
            <CCardHeader>
              <h2 className="h6 mb-0">Panel grafu statusow paczek</h2>
            </CCardHeader>
            <CCardBody>
              <p className="mb-0 text-body-secondary">
                Wybierz aktualne paczki po lewej, a po prawej zobaczysz graf wszystkich statusow oraz postep dla
                kazdej zaznaczonej paczki.
              </p>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>

      <CRow className="g-4">
        <CCol xl={4}>
          <CCard className="surface-card h-100">
            <CCardHeader className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
              <h2 className="h6 mb-0">Wybierz paczki</h2>
              <CBadge color="primary">{selectedPacketIds.length} zaznaczonych</CBadge>
            </CCardHeader>
            <CCardBody className="d-flex flex-column gap-3">
              <CFormInput
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Szukaj po ID, statusie, zrodle..."
              />

              <CFormCheck
                id="only-active-toggle"
                checked={onlyActive}
                onChange={(event) => setOnlyActive(event.target.checked)}
                label="Pokaz tylko aktywne (bez DELIVERED/FAILED/ERROR)"
              />

              <div className="d-flex gap-2 flex-wrap">
                <CButton color="secondary" size="sm" variant="outline" onClick={selectAllVisible}>
                  Zaznacz wszystkie widoczne
                </CButton>
                <CButton color="secondary" size="sm" variant="ghost" onClick={clearSelection}>
                  Wyczysc zaznaczenie
                </CButton>
              </div>

              {loadingPackets && (
                <div className="d-flex align-items-center gap-2">
                  <CSpinner size="sm" />
                  <span>Wczytywanie paczek...</span>
                </div>
              )}

              {!loadingPackets && visiblePackets.length === 0 && (
                <p className="mb-0 text-body-secondary">Brak paczek pasujacych do filtrow.</p>
              )}

              {!loadingPackets && visiblePackets.length > 0 && (
                <div className="status-selector-list">
                  {visiblePackets.map((packet) => {
                    const selected = selectedPacketIds.includes(packet.packet_id);
                    return (
                      <button
                        key={packet.packet_id}
                        type="button"
                        className={`status-selector-item ${selected ? "selected" : ""}`}
                        onClick={() => togglePacket(packet.packet_id)}
                      >
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <span className="mono fw-semibold">{packet.packet_id.slice(0, 12)}</span>
                          <CBadge color={selected ? "success" : "secondary"}>{selected ? "ON" : "OFF"}</CBadge>
                        </div>
                        <small className="text-body-secondary d-block mt-1">
                          {packet.source_node} -&gt; {packet.destination_node}
                        </small>
                        <small className="d-block mt-1">Status: {statusLabel(packet.current_status)}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </CCardBody>
          </CCard>
        </CCol>

        <CCol xl={8}>
          <CCard className="surface-card mb-4">
            <CCardHeader className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
              <h2 className="h6 mb-0">Graf wszystkich statusow</h2>
              <CBadge color="info">{allStatuses.length} statusow na grafie</CBadge>
            </CCardHeader>
            <CCardBody>
              {selectedPackets.length === 0 ? (
                <p className="mb-0 text-body-secondary">Zaznacz co najmniej jedna paczke, aby wyswietlic graf statusow.</p>
              ) : (
                <>
                  <div className="status-flow-wrapper mb-4">
                    <div className="status-flow-track">
                      {allStatuses.map((status, index) => (
                        <div className="status-flow-step" key={`global-${status}`}>
                          <div className="status-flow-node global">
                            <div className="fw-semibold">{statusLabel(status)}</div>
                            <small className="text-body-secondary">
                              {statusCoverage.get(status) || 0}/{selectedPackets.length} paczek
                            </small>
                          </div>
                          {index < allStatuses.length - 1 && <span className="status-flow-arrow">-&gt;</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="d-flex flex-column gap-3">
                    {selectedPackets.map((packet) => {
                      const meta = packetMetaMap.get(packet.packet_id);
                      const focused = packet.packet_id === focusedPacketId;

                      return (
                        <div
                          className={`status-packet-track ${focused ? "focused" : ""}`}
                          key={`track-${packet.packet_id}`}
                        >
                          <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
                            <button
                              type="button"
                              className="status-focus-btn"
                              onClick={() => setFocusedPacketId(packet.packet_id)}
                            >
                              <span className="mono fw-semibold">{packet.packet_id}</span>
                              <small className="text-body-secondary d-block">
                                {packet.source_node} -&gt; {packet.destination_node}
                              </small>
                            </button>
                            <CBadge color="primary">Aktualny: {statusLabel(packet.current_status)}</CBadge>
                          </div>

                          <div className="status-flow-wrapper">
                            <div className="status-flow-track">
                              {allStatuses.map((status, index) => (
                                <div className="status-flow-step" key={`${packet.packet_id}-${status}`}>
                                  <div className={`status-flow-node ${statusClassName(status, meta)}`}>
                                    <div className="fw-semibold">{statusLabel(status)}</div>
                                    <small className="text-body-secondary">
                                      {formatDateTime(meta?.latestByStatus.get(status))}
                                    </small>
                                  </div>
                                  {index < allStatuses.length - 1 && <span className="status-flow-arrow">-&gt;</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CCardBody>
          </CCard>

          <CCard className="surface-card">
            <CCardHeader className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
              <h2 className="h6 mb-0">Szczegoly historii statusow</h2>
              {focusedPacket && <CBadge color="warning">{focusedPacket.packet_id}</CBadge>}
            </CCardHeader>
            <CCardBody>
              {!focusedPacket && <p className="mb-0 text-body-secondary">Wybierz paczke, aby zobaczyc szczegoly historii.</p>}

              {focusedPacket && (
                <div className="table-responsive">
                  <CTable hover align="middle" className="mb-0 object-table-small">
                    <CTableHead>
                      <CTableRow>
                        <CTableHeaderCell scope="col">Status</CTableHeaderCell>
                        <CTableHeaderCell scope="col">Czas</CTableHeaderCell>
                        <CTableHeaderCell scope="col">Detale</CTableHeaderCell>
                        <CTableHeaderCell scope="col">Hop</CTableHeaderCell>
                      </CTableRow>
                    </CTableHead>
                    <CTableBody>
                      {(focusedMeta?.historyRows || []).length === 0 && (
                        <CTableRow>
                          <CTableDataCell colSpan={4} className="text-body-secondary">
                            Brak historii statusow dla wybranej paczki.
                          </CTableDataCell>
                        </CTableRow>
                      )}

                      {(focusedMeta?.historyRows || []).map((row, index) => {
                        const hopText =
                          typeof row?.hop_index === "number" && typeof row?.hop_total === "number"
                            ? `${row.hop_index}/${row.hop_total}`
                            : "-";

                        return (
                          <CTableRow key={`history-${focusedPacket.packet_id}-${index}`}>
                            <CTableDataCell>{statusLabel(row?.status)}</CTableDataCell>
                            <CTableDataCell className="mono text-body-secondary">{formatDateTime(row?.at)}</CTableDataCell>
                            <CTableDataCell>{row?.detail || row?.to_node || "-"}</CTableDataCell>
                            <CTableDataCell className="mono">{hopText}</CTableDataCell>
                          </CTableRow>
                        );
                      })}
                    </CTableBody>
                  </CTable>
                </div>
              )}
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>
    </>
  );
}
