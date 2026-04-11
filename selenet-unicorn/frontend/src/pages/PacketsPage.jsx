import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import Paginator from "../components/Paginator";
import StatusPill from "../components/StatusPill";
import {
  filterPackets,
  formatStatusLabel,
  getPriorityLabel,
  isTerminalStatus,
  normalizeStatus,
  paginate,
  uniqueFieldValues,
} from "../utils/packet-utils";

const PAGE_SIZE = 12;

export default function PacketsPage({ packets, loading, cancellingPacketIds, onCancelPacket }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);

  const filteredPackets = useMemo(
    () => filterPackets(packets, { query, status, source, destination, activeOnly }),
    [activeOnly, destination, packets, query, source, status]
  );

  const statusOptions = useMemo(() => {
    const unique = new Set();
    packets.forEach((packet) => unique.add(normalizeStatus(packet.current_status)));
    return [...unique].filter(Boolean).sort((left, right) => left.localeCompare(right));
  }, [packets]);

  const sourceOptions = useMemo(() => uniqueFieldValues(packets, "source_node"), [packets]);
  const destinationOptions = useMemo(() => uniqueFieldValues(packets, "destination_node"), [packets]);

  const pageData = useMemo(() => paginate(filteredPackets, page, PAGE_SIZE), [filteredPackets, page]);

  useEffect(() => {
    setPage(1);
  }, [query, status, source, destination, activeOnly]);

  return (
    <section className="stack-lg">
      <article className="surface-card">
        <header className="surface-head">
          <h2>Wyslane pakiety</h2>
          <p className="muted">Filtrowanie, paginacja i szybkie przejscie do szczegolow procesu dostarczenia.</p>
        </header>

        <div className="filter-grid">
          <label>
            <span>Szukaj</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="packet_id, status, node"
            />
          </label>

          <label>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Wszystkie</option>
              {statusOptions.map((item) => (
                <option key={item} value={item}>
                  {formatStatusLabel(item)}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Zrodlo</span>
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="">Dowolne</option>
              {sourceOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Cel</span>
            <select value={destination} onChange={(event) => setDestination(event.target.value)}>
              <option value="">Dowolny</option>
              {destinationOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
            />
            <span>Tylko aktywne</span>
          </label>
        </div>
      </article>

      <article className="surface-card">
        <header className="surface-head">
          <h2>Lista pakietow</h2>
          <strong>{pageData.totalItems}</strong>
        </header>

        {loading ? (
          <p className="muted">Wczytywanie pakietow...</p>
        ) : pageData.items.length === 0 ? (
          <p className="muted">Brak wynikow dla wybranych filtrow.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Trasa</th>
                    <th>Priorytet</th>
                    <th>Status</th>
                    <th>Nastepny hop</th>
                    <th>Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.items.map((packet) => {
                    const canCancel = !isTerminalStatus(packet.current_status) && !packet.cancel_requested;
                    const cancelling = cancellingPacketIds.includes(packet.packet_id);

                    return (
                      <tr key={packet.packet_id}>
                        <td className="mono">{packet.packet_id.slice(0, 12)}</td>
                        <td>
                          {packet.source_node} -&gt; {packet.destination_node}
                        </td>
                        <td>{getPriorityLabel(packet.priority)}</td>
                        <td>
                          <StatusPill status={packet.current_status} />
                        </td>
                        <td>{packet.next_hop || "-"}</td>
                        <td>
                          <div className="action-row">
                            <Link className="btn tiny ghost" to={`/packets/${packet.packet_id}`}>
                              Szczegoly
                            </Link>
                            {canCancel ? (
                              <button
                                className="btn tiny danger"
                                type="button"
                                disabled={cancelling}
                                onClick={() => onCancelPacket(packet.packet_id)}
                              >
                                {cancelling ? "Anuluje..." : "Cancel"}
                              </button>
                            ) : (
                              <span className="muted tiny-label">Brak</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Paginator page={pageData.page} totalPages={pageData.totalPages} onChange={setPage} />
          </>
        )}
      </article>
    </section>
  );
}
