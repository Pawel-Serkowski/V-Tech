import { useMemo, useRef, useState } from "react";

const EARTH_RADIUS_KM = 6371;
const MOON_RADIUS_KM = 1737.4;
const EARTH_MU = 398600.4418;
const MOON_MU = 4902.8001;

function emptyEditor() {
  return {
    node_id: "",
    node_type: "satellite",
    body: "",
    orbiting_body: "",
    orbit_altitude_km: "",
    orbital_phase_deg: "0",
    orbital_inclination_deg: "0",
    surface_lat_deg: "",
    surface_lon_deg: "",
    location_label: "",
    links: "",
    link_bandwidth_bps: "1048576",
  };
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeNodeInput(editor) {
  const nodeId = String(editor.node_id || "").trim();
  if (!nodeId) {
    throw new Error("Pole node_id jest wymagane.");
  }

  const node = {
    node_id: nodeId,
    node_type: editor.node_type || "satellite",
    body: editor.body || null,
    orbiting_body: editor.orbiting_body || null,
    orbit_altitude_km: toNumberOrNull(editor.orbit_altitude_km),
    orbital_phase_deg: toNumberOrNull(editor.orbital_phase_deg) ?? 0,
    orbital_inclination_deg: toNumberOrNull(editor.orbital_inclination_deg) ?? 0,
    surface_lat_deg: toNumberOrNull(editor.surface_lat_deg),
    surface_lon_deg: toNumberOrNull(editor.surface_lon_deg),
    location_label: String(editor.location_label || "").trim() || null,
      link_bandwidth_bps: toNumberOrNull(editor.link_bandwidth_bps) ?? 1048576,
    };
  if (node.surface_lat_deg !== null && node.surface_lon_deg === null) {
    throw new Error("surface_lat_deg i surface_lon_deg musza byc podane razem.");
  }

  return node;
}

function toEditor(node) {
  return {
    node_id: node.node_id || "",
    node_type: node.node_type || "satellite",
    body: node.body || "",
    orbiting_body: node.orbiting_body || "",
    orbit_altitude_km: node.orbit_altitude_km ?? "",
    orbital_phase_deg: node.orbital_phase_deg ?? "0",
    orbital_inclination_deg: node.orbital_inclination_deg ?? "0",
    surface_lat_deg: node.surface_lat_deg ?? "",
    surface_lon_deg: node.surface_lon_deg ?? "",
    location_label: node.location_label || "",
      link_bandwidth_bps: node.link_bandwidth_bps ?? "1048576",
    };
  }

function inferOrbitalBody(node) {
  const orbitingBody = String(node?.orbiting_body || "").toLowerCase();
  if (orbitingBody === "earth" || orbitingBody === "moon") {
    return orbitingBody;
  }

  const body = String(node?.body || "").toLowerCase();
  if (body === "earth" || body === "moon") {
    return body;
  }

  const orbitText = String(node?.orbit || "").toLowerCase();
  if (orbitText.includes("moon") || orbitText.includes("lunar") || orbitText.includes("nrho")) {
    return "moon";
  }

  return "earth";
}

function computeOrbitalVelocityKms(node) {
  const altitude = Number(node?.orbit_altitude_km);
  if (!Number.isFinite(altitude)) {
    return null;
  }

  const body = inferOrbitalBody(node);
  const radius = body === "moon" ? MOON_RADIUS_KM + altitude : EARTH_RADIUS_KM + altitude;
  const mu = body === "moon" ? MOON_MU : EARTH_MU;

  return Math.sqrt(mu / Math.max(1, radius));
}

function isOrbitalNode(node) {
  if (!node || node.node_type === "ground_station") {
    return false;
  }

  if (node.surface_lat_deg !== null && node.surface_lat_deg !== undefined) {
    return false;
  }

  if (node.surface_lon_deg !== null && node.surface_lon_deg !== undefined) {
    return false;
  }

  return true;
}

export default function FleetConfigPage({ nodes, loadingNodes, onSaveNodes, onUploadNodesFile }) {
  const [jsonText, setJsonText] = useState(`{
  "nodes": []
}`);
  const [replaceMode, setReplaceMode] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editor, setEditor] = useState(emptyEditor());
  const [editedNodeId, setEditedNodeId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localMessage, setLocalMessage] = useState("");

  const fleetFileInputRef = useRef(null);
  const nodeFileInputRef = useRef(null);

  const sortedNodes = useMemo(() => [...nodes].sort((left, right) => left.node_id.localeCompare(right.node_id)), [nodes]);

  const clearFeedback = () => {
    setLocalError("");
    setLocalMessage("");
  };

  const openCreateModal = () => {
    clearFeedback();
    setEditedNodeId(null);
    setEditor(emptyEditor());
    setModalOpen(true);
  };

  const openEditModal = (node) => {
    clearFeedback();
    setEditedNodeId(node.node_id);
    setEditor(toEditor(node));
    setModalOpen(true);
  };

  const saveEditorNode = async () => {
    clearFeedback();
    setSaving(true);

    try {
      const sanitizedNode = sanitizeNodeInput(editor);
      const withoutEdited = sortedNodes.filter((node) => node.node_id !== editedNodeId);
      const mergedNodes = [...withoutEdited, sanitizedNode].sort((left, right) => left.node_id.localeCompare(right.node_id));

      await onSaveNodes(mergedNodes, { replace: true });
      setLocalMessage(`Zapisano node ${sanitizedNode.node_id}.`);
      setModalOpen(false);
      setEditedNodeId(null);
      setEditor(emptyEditor());
    } catch (error) {
      setLocalError(error.message || "Nie udalo sie zapisac konfiguracji node.");
    } finally {
      setSaving(false);
    }
  };

  const downloadFleetJson = () => {
    const payload = JSON.stringify({ nodes: sortedNodes }, null, 2);
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "selenet-fleet.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const uploadFleetFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    clearFeedback();
    setSaving(true);

    try {
      await onUploadNodesFile(file, { replace: replaceMode });
      setLocalMessage("Wgrano plik konfiguracji floty.");
    } catch (error) {
      setLocalError(error.message || "Nie udalo sie wgrac pliku floty.");
    } finally {
      setSaving(false);
      event.target.value = "";
    }
  };

  const applyJsonFromEditor = async () => {
    clearFeedback();
    setSaving(true);

    try {
      const parsed = JSON.parse(jsonText);
      const parsedNodes = Array.isArray(parsed) ? parsed : parsed.nodes;
      if (!Array.isArray(parsedNodes) || parsedNodes.length === 0) {
        throw new Error("JSON musi zawierac tablice nodes.");
      }

      await onSaveNodes(parsedNodes, { replace: replaceMode });
      setLocalMessage("Konfiguracja JSON zostala zastosowana.");
    } catch (error) {
      setLocalError(error.message || "Nie udalo sie zastosowac JSON.");
    } finally {
      setSaving(false);
    }
  };

  const importNodeToModal = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const node = Array.isArray(parsed?.nodes) ? parsed.nodes[0] : parsed;
      if (!node || typeof node !== "object") {
        throw new Error("Plik nie zawiera poprawnego obiektu node.");
      }

      setEditor(toEditor(node));
      setLocalMessage("Wczytano node do modala.");
    } catch (error) {
      setLocalError(error.message || "Nie udalo sie wczytac node z pliku.");
    } finally {
      event.target.value = "";
    }
  };

  const applyDiverseOrbitalConfig = async () => {
    clearFeedback();
    setSaving(true);

    try {
      const altitudeBands = {
        earth: [450, 700, 980, 1400, 2100, 3200],
        moon: [90, 130, 180, 260, 420, 800],
      };
      const counters = { earth: 0, moon: 0 };

      const orbitalCandidates = sortedNodes.filter((node) => isOrbitalNode(node));
      if (orbitalCandidates.length === 0) {
        throw new Error("Brak satelit/relay do konfiguracji orbitalnej.");
      }

      const configuredNodes = sortedNodes.map((node) => {
        if (!isOrbitalNode(node)) {
          return node;
        }

        const body = inferOrbitalBody(node);
        const index = counters[body];
        counters[body] += 1;

        const band = altitudeBands[body];
        const baseAltitude = band[index % band.length];
        const layerBoost = Math.floor(index / band.length) * (body === "moon" ? 140 : 240);
        const orbitAltitude = baseAltitude + layerBoost;
        const orbitalPhase = (index * 41 + (body === "moon" ? 17 : 0)) % 360;
        const orbitalInclination = (body === "moon" ? 22 : 18) + ((index * 13) % 58);

        return {
          ...node,
          body: node.body || body,
          orbiting_body: body,
          orbit_altitude_km: orbitAltitude,
          orbital_phase_deg: orbitalPhase,
          orbital_inclination_deg: orbitalInclination,
          position_x_km: null,
          position_y_km: null,
          position_z_km: null,
        };
      });

      await onSaveNodes(configuredNodes, { replace: true });
      setLocalMessage("Ustawiono zroznicowane orbity satelit (wysokosc + predkosc wynikowa).");
    } catch (error) {
      setLocalError(error.message || "Nie udalo sie ustawic konfiguracji orbitalnej.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack-lg">
      <article className="surface-card">
        <header className="surface-head">
          <h2>Konfiguracja satelit i floty</h2>
          <p className="muted">Pobranie/wgranie JSON dla calej floty oraz modal do edycji pojedynczego satelity.</p>
        </header>

        <div className="action-row wrap">
          <button className="btn ghost" type="button" onClick={downloadFleetJson}>
            Pobierz JSON floty
          </button>
          <button className="btn ghost" type="button" onClick={() => fleetFileInputRef.current?.click()}>
            Wgraj plik JSON floty
          </button>
          <button className="btn" type="button" onClick={openCreateModal}>
            Dodaj satelite
          </button>
          <button className="btn ghost" type="button" disabled={saving} onClick={applyDiverseOrbitalConfig}>
            Ustaw rozne orbity satelit
          </button>
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={replaceMode}
              onChange={(event) => setReplaceMode(event.target.checked)}
            />
            <span>Pelna podmiana konfiguracji (replace)</span>
          </label>
          <input
            ref={fleetFileInputRef}
            hidden
            type="file"
            accept=".json,.yaml,.yml"
            onChange={uploadFleetFile}
          />
        </div>

        <label className="stack-xs">
          <span>Edytor JSON floty</span>
          <textarea
            rows={10}
            className="mono"
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
          />
        </label>

        <button className="btn" type="button" disabled={saving} onClick={applyJsonFromEditor}>
          Zastosuj JSON
        </button>

        {localMessage ? <p className="text-success">{localMessage}</p> : null}
        {localError ? <p className="text-danger">{localError}</p> : null}
      </article>

      <article className="surface-card">
        <header className="surface-head">
          <h2>Aktualna flota</h2>
          <strong>{sortedNodes.length}</strong>
        </header>

        {loadingNodes ? (
          <p className="muted">Wczytywanie wezlow...</p>
        ) : sortedNodes.length === 0 ? (
          <p className="muted">Brak wezlow. Wgraj konfiguracje JSON.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Typ</th>
                  <th>Body/Orbit</th>
                  <th>Alt [km]</th>
                  <th>V orb [km/s]</th>
                  <th>Links</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedNodes.map((node) => {
                  const speed = computeOrbitalVelocityKms(node);

                  return (
                    <tr key={node.node_id}>
                      <td className="mono">{node.node_id}</td>
                      <td>{node.node_type}</td>
                      <td>{node.location_label || node.orbit || node.body || node.orbiting_body || "-"}</td>
                      <td>{Number.isFinite(Number(node.orbit_altitude_km)) ? Number(node.orbit_altitude_km).toFixed(0) : "-"}</td>
                      <td>{typeof speed === "number" ? speed.toFixed(2) : "-"}</td>
                      <td>{Array.isArray(node.links) ? node.links.join(", ") : "-"}</td>
                      <td>
                        <button className="btn tiny ghost" type="button" onClick={() => openEditModal(node)}>
                          Edytuj
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {modalOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edycja satelity">
          <div className="modal-card stack-md">
            <header className="surface-head">
              <h3>{editedNodeId ? `Edycja ${editedNodeId}` : "Nowa satelita"}</h3>
              <button className="btn tiny ghost" type="button" onClick={() => setModalOpen(false)}>
                Zamknij
              </button>
            </header>

            <div className="filter-grid two-col">
              <label>
                <span>node_id</span>
                <input
                  value={editor.node_id}
                  onChange={(event) => setEditor((current) => ({ ...current, node_id: event.target.value }))}
                />
              </label>

              <label>
                <span>node_type</span>
                <select
                  value={editor.node_type}
                  onChange={(event) => setEditor((current) => ({ ...current, node_type: event.target.value }))}
                >
                  <option value="satellite">satellite</option>
                  <option value="relay">relay</option>
                  <option value="ground_station">ground_station</option>
                </select>
              </label>

              <label>
                <span>body</span>
                <select
                  value={editor.body}
                  onChange={(event) => setEditor((current) => ({ ...current, body: event.target.value }))}
                >
                  <option value="">(brak)</option>
                  <option value="earth">earth</option>
                  <option value="moon">moon</option>
                  <option value="deep_space">deep_space</option>
                </select>
              </label>

              <label>
                <span>orbiting_body</span>
                <select
                  value={editor.orbiting_body}
                  onChange={(event) => setEditor((current) => ({ ...current, orbiting_body: event.target.value }))}
                >
                  <option value="">(brak)</option>
                  <option value="earth">earth</option>
                  <option value="moon">moon</option>
                </select>
              </label>

              <label>
                <span>orbit_altitude_km</span>
                <input
                  value={editor.orbit_altitude_km}
                  onChange={(event) => setEditor((current) => ({ ...current, orbit_altitude_km: event.target.value }))}
                />
              </label>

              <label>
                <span>location_label</span>
                <input
                  value={editor.location_label}
                  onChange={(event) => setEditor((current) => ({ ...current, location_label: event.target.value }))}
                />
              </label>

              <label>
                <span>orbital_phase_deg</span>
                <input
                  value={editor.orbital_phase_deg}
                  onChange={(event) => setEditor((current) => ({ ...current, orbital_phase_deg: event.target.value }))}
                />
              </label>

              <label>
                <span>orbital_inclination_deg</span>
                <input
                  value={editor.orbital_inclination_deg}
                  onChange={(event) =>
                    setEditor((current) => ({ ...current, orbital_inclination_deg: event.target.value }))
                  }
                />
              </label>

              <label>
                <span>surface_lat_deg</span>
                <input
                  value={editor.surface_lat_deg}
                  onChange={(event) => setEditor((current) => ({ ...current, surface_lat_deg: event.target.value }))}
                />
              </label>

              <label>
                <span>surface_lon_deg</span>
                <input
                  value={editor.surface_lon_deg}
                  onChange={(event) => setEditor((current) => ({ ...current, surface_lon_deg: event.target.value }))}
                />
              </label>
            </div>

            <label>
              <span>link_bandwidth_bps</span>
              <input
                type="number"
                value={editor.link_bandwidth_bps}
                onChange={(event) => setEditor((current) => ({ ...current, link_bandwidth_bps: event.target.value }))}
              />
            </label>

            <label>
              <span>links (comma separated)</span>
              <input
                value={editor.links}
                onChange={(event) => setEditor((current) => ({ ...current, links: event.target.value }))}
              />
            </label>

            <div className="action-row wrap">
              <button className="btn" type="button" disabled={saving} onClick={saveEditorNode}>
                {saving ? "Zapisywanie..." : "Zapisz satelite"}
              </button>
              <button className="btn ghost" type="button" onClick={() => nodeFileInputRef.current?.click()}>
                Wgraj satelite z JSON
              </button>
              <input ref={nodeFileInputRef} hidden type="file" accept=".json" onChange={importNodeToModal} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
