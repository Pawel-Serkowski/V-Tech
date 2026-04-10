import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CAlert,
  CBadge,
  CCard,
  CCardBody,
  CCol,
  CContainer,
  CListGroup,
  CListGroupItem,
  CRow,
} from "@coreui/react";

import {
  WS_STATUS_URL,
  createPacket,
  fetchPackets,
  fetchQueueLoad,
  uploadNodesFile,
  uploadNodesJson,
} from "./api";
import ConfigUploadPanel from "./components/ConfigUploadPanel";
import PacketDispatchForm from "./components/PacketDispatchForm";
import PacketTable from "./components/PacketTable";
import QueueLoadPanel from "./components/QueueLoadPanel";

export default function App() {
  const [packets, setPackets] = useState([]);
  const [queueLoad, setQueueLoad] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [streamOnline, setStreamOnline] = useState(false);

  const refreshData = useCallback(async () => {
    const [packetRows, queueRows] = await Promise.all([fetchPackets(), fetchQueueLoad()]);
    setPackets(packetRows);
    setQueueLoad(queueRows);
  }, []);

  useEffect(() => {
    let alive = true;

    async function bootstrap() {
      try {
        await refreshData();
      } catch (err) {
        if (alive) {
          setError(err.message);
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    bootstrap();
    const intervalId = setInterval(() => {
      refreshData().catch(() => {
        // Keep UI responsive even when backend is restarting.
      });
    }, 7000);

    return () => {
      alive = false;
      clearInterval(intervalId);
    };
  }, [refreshData]);

  useEffect(() => {
    const socket = new WebSocket(WS_STATUS_URL);

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setEvents((current) => [data, ...current].slice(0, 20));
        refreshData().catch(() => {
          // Ignore transient backend errors.
        });
      } catch {
        // Ignore malformed websocket event.
      }
    };

    socket.onopen = () => {
      setStreamOnline(true);
      setError("");
    };

    socket.onerror = () => {
      setStreamOnline(false);
      setError("WebSocket stream unavailable. Retrying automatically...");
    };

    socket.onclose = () => {
      setStreamOnline(false);
    };

    const heartbeatId = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send("ping");
      }
    }, 20000);

    return () => {
      clearInterval(heartbeatId);
      socket.close();
    };
  }, [refreshData]);

  const handlePacketDispatch = async (payload) => {
    setError("");
    setMessage("");

    try {
      const ack = await createPacket(payload);
      setMessage(`Packet ${ack.packet_id} accepted with status ${ack.status}.`);
      await refreshData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUploadJson = async (nodes) => {
    setError("");
    setMessage("");

    try {
      const result = await uploadNodesJson(nodes);
      setMessage(`Node update applied. Inserted: ${result.inserted}, Updated: ${result.updated}.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUploadFile = async (file) => {
    setError("");
    setMessage("");

    try {
      const result = await uploadNodesFile(file);
      setMessage(`File imported. Inserted: ${result.inserted}, Updated: ${result.updated}.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const metrics = useMemo(() => {
    const total = packets.length;
    const delivered = packets.filter((packet) => packet.current_status?.includes("DELIVERED")).length;
    const inTransit = packets.filter((packet) =>
      ["QUEUED_ON_EARTH", "IN_TRANSIT"].some((status) => packet.current_status?.includes(status))
    ).length;
    const critical = packets.filter((packet) => packet.priority === 1).length;

    return { total, delivered, inTransit, critical };
  }, [packets]);

  return (
    <div className="iot-shell">
      <CContainer fluid className="shell-content py-2 py-md-3">
        <CRow className="g-4 mb-2">
          <CCol xs={12}>
            <CCard className="surface-card">
              <CCardBody className="d-flex flex-column flex-lg-row justify-content-between align-items-start align-items-lg-center gap-3">
                <div>
                  <p className="mb-1 text-body-secondary text-uppercase fw-semibold">Earth-Moon Gateway</p>
                  <h1 className="dashboard-title mb-1">SELeNet IoT Operations Dashboard</h1>
                  <p className="mb-0 text-body-secondary">
                    Monitor DTN routing, packet priorities, node windows, and transport simulation in one control room.
                  </p>
                </div>
                <CBadge color={streamOnline ? "success" : "warning"} shape="rounded-pill" className="px-3 py-2">
                  Stream {streamOnline ? "Online" : "Reconnecting"}
                </CBadge>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>

        {(message || error) && (
          <CRow className="g-3 mb-1">
            <CCol xs={12}>
              {message && <CAlert color="success" className="mb-2">{message}</CAlert>}
              {error && <CAlert color="danger" className="mb-0">{error}</CAlert>}
            </CCol>
          </CRow>
        )}

        <CRow className="g-3 mb-4">
          <CCol sm={6} xl={3}>
            <CCard className="metric-card">
              <CCardBody>
                <div className="metric-title">Total Packets</div>
                <div className="metric-value">{metrics.total}</div>
              </CCardBody>
            </CCard>
          </CCol>
          <CCol sm={6} xl={3}>
            <CCard className="metric-card">
              <CCardBody>
                <div className="metric-title">Delivered</div>
                <div className="metric-value">{metrics.delivered}</div>
              </CCardBody>
            </CCard>
          </CCol>
          <CCol sm={6} xl={3}>
            <CCard className="metric-card">
              <CCardBody>
                <div className="metric-title">In Transit / Queued</div>
                <div className="metric-value">{metrics.inTransit}</div>
              </CCardBody>
            </CCard>
          </CCol>
          <CCol sm={6} xl={3}>
            <CCard className="metric-card">
              <CCardBody>
                <div className="metric-title">Critical Priority</div>
                <div className="metric-value">{metrics.critical}</div>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>

        <CRow className="g-4">
          <CCol xl={8}>
            <PacketTable packets={packets} loading={loading} />
          </CCol>
          <CCol xl={4}>
            <QueueLoadPanel queueLoad={queueLoad} />
          </CCol>
        </CRow>

        <CRow className="g-4 mt-1">
          <CCol lg={6}>
            <PacketDispatchForm onDispatch={handlePacketDispatch} />
          </CCol>
          <CCol lg={6}>
            <ConfigUploadPanel onUploadJson={handleUploadJson} onUploadFile={handleUploadFile} />
          </CCol>
        </CRow>

        <CRow className="g-4 mt-1">
          <CCol xs={12}>
            <CCard className="surface-card">
              <CCardBody>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h2 className="h6 mb-0">Realtime Event Feed</h2>
                  <CBadge color="info">{events.length} recent events</CBadge>
                </div>

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
                            <CBadge color="primary">{event.status || "unknown-status"}</CBadge>
                            {event.next_hop && (
                              <small className="text-body-secondary ms-2">via {event.next_hop}</small>
                            )}
                          </div>
                          <small className="mono text-body-secondary">{event.at || "no timestamp"}</small>
                        </div>
                      </CListGroupItem>
                    ))}
                  </CListGroup>
                )}
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}