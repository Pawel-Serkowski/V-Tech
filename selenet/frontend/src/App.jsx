import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import {
  CAlert,
  CBadge,
  CCard,
  CCardBody,
  CCol,
  CContainer,
  CRow,
} from "@coreui/react";

import {
  WS_STATUS_URL,
  cancelPacket,
  createPacket,
  fetchNodes,
  fetchPackets,
  fetchQueueLoad,
  uploadNodesJson,
} from "./api";
import DispatchPage from "./pages/DispatchPage";
import MonitoringPage from "./pages/MonitoringPage";
import ObjectsPage from "./pages/ObjectsPage";
import PacketStatusGraphPage from "./pages/PacketStatusGraphPage";

const VisualizationPage = lazy(() => import("./pages/VisualizationPage"));

function navLinkClassName({ isActive }) {
  return isActive ? "app-nav-link active" : "app-nav-link";
}

export default function App() {
  const [packets, setPackets] = useState([]);
  const [queueLoad, setQueueLoad] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [events, setEvents] = useState([]);
  const [cancellingPacketIds, setCancellingPacketIds] = useState([]);
  const [loadingPackets, setLoadingPackets] = useState(true);
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [streamOnline, setStreamOnline] = useState(false);

  const refreshTelemetry = useCallback(async () => {
    const [packetRows, queueRows] = await Promise.all([fetchPackets(), fetchQueueLoad()]);
    setPackets(packetRows);
    setQueueLoad(queueRows);
  }, []);

  const refreshNodes = useCallback(async () => {
    const rows = await fetchNodes();
    setNodes(rows);
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        await Promise.all([refreshTelemetry(), refreshNodes()]);
      } catch (err) {
        if (active) {
          setError(err.message);
        }
      } finally {
        if (active) {
          setLoadingPackets(false);
          setLoadingNodes(false);
        }
      }
    }

    bootstrap();
    const telemetryIntervalId = setInterval(() => {
      refreshTelemetry().catch(() => {
        // Keep UI responsive even when backend is restarting.
      });
    }, 7000);

    const nodesIntervalId = setInterval(() => {
      refreshNodes().catch(() => {
        // Ignore transient fetch failures for node list.
      });
    }, 25000);

    return () => {
      active = false;
      clearInterval(telemetryIntervalId);
      clearInterval(nodesIntervalId);
    };
  }, [refreshNodes, refreshTelemetry]);

  useEffect(() => {
    const socket = new WebSocket(WS_STATUS_URL);

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setEvents((current) => [data, ...current].slice(0, 20));
        refreshTelemetry().catch(() => {
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
  }, [refreshTelemetry]);

  const handlePacketDispatch = async (payload) => {
    setError("");
    setMessage("");

    try {
      const ack = await createPacket(payload);
      const routeSummary = Array.isArray(ack.route_hops) && ack.route_hops.length > 0
        ? ` Planned route: ${ack.route_hops.join(" -> ")}.`
        : "";
      setMessage(`Packet ${ack.packet_id} accepted with status ${ack.status}.${routeSummary}`);
      await refreshTelemetry();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRefreshNodes = useCallback(async () => {
    setLoadingNodes(true);

    try {
      await refreshNodes();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingNodes(false);
    }
  }, [refreshNodes]);

  const handleCancelPacket = useCallback(async (packetId) => {
    setError("");
    setMessage("");

    setCancellingPacketIds((current) =>
      current.includes(packetId) ? current : [...current, packetId]
    );

    try {
      await cancelPacket(packetId);
      setMessage(`Cancellation requested for packet ${packetId}. Waiting for backend status update.`);
      await refreshTelemetry();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancellingPacketIds((current) =>
        current.filter((currentId) => currentId !== packetId)
      );
    }
  }, [refreshTelemetry]);

  const handleSaveNodes = async (payloadNodes, options = {}) => {
    setError("");
    setMessage("");

    try {
      const result = await uploadNodesJson(payloadNodes, options);
      const deleted = Number.isFinite(result.deleted) ? result.deleted : 0;
      const summary = options.replace ? "Node configuration replaced." : "Node update applied.";
      setMessage(`${summary} Inserted: ${result.inserted}, Updated: ${result.updated}, Deleted: ${deleted}.`);
      await handleRefreshNodes();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
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
                  <h1 className="dashboard-title mb-1">selenet IoT Operations Dashboard</h1>
                  <p className="mb-0 text-body-secondary">
                    Monitor routing, dispatch packet traffic, and manage object definitions from dedicated views.
                  </p>
                </div>
                <CBadge
                  color={streamOnline ? "success" : "warning"}
                  shape="rounded-pill"
                  className={`px-3 py-2 stream-badge ${streamOnline ? "is-online" : "is-reconnecting"}`}
                >
                  Stream {streamOnline ? "Online" : "Reconnecting"}
                </CBadge>
              </CCardBody>

              <div className="app-nav-wrap">
                <NavLink className={navLinkClassName} to="/" end>
                  Monitoring
                </NavLink>
                <NavLink className={navLinkClassName} to="/dispatch">
                  Dispatch
                </NavLink>
                <NavLink className={navLinkClassName} to="/status-graph">
                  Graf Statusow
                </NavLink>
                <NavLink className={navLinkClassName} to="/objects">
                  Objects
                </NavLink>
                <NavLink className={navLinkClassName} to="/visualization">
                  Visualization
                </NavLink>
              </div>
            </CCard>
          </CCol>
        </CRow>

        {(message || error) && (
          <CRow className="g-3 mb-1">
            <div className="col-12">
              {message && <CAlert color="success" className="mb-2">{message}</CAlert>}
              {error && <CAlert color="danger" className="mb-0">{error}</CAlert>}
            </div>
          </CRow>
        )}

        <Routes>
          <Route
            path="/"
            element={(
              <MonitoringPage
                metrics={metrics}
                packets={packets}
                queueLoad={queueLoad}
                events={events}
                loadingPackets={loadingPackets}
                cancellingPacketIds={cancellingPacketIds}
                onCancelPacket={handleCancelPacket}
              />
            )}
          />
          <Route
            path="/dispatch"
            element={(
              <DispatchPage
                onDispatch={handlePacketDispatch}
                packets={packets}
                events={events}
                loadingPackets={loadingPackets}
                cancellingPacketIds={cancellingPacketIds}
                onCancelPacket={handleCancelPacket}
              />
            )}
          />
          <Route
            path="/status-graph"
            element={(
              <PacketStatusGraphPage
                packets={packets}
                loadingPackets={loadingPackets}
              />
            )}
          />
          <Route
            path="/objects"
            element={(
              <ObjectsPage
                nodes={nodes}
                loadingNodes={loadingNodes}
                onSaveNodes={handleSaveNodes}
                onRefreshNodes={handleRefreshNodes}
              />
            )}
          />
          <Route
            path="/visualization"
            element={(
              <Suspense fallback={<div className="px-2 py-4 text-body-secondary">Loading visualization...</div>}>
                <VisualizationPage
                  packets={packets}
                  nodes={nodes}
                />
              </Suspense>
            )}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CContainer>
    </div>
  );
}