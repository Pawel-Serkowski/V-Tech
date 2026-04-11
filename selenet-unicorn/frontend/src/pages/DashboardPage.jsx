import { Link } from "react-router-dom";

import KpiCard from "../components/KpiCard";
import StatusPill from "../components/StatusPill";
import { sortPacketsByTime } from "../utils/packet-utils";

export default function DashboardPage({ metrics, packets, queueLoad, events, loadingTelemetry }) {
  const recentPackets = sortPacketsByTime(packets).slice(0, 8);
  const busyQueues = [...queueLoad].sort((left, right) => right.queued_packets - left.queued_packets).slice(0, 6);
  const latestEvents = events.slice(0, 8);

  return (
    <section className="stack-lg">
      <div className="grid-kpi">
        <KpiCard label="Pakiety lacznie" value={metrics.total} />
        <KpiCard label="Aktywne" value={metrics.active} tone="accent" hint="W ruchu lub w kolejce" />
        <KpiCard label="Dostarczone" value={metrics.delivered} tone="success" hint={`Skutecznosc ${metrics.successRate}%`} />
        <KpiCard label="Anulowania" value={metrics.cancelRequested} tone="warning" />
        <KpiCard label="Priorytet krytyczny" value={metrics.critical} tone="danger" />
      </div>

      <div className="grid-two">
        <article className="surface-card">
          <header className="surface-head">
            <h2>Ruch pakietow</h2>
            <Link to="/packets" className="text-link">
              Zobacz wszystkie
            </Link>
          </header>

          {loadingTelemetry ? (
            <p className="muted">Wczytywanie telemetryki...</p>
          ) : recentPackets.length === 0 ? (
            <p className="muted">Brak pakietow do wyswietlenia.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Trasa</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentPackets.map((packet) => (
                    <tr key={packet.packet_id}>
                      <td className="mono">{packet.packet_id.slice(0, 10)}</td>
                      <td>
                        {packet.source_node} -&gt; {packet.destination_node}
                      </td>
                      <td>
                        <StatusPill status={packet.current_status} />
                      </td>
                      <td>
                        <Link to={`/packets/${packet.packet_id}`} className="text-link">
                          Szczegoly
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="surface-card">
          <header className="surface-head">
            <h2>Obciazenie kolejek</h2>
            <span className="muted">Top wezly</span>
          </header>

          {busyQueues.length === 0 ? (
            <p className="muted">Brak aktywnego obciazenia kolejek.</p>
          ) : (
            <ul className="queue-list">
              {busyQueues.map((row) => {
                const max = Math.max(...busyQueues.map((item) => item.queued_packets), 1);
                const ratio = Math.max(8, Math.round((row.queued_packets / max) * 100));
                return (
                  <li key={row.node_id}>
                    <div className="queue-meta">
                      <span>{row.node_id}</span>
                      <strong>{row.queued_packets}</strong>
                    </div>
                    <div className="queue-bar">
                      <span style={{ width: `${ratio}%` }}></span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </div>

      <article className="surface-card">
        <header className="surface-head">
          <h2>Live event feed</h2>
          <span className="muted">Ostatnie statusy workerow</span>
        </header>

        {latestEvents.length === 0 ? (
          <p className="muted">Brak eventow websocket.</p>
        ) : (
          <ul className="event-list">
            {latestEvents.map((event, index) => (
              <li key={`${event.packet_id || "event"}-${index}`}>
                <div>
                  <strong className="mono">{event.packet_id || "unknown"}</strong>
                  <StatusPill status={event.status} />
                </div>
                <small className="muted">{event.at || "-"}</small>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
