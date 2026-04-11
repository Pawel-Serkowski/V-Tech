import { useCallback, useEffect, useMemo, useState } from "react";

import {
  WS_STATUS_URL,
  cancelPacket,
  createPacket,
  deletePackets,
  fetchDispatchContext,
  fetchNodes,
  fetchPacket,
  fetchPackets,
  fetchQueueLoad,
  uploadNodesFile,
  uploadNodesJson,
} from "../api";

export function useTelemetry() {
  const [packets, setPackets] = useState([]);
  const [queueLoad, setQueueLoad] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [dispatchContext, setDispatchContext] = useState(null);
  const [events, setEvents] = useState([]);

  const [streamOnline, setStreamOnline] = useState(false);
  const [loadingTelemetry, setLoadingTelemetry] = useState(true);
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [loadingDispatchContext, setLoadingDispatchContext] = useState(true);
  const [cancellingPacketIds, setCancellingPacketIds] = useState([]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const clearFeedback = useCallback(() => {
    setMessage("");
    setError("");
  }, []);

  const refreshTelemetry = useCallback(async () => {
    const [packetRows, queueRows] = await Promise.all([fetchPackets(), fetchQueueLoad()]);
    setPackets(Array.isArray(packetRows) ? packetRows : []);
    setQueueLoad(Array.isArray(queueRows) ? queueRows : []);
  }, []);

  const refreshNodes = useCallback(async () => {
    const rows = await fetchNodes();
    setNodes(Array.isArray(rows) ? rows : []);
  }, []);

  const refreshDispatch = useCallback(async () => {
    const context = await fetchDispatchContext();
    setDispatchContext(context || null);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshTelemetry(), refreshNodes(), refreshDispatch()]);
  }, [refreshDispatch, refreshNodes, refreshTelemetry]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        await Promise.all([refreshTelemetry(), refreshNodes(), refreshDispatch()]);
      } catch (err) {
        if (active) {
          setError(err.message || "Failed to load telemetry.");
        }
      } finally {
        if (active) {
          setLoadingTelemetry(false);
          setLoadingNodes(false);
          setLoadingDispatchContext(false);
        }
      }
    }

    bootstrap();

    const telemetryInterval = setInterval(() => {
      refreshTelemetry().catch(() => {
        // Keep UI responsive during backend restarts.
      });
    }, 7000);

    const configInterval = setInterval(() => {
      Promise.all([refreshNodes(), refreshDispatch()]).catch(() => {
        // Ignore transient failures.
      });
    }, 10000);

    return () => {
      active = false;
      clearInterval(telemetryInterval);
      clearInterval(configInterval);
    };
  }, [refreshDispatch, refreshNodes, refreshTelemetry]);

  useEffect(() => {
    let socket = null;
    let reconnectTimer = null;
    let disposed = false;

    const connect = () => {
      if (disposed) {
        return;
      }

      socket = new WebSocket(WS_STATUS_URL);

      socket.onopen = () => {
        setStreamOnline(true);
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.kind === "packets-cleared") {
            setPackets([]);
            setQueueLoad([]);
            setEvents([]);
          } else {
            const event = parsed;
            setEvents((current) => [event, ...current].slice(0, 30));

            // Instant telemetry update for smooth animations
            if (event.kind === "packet-status" && event.packet_id) {
              setPackets((currentPackets) => {
                const index = currentPackets.findIndex((p) => p.packet_id === event.packet_id);
                if (index === -1) {
                   return currentPackets; // Unknown packet, wait for poll
                }
                const newPackets = [...currentPackets];
                newPackets[index] = {
                  ...newPackets[index],
                  current_status: event.status,
                  current_node_id: event.node_id,
                  current_hop_index: event.hop_index,
                  hop_total: event.hop_total,
                  from_node: event.from_node,
                  to_node: event.to_node,
                  next_hop: event.next_hop,
                  time_elapsed: event.time_elapsed,
                  ttl_remaining: event.ttl_remaining,
                };
                return newPackets;
              });
            }

            refreshTelemetry().catch(() => {
              // Background poll to keep authoritative state in sync
            });
          }
        } catch {
          // Ignore malformed event payloads.
        }
      };

      socket.onerror = () => {
        setStreamOnline(false);
      };

      socket.onclose = () => {
        setStreamOnline(false);
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      setStreamOnline(false);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socket) {
        socket.close();
      }
    };
  }, [refreshTelemetry]);

  const sendPacket = useCallback(
    async (payload) => {
      clearFeedback();
      const ack = await createPacket(payload);
      await refreshTelemetry();

      const routeText = Array.isArray(ack?.route_hops) && ack.route_hops.length > 0
        ? ` Trasa: ${ack.route_hops.join(" -> ")}.`
        : "";

      setMessage(`Pakiet ${ack.packet_id} przyjety (${ack.status}).${routeText}`);
      return ack;
    },
    [clearFeedback, refreshTelemetry]
  );

  const requestCancel = useCallback(
    async (packetId) => {
      clearFeedback();
      setCancellingPacketIds((current) => (current.includes(packetId) ? current : [...current, packetId]));

      try {
        await cancelPacket(packetId);
        setMessage(`Wyslano prosbe anulowania dla ${packetId}. Czekam na update telemetryczny.`);
        await refreshTelemetry();
      } finally {
        setCancellingPacketIds((current) => current.filter((currentId) => currentId !== packetId));
      }
    },
    [clearFeedback, refreshTelemetry]
  );

  const saveNodes = useCallback(
    async (payloadNodes, options = {}) => {
      clearFeedback();
      const result = await uploadNodesJson(payloadNodes, options);
      await Promise.all([refreshNodes(), refreshDispatch()]);

      const deleted = Number.isFinite(result?.deleted) ? result.deleted : 0;
      const resetPackets = Number.isFinite(result?.reset_packets) ? result.reset_packets : 0;
      setMessage(
        `${options.replace ? "Konfiguracja floty podmieniona." : "Konfiguracja floty zaktualizowana."} `
        + `Inserted: ${result.inserted}, Updated: ${result.updated}, Deleted: ${deleted}, Reset packets: ${resetPackets}.`
      );

      return result;
    },
    [clearFeedback, refreshDispatch, refreshNodes]
  );

  const saveNodesFromFile = useCallback(
    async (file, options = {}) => {
      clearFeedback();
      const result = await uploadNodesFile(file, options);
      await Promise.all([refreshNodes(), refreshDispatch()]);

      const deleted = Number.isFinite(result?.deleted) ? result.deleted : 0;
      const resetPackets = Number.isFinite(result?.reset_packets) ? result.reset_packets : 0;

      setMessage(
        `${options.replace ? "Wgrano plik i podmieniono cala flote." : "Wgrano plik konfiguracyjny floty."} `
        + `Inserted: ${result.inserted}, Updated: ${result.updated}, Deleted: ${deleted}, Reset packets: ${resetPackets}.`
      );

      return result;
    },
    [clearFeedback, refreshDispatch, refreshNodes]
  );

  const clearTelemetry = useCallback(async () => {
    clearFeedback();
    try {
      await deletePackets();
      setPackets([]);
      setEvents([]);
      setQueueLoad([]);
      setMessage("Wszystkie pakiety zostaly usuniete.");
    } catch (err) {
      setError(err.message || "Failed to clear packets.");
    }
  }, [clearFeedback]);

  const loadPacket = useCallback(async (packetId) => {
    return fetchPacket(packetId);
  }, []);

  const actions = useMemo(
    () => ({
      clearFeedback,
      refreshAll,
      refreshNodes,
      sendPacket,
      requestCancel,
      saveNodes,
      saveNodesFromFile,
      loadPacket,
      clearTelemetry,
      setError,
      setMessage,
    }),
    [clearFeedback, loadPacket, refreshAll, refreshNodes, requestCancel, saveNodes, saveNodesFromFile, sendPacket]
  );

  return {
    packets,
    queueLoad,
    nodes,
    dispatchContext,
    events,
    streamOnline,
    loadingTelemetry,
    loadingNodes,
    loadingDispatchContext,
    cancellingPacketIds,
    message,
    error,
    actions,
  };
}
