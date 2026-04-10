import { useCallback, useEffect, useState } from "react";

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
      setMessage("Live status stream connected.");
      setError("");
    };

    socket.onerror = () => {
      setError("WebSocket stream unavailable. Retrying automatically...");
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

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 md:px-10">
      <div className="grid-noise" />

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="panel p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-solar-200">Earth-Moon Gateway</p>
          <h1 className="hud-title mt-2 text-2xl text-oceanic-100 md:text-4xl">
            SELeNet Command Dashboard
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-oceanic-200 md:text-base">
            Delay-Tolerant Routing Simulator with priority queues, contact windows, and Earth-time
            based packet tracking.
          </p>
          {message && <p className="mt-4 text-sm text-green-200">{message}</p>}
          {error && <p className="mt-2 text-sm text-red-200">{error}</p>}
        </header>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PacketTable packets={packets} loading={loading} />
          </div>
          <QueueLoadPanel queueLoad={queueLoad} />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <PacketDispatchForm onDispatch={handlePacketDispatch} />
          <ConfigUploadPanel onUploadJson={handleUploadJson} onUploadFile={handleUploadFile} />
        </section>

        <section className="panel p-5">
          <h2 className="hud-title text-sm text-oceanic-100">Realtime Event Feed</h2>
          <div className="mt-3 max-h-56 space-y-2 overflow-auto pr-1 text-sm">
            {events.length === 0 && (
              <p className="text-oceanic-200">No live status events yet.</p>
            )}
            {events.map((event, index) => (
              <div
                className="rounded-md border border-oceanic-400/30 bg-slate-950/35 px-3 py-2"
                key={`${event.packet_id || "evt"}-${index}`}
              >
                <p className="text-oceanic-100">
                  <span className="font-semibold">{event.packet_id || "unknown-packet"}</span> ->{" "}
                  {event.status || "unknown-status"}
                </p>
                <p className="text-xs text-oceanic-200">{event.at || "no timestamp"}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}