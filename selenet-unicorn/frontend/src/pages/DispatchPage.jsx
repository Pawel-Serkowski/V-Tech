import { useEffect, useMemo, useState } from "react";

import { computeMetrics } from "../utils/packet-utils";

const PAYLOAD_TEMPLATES = {
  healthcheck: {
    telemetry: "health-check",
    subsystem: "payload-bus",
    sequence: 1,
  },
  cancel: {
    command: "cancel-window",
    reason: "operator-request",
    target: "pending-packets",
  },
  nav: {
    telemetry: "orbital-nav",
    mode: "course-correction",
    delta: { yaw: 0.12, pitch: -0.04, roll: 0.01 },
  },
};

function safeJsonStringify(value) {
  return JSON.stringify(value, null, 2);
}

export default function DispatchPage({
  nodes,
  packets,
  dispatchContext,
  loadingNodes,
  loadingDispatchContext,
  onDispatch,
}) {
  const [sourceNode, setSourceNode] = useState("");
  const [destinationNode, setDestinationNode] = useState("");
  const [priority, setPriority] = useState("2");
  const [payloadText, setPayloadText] = useState(safeJsonStringify(PAYLOAD_TEMPLATES.healthcheck));
  const [localError, setLocalError] = useState("");
  const [sending, setSending] = useState(false);

  const metrics = computeMetrics(packets);

  const allNodeIds = useMemo(() => {
    return [...new Set((nodes || []).map((node) => node.node_id).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [nodes]);

  const allowedSources = useMemo(() => {
    const allowed = Array.isArray(dispatchContext?.allowed_source_nodes) ? dispatchContext.allowed_source_nodes : [];
    if (allowed.length === 0) {
      return [];
    }

    const known = new Set(allNodeIds);
    return allowed.filter((nodeId) => known.has(nodeId));
  }, [allNodeIds, dispatchContext]);

  const destinationOptions = useMemo(
    () => allNodeIds.filter((nodeId) => nodeId !== sourceNode),
    [allNodeIds, sourceNode]
  );

  useEffect(() => {
    if (allowedSources.length === 0) {
      setSourceNode("");
      return;
    }

    setSourceNode((current) => (allowedSources.includes(current) ? current : allowedSources[0]));
  }, [allowedSources]);

  useEffect(() => {
    if (destinationOptions.length === 0) {
      setDestinationNode("");
      return;
    }

    setDestinationNode((current) => (destinationOptions.includes(current) ? current : destinationOptions[0]));
  }, [destinationOptions]);

  const useTemplate = (key) => {
    const template = PAYLOAD_TEMPLATES[key];
    setPayloadText(safeJsonStringify(template));
  };

  const handlePayloadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setPayloadText(safeJsonStringify(parsed));
      setLocalError("");
    } catch (error) {
      setLocalError(error.message || "Niepoprawny plik JSON payloadu.");
    } finally {
      event.target.value = "";
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setLocalError("");

    if (!sourceNode || !destinationNode) {
      setLocalError("Wybierz zrodlo i cel wysylki.");
      return;
    }

    setSending(true);

    try {
      const payload = JSON.parse(payloadText);
      await onDispatch({
        source_node: sourceNode,
        destination_node: destinationNode,
        priority: Number(priority),
        payload,
      });
    } catch (error) {
      setLocalError(error.message || "Nie udalo sie wyslac pakietu.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="stack-lg">
      <div className="grid-two">
        <article className="surface-card">
          <header className="surface-head">
            <h2>Konsola wysylki danych</h2>
            <span className="muted">Manual + szablony + upload JSON payloadu</span>
          </header>

          <form className="stack-md" onSubmit={submit}>
            <div className="filter-grid">
              <label>
                <span>Zrodlo</span>
                <select
                  value={sourceNode}
                  onChange={(event) => setSourceNode(event.target.value)}
                  disabled={loadingNodes || loadingDispatchContext || allowedSources.length === 0}
                >
                  {allowedSources.length === 0 ? <option value="">Brak dozwolonych zrodel</option> : null}
                  {allowedSources.map((nodeId) => (
                    <option key={nodeId} value={nodeId}>
                      {nodeId}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Cel</span>
                <select
                  value={destinationNode}
                  onChange={(event) => setDestinationNode(event.target.value)}
                  disabled={loadingNodes || loadingDispatchContext || destinationOptions.length === 0}
                >
                  {destinationOptions.length === 0 ? <option value="">Brak celow</option> : null}
                  {destinationOptions.map((nodeId) => (
                    <option key={nodeId} value={nodeId}>
                      {nodeId}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Priorytet</span>
                <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                  <option value="1">1 - Critical</option>
                  <option value="2">2 - High</option>
                  <option value="3">3 - Bulk</option>
                </select>
              </label>
            </div>

            <div className="template-row">
              <button type="button" className="btn tiny ghost" onClick={() => useTemplate("healthcheck")}>
                Szablon health-check
              </button>
              <button type="button" className="btn tiny ghost" onClick={() => useTemplate("cancel")}>
                Szablon cancel
              </button>
              <button type="button" className="btn tiny ghost" onClick={() => useTemplate("nav")}>
                Szablon nawigacja
              </button>
            </div>

            <label>
              <span>Payload JSON</span>
              <textarea rows={11} className="mono" value={payloadText} onChange={(event) => setPayloadText(event.target.value)} />
            </label>

            <label>
              <span>Wczytaj payload z pliku JSON</span>
              <input type="file" accept=".json" onChange={handlePayloadFile} />
            </label>

            {localError ? <p className="text-danger">{localError}</p> : null}

            <button type="submit" className="btn" disabled={sending || loadingDispatchContext}>
              {sending ? "Wysylanie..." : "Wyslij pakiet"}
            </button>
          </form>
        </article>

        <article className="surface-card">
          <header className="surface-head">
            <h2>Status operacyjny</h2>
            <span className="muted">Kontekst dispatchu z backendu</span>
          </header>

          <div className="stack-md">
            <div className="grid-summary">
              <div>
                <span className="summary-label">Location</span>
                <strong>{dispatchContext?.service_location || "-"}</strong>
              </div>
              <div>
                <span className="summary-label">Origin scope</span>
                <strong>{dispatchContext?.dispatch_origin_scope || "-"}</strong>
              </div>
              <div>
                <span className="summary-label">Allowed sources</span>
                <strong>{allowedSources.length}</strong>
              </div>
              <div>
                <span className="summary-label">Aktywne pakiety</span>
                <strong>{metrics.active}</strong>
              </div>
            </div>

            <p className="muted">
              Tryb dispatchu backendu ogranicza mozliwe wezly zrodlowe. Formularz powyzej respektuje te same
              zasady co API i nie pozwoli wybrac niedozwolonego source node.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
