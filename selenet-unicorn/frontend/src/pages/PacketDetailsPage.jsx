import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import StatusPill from "../components/StatusPill";
import { buildPacketTimeline, formatStatusLabel, getPriorityLabel, statusTone } from "../utils/packet-utils";

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

export default function PacketDetailsPage({ packets, onLoadPacket }) {
  const { packetId } = useParams();
  const [remotePacket, setRemotePacket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const packetFromState = useMemo(() => packets.find((packet) => packet.packet_id === packetId) || null, [packetId, packets]);
  const packet = packetFromState || remotePacket;

  useEffect(() => {
    let active = true;

    if (packetFromState || !packetId) {
      return undefined;
    }

    setLoading(true);
    setError("");

    onLoadPacket(packetId)
      .then((row) => {
        if (active) {
          setRemotePacket(row);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message || "Nie udalo sie pobrac pakietu.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [onLoadPacket, packetFromState, packetId]);

  const timeline = useMemo(() => buildPacketTimeline(packet), [packet]);

  return (
    <section className="stack-lg">
      <article className="surface-card">
        <header className="surface-head">
          <div>
            <h2>Szczegoly pakietu</h2>
            <p className="muted">Widok pipeline statusow podobny do workflow build/deploy.</p>
          </div>
          <Link className="btn ghost" to="/packets">
            Wroc do listy
          </Link>
        </header>

        {loading ? <p className="muted">Pobieranie danych pakietu...</p> : null}
        {error ? <p className="text-danger">{error}</p> : null}

        {!loading && !packet ? <p className="muted">Nie znaleziono pakietu.</p> : null}

        {packet ? (
          <div className="stack-md">
            <div className="grid-summary">
              <div>
                <span className="summary-label">Packet ID</span>
                <strong className="mono">{packet.packet_id}</strong>
              </div>
              <div>
                <span className="summary-label">Trasa</span>
                <strong>
                  {packet.source_node} -&gt; {packet.destination_node}
                </strong>
              </div>
              <div>
                <span className="summary-label">Priorytet</span>
                <strong>{getPriorityLabel(packet.priority)}</strong>
              </div>
              <div>
                <span className="summary-label">Aktualny status</span>
                <StatusPill status={packet.current_status} />
              </div>
            </div>

            <div className="pipeline-scroll" role="img" aria-label="Pipeline statusow pakietu">
              <div className="pipeline-track">
                {timeline.map((step, index) => (
                  <div key={step.key} className="pipeline-step">
                    <article className={`pipeline-node ${statusTone(step.status)}`}>
                      <h3>{formatStatusLabel(step.status)}</h3>
                      <p>{step.detail || "-"}</p>
                      <small>{formatDate(step.at)}</small>
                      {typeof step.hopIndex === "number" && typeof step.hopTotal === "number" ? (
                        <small className="mono">hop {step.hopIndex}/{step.hopTotal}</small>
                      ) : null}
                    </article>
                    {index < timeline.length - 1 ? <span className="pipeline-arrow">-&gt;</span> : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Czas</th>
                    <th>Szczegoly</th>
                    <th>Hop</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((step) => (
                    <tr key={`row-${step.key}`}>
                      <td>{formatStatusLabel(step.status)}</td>
                      <td>{formatDate(step.at)}</td>
                      <td>{step.detail || "-"}</td>
                      <td className="mono">
                        {typeof step.hopIndex === "number" && typeof step.hopTotal === "number"
                          ? `${step.hopIndex}/${step.hopTotal}`
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </article>
    </section>
  );
}
