import { useMemo, useState } from "react";

import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CForm,
  CInputGroup,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormTextarea,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from "@coreui/react";

const NODE_TYPES = [
  { label: "Stacja naziemna", value: "ground_station" },
  { label: "Satelita", value: "satellite" },
  { label: "Relay", value: "relay" },
];

const IMPORT_TEMPLATE = `{
  "nodes": [
    {
      "node_id": "RELAY_01",
      "node_type": "relay",
      "orbit": "Lunar Corridor",
      "location_label": "Lagrange Corridor L1",
      "time_offset_seconds": 0,
      "links": ["SAT_A"],
      "contact_windows": [
        { "start": "2026-04-10T07:50:00Z", "end": "2026-04-10T08:20:00Z" },
        { "start": "2026-04-10T12:00:00Z", "end": "2026-04-10T12:30:00Z" }
      ]
    }
  ]
}`;

function createEmptyWindowRow() {
  return { start: "", end: "" };
}

function createEmptyEditor() {
  return {
    node_id: "",
    node_type: "satellite",
    orbit: "",
    location_label: "",
    time_offset_seconds: "0",
    links: [],
    new_link: "",
    windows: [createEmptyWindowRow()],
  };
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  values.forEach((item) => {
    if (typeof item !== "string") {
      return;
    }

    const cleaned = item.trim();
    if (!cleaned || seen.has(cleaned)) {
      return;
    }

    seen.add(cleaned);
    result.push(cleaned);
  });

  return result;
}

function isoToLocalDateTimeInput(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoDate(value, errorPrefix) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${errorPrefix}: uzupelnij date i godzine.`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${errorPrefix}: data ma niepoprawny format.`);
  }

  return parsed.toISOString();
}

function parseNodeType(value) {
  if (value === "ground_station" || value === "satellite" || value === "relay") {
    return value;
  }
  return "satellite";
}

function importedWindowToIso(windowRow, windowIndex, nodeId) {
  const startValue = typeof windowRow?.start === "string" ? windowRow.start : "";
  const endValue = typeof windowRow?.end === "string" ? windowRow.end : "";
  const startIso = toIsoDate(startValue, `Okno ${windowIndex + 1} w obiekcie ${nodeId}`);
  const endIso = toIsoDate(endValue, `Okno ${windowIndex + 1} w obiekcie ${nodeId}`);

  if (new Date(startIso).getTime() >= new Date(endIso).getTime()) {
    throw new Error(`Okno ${windowIndex + 1} w obiekcie ${nodeId}: koniec musi byc pozniej niz start.`);
  }

  return { start: startIso, end: endIso };
}

function normalizeImportedNode(rawNode, index) {
  if (!rawNode || typeof rawNode !== "object") {
    throw new Error(`Pozycja ${index + 1} w JSON musi byc obiektem.`);
  }

  const nodeId = typeof rawNode.node_id === "string" ? rawNode.node_id.trim() : "";
  if (!nodeId) {
    throw new Error(`Pozycja ${index + 1} nie ma pola node_id.`);
  }

  const timeOffsetRaw = Number(rawNode.time_offset_seconds);
  if (!Number.isFinite(timeOffsetRaw)) {
    throw new Error(`Obiekt ${nodeId}: pole time_offset_seconds musi byc liczba.`);
  }

  const windowsRaw = Array.isArray(rawNode.contact_windows) ? rawNode.contact_windows : [];
  const windows = windowsRaw.map((windowRow, windowIndex) => importedWindowToIso(windowRow, windowIndex, nodeId));

  return {
    node_id: nodeId,
    node_type: parseNodeType(rawNode.node_type),
    orbit: typeof rawNode.orbit === "string" && rawNode.orbit.trim() ? rawNode.orbit.trim() : null,
    location_label:
      typeof rawNode.location_label === "string" && rawNode.location_label.trim()
        ? rawNode.location_label.trim()
        : null,
    time_offset_seconds: Math.trunc(timeOffsetRaw),
    links: uniqueStrings(Array.isArray(rawNode.links) ? rawNode.links : []),
    contact_windows: windows,
  };
}

function normalizeImportedNodes(rawText) {
  let parsed;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("JSON ma niepoprawna skladnie.");
  }

  const rows = Array.isArray(parsed) ? parsed : parsed?.nodes;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("JSON musi zawierac niepusta tablice nodes.");
  }

  return rows.map((row, index) => normalizeImportedNode(row, index));
}

function mergeByNodeId(currentNodes, incomingNodes) {
  const nodeMap = new Map(currentNodes.map((node) => [node.node_id, node]));
  incomingNodes.forEach((node) => {
    nodeMap.set(node.node_id, node);
  });

  return [...nodeMap.values()].sort((a, b) => a.node_id.localeCompare(b.node_id));
}

export default function ObjectsPage({ nodes, loadingNodes, onSaveNodes, onRefreshNodes }) {
  const [editor, setEditor] = useState(createEmptyEditor());
  const [editorSource, setEditorSource] = useState({ type: "new", originalId: null });
  const [editorVisible, setEditorVisible] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [jsonText, setJsonText] = useState(IMPORT_TEMPLATE);
  const [draftNodes, setDraftNodes] = useState([]);
  const [localMessage, setLocalMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingSingle, setSavingSingle] = useState(false);

  const backendNodes = useMemo(
    () => [...nodes].sort((left, right) => left.node_id.localeCompare(right.node_id)),
    [nodes]
  );

  const knownNodeIds = useMemo(() => {
    const fromBackend = backendNodes.map((node) => node.node_id);
    const fromDraft = draftNodes.map((node) => node.node_id);
    const fromEditor = editor.node_id ? [editor.node_id] : [];
    return uniqueStrings([...fromBackend, ...fromDraft, ...fromEditor]).sort((a, b) => a.localeCompare(b));
  }, [backendNodes, draftNodes, editor.node_id]);

  const linkCandidates = useMemo(() => {
    return knownNodeIds.filter((nodeId) => nodeId !== editor.node_id);
  }, [knownNodeIds, editor.node_id]);

  const visibleLinkCandidates = useMemo(() => {
    const query = linkSearch.trim().toLowerCase();
    if (!query) {
      return linkCandidates;
    }
    return linkCandidates.filter((nodeId) => nodeId.toLowerCase().includes(query));
  }, [linkCandidates, linkSearch]);

  const isEditingBackend = editorSource.type === "backend";
  const isEditingDraft = editorSource.type === "draft";

  const clearFeedback = () => {
    setLocalError("");
    setLocalMessage("");
  };

  const resetEditor = () => {
    setEditor(createEmptyEditor());
    setEditorSource({ type: "new", originalId: null });
    setLinkSearch("");
  };

  const closeEditorModal = () => {
    if (savingSingle) {
      return;
    }
    setEditorVisible(false);
    resetEditor();
  };

  const openCreateModal = () => {
    clearFeedback();
    resetEditor();
    setEditorVisible(true);
  };

  const updateEditorField = (field, value) => {
    setEditor((current) => ({ ...current, [field]: value }));
  };

  const addLinkFromInput = () => {
    const candidate = editor.new_link.trim();
    clearFeedback();

    if (!candidate) {
      return;
    }

    if (candidate === editor.node_id.trim()) {
      setLocalError("Obiekt nie moze byc polaczony sam ze soba.");
      return;
    }

    setEditor((current) => ({
      ...current,
      links: uniqueStrings([...current.links, candidate]),
      new_link: "",
    }));
  };

  const removeLink = (linkToRemove) => {
    setEditor((current) => ({
      ...current,
      links: current.links.filter((link) => link !== linkToRemove),
    }));
  };

  const toggleLink = (nodeId) => {
    setEditor((current) => {
      const exists = current.links.includes(nodeId);
      const nextLinks = exists
        ? current.links.filter((item) => item !== nodeId)
        : [...current.links, nodeId];

      return {
        ...current,
        links: uniqueStrings(nextLinks),
      };
    });
  };

  const addWindowRow = () => {
    setEditor((current) => ({
      ...current,
      windows: [...current.windows, createEmptyWindowRow()],
    }));
  };

  const updateWindowRow = (indexToUpdate, field, value) => {
    setEditor((current) => ({
      ...current,
      windows: current.windows.map((windowRow, index) => {
        if (index !== indexToUpdate) {
          return windowRow;
        }
        return { ...windowRow, [field]: value };
      }),
    }));
  };

  const removeWindowRow = (indexToRemove) => {
    setEditor((current) => {
      const nextRows = current.windows.filter((_, index) => index !== indexToRemove);
      return {
        ...current,
        windows: nextRows.length > 0 ? nextRows : [createEmptyWindowRow()],
      };
    });
  };

  const buildNodeFromEditor = () => {
    const nodeId = editor.node_id.trim();
    if (!nodeId) {
      throw new Error("Podaj nazwe obiektu (ID). Na przyklad SAT_A.");
    }

    const offsetRaw = Number(editor.time_offset_seconds);
    if (!Number.isFinite(offsetRaw)) {
      throw new Error("Pole Przesuniecie czasu musi byc liczba.");
    }

    const links = uniqueStrings(editor.links).filter((item) => item !== nodeId);
    const windows = [];

    editor.windows.forEach((windowRow, index) => {
      const rowNumber = index + 1;
      const startFilled = Boolean(windowRow.start?.trim());
      const endFilled = Boolean(windowRow.end?.trim());

      if (!startFilled && !endFilled) {
        return;
      }

      if (!startFilled || !endFilled) {
        throw new Error(`Okno ${rowNumber}: uzupelnij start i koniec.`);
      }

      const startIso = toIsoDate(windowRow.start, `Okno ${rowNumber}`);
      const endIso = toIsoDate(windowRow.end, `Okno ${rowNumber}`);
      if (new Date(startIso).getTime() >= new Date(endIso).getTime()) {
        throw new Error(`Okno ${rowNumber}: koniec musi byc pozniej niz start.`);
      }

      windows.push({ start: startIso, end: endIso });
    });

    return {
      node_id: nodeId,
      node_type: parseNodeType(editor.node_type),
      orbit: editor.orbit.trim() ? editor.orbit.trim() : null,
      location_label: editor.location_label.trim() ? editor.location_label.trim() : null,
      time_offset_seconds: Math.trunc(offsetRaw),
      links,
      contact_windows: windows,
    };
  };

  const loadNodeToEditor = (node, sourceType) => {
    const loadedWindows = Array.isArray(node.contact_windows)
      ? node.contact_windows.map((windowRow) => ({
          start: isoToLocalDateTimeInput(windowRow?.start),
          end: isoToLocalDateTimeInput(windowRow?.end),
        }))
      : [];

    setEditor({
      node_id: node.node_id || "",
      node_type: parseNodeType(node.node_type),
      orbit: typeof node.orbit === "string" ? node.orbit : "",
      location_label: typeof node.location_label === "string" ? node.location_label : "",
      time_offset_seconds: String(Number.isFinite(Number(node.time_offset_seconds)) ? node.time_offset_seconds : 0),
      links: uniqueStrings(Array.isArray(node.links) ? node.links : []),
      new_link: "",
      windows: loadedWindows.length > 0 ? loadedWindows : [createEmptyWindowRow()],
    });

    setEditorSource({ type: sourceType, originalId: node.node_id || null });
    clearFeedback();
    setLinkSearch("");
    setEditorVisible(true);
  };

  const addEditorNodeToDraft = (event) => {
    event.preventDefault();
    clearFeedback();

    try {
      const node = buildNodeFromEditor();

      setDraftNodes((current) => {
        const baseRows =
          isEditingDraft && editorSource.originalId && editorSource.originalId !== node.node_id
            ? current.filter((item) => item.node_id !== editorSource.originalId)
            : current;

        return mergeByNodeId(baseRows, [node]);
      });

      setLocalMessage(`Obiekt ${node.node_id} jest w szkicu.`);
      setEditorVisible(false);
      resetEditor();
    } catch (error) {
      setLocalError(error.message);
    }
  };

  const saveEditorNodeToBackend = async () => {
    clearFeedback();

    try {
      const node = buildNodeFromEditor();
      setSavingSingle(true);
      const result = await onSaveNodes([node]);
      await onRefreshNodes();
      setLocalMessage(
        `Zapisano obiekt ${node.node_id}. Dodane: ${result.inserted}, zaktualizowane: ${result.updated}.`
      );
      setEditorVisible(false);
      resetEditor();
    } catch (error) {
      setLocalError(error.message);
    } finally {
      setSavingSingle(false);
    }
  };

  const importJsonToDraft = () => {
    clearFeedback();

    try {
      const importedNodes = normalizeImportedNodes(jsonText);
      setDraftNodes((current) => mergeByNodeId(current, importedNodes));
      setLocalMessage(`Dodano do szkicu: ${importedNodes.length} obiekt(ow).`);
    } catch (error) {
      setLocalError(error.message);
    }
  };

  const importJsonFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    clearFeedback();

    try {
      const content = await file.text();
      setJsonText(content);
      const importedNodes = normalizeImportedNodes(content);
      setDraftNodes((current) => mergeByNodeId(current, importedNodes));
      setLocalMessage(`Wczytano ${importedNodes.length} obiekt(ow) z pliku ${file.name}.`);
    } catch (error) {
      setLocalError(error.message);
    } finally {
      event.target.value = "";
    }
  };

  const removeDraftNode = (nodeId) => {
    setDraftNodes((current) => current.filter((node) => node.node_id !== nodeId));
  };

  const clearDraft = () => {
    setDraftNodes([]);
    setLocalMessage("Szkic zostal wyczyszczony.");
    setLocalError("");
  };

  const saveDraft = async () => {
    if (draftNodes.length === 0) {
      setLocalError("Szkic jest pusty. Dodaj przynajmniej jeden obiekt.");
      setLocalMessage("");
      return;
    }

    setSavingDraft(true);
    clearFeedback();

    try {
      const result = await onSaveNodes(draftNodes, { replace: true });
      setDraftNodes([]);
      await onRefreshNodes();
      const deleted = Number.isFinite(result.deleted) ? result.deleted : 0;
      setLocalMessage(
        `Szkic zastapil konfiguracje. Dodane: ${result.inserted}, zaktualizowane: ${result.updated}, usuniete: ${deleted}.`
      );
    } catch (error) {
      setLocalError(error.message);
    } finally {
      setSavingDraft(false);
    }
  };

  const editorModeLabel = isEditingBackend
    ? `Edycja obiektu z backendu: ${editorSource.originalId}`
    : isEditingDraft
      ? `Edycja obiektu ze szkicu: ${editorSource.originalId}`
      : "Nowy obiekt";

  const editorTitle = isEditingBackend
    ? `Edytuj obiekt ${editorSource.originalId}`
    : isEditingDraft
      ? `Edytuj szkic ${editorSource.originalId}`
      : "Dodaj nowy obiekt";

  const selectedLinksCount = editor.links.length;

  return (
    <>
      <CRow className="g-4 mb-2">
        <CCol xs={12}>
          <CCard className="surface-card">
            <CCardHeader className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
              <h2 className="h6 mb-0">Panel konfiguracji obiektow</h2>
              <div className="d-flex align-items-center gap-2">
                {loadingNodes && <CSpinner size="sm" />}
                <CButton color="primary" onClick={openCreateModal}>
                  Dodaj obiekt
                </CButton>
                <CButton color="secondary" variant="outline" onClick={onRefreshNodes}>
                  Odswiez
                </CButton>
              </div>
            </CCardHeader>
            <CCardBody>
              <p className="mb-2 text-body-secondary">Dodawanie i edycja sa teraz w jednym czytelnym modalu.</p>
              <p className="mb-0 text-body-secondary">
                Satelita moze miec wiele polaczen. Nie ma limitu do jednej jednostki.
              </p>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>

      {(localMessage || localError) && (
        <CRow className="g-3 mb-2">
          <CCol xs={12}>
            {localMessage && <CAlert color="success" className="mb-2">{localMessage}</CAlert>}
            {localError && <CAlert color="danger" className="mb-0">{localError}</CAlert>}
          </CCol>
        </CRow>
      )}

      <CRow className="g-4">
        <CCol xl={7}>
          <CCard className="surface-card">
            <CCardHeader className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
              <h2 className="h6 mb-0">Obiekty zapisane w systemie</h2>
              <CBadge color="primary">{backendNodes.length}</CBadge>
            </CCardHeader>
            <CCardBody>
              {!loadingNodes && backendNodes.length === 0 && (
                <p className="mb-0 text-body-secondary">Brak zapisanych obiektow.</p>
              )}

              {backendNodes.length > 0 && (
                <div className="table-responsive">
                  <CTable hover align="middle" className="mb-0 object-table-small">
                    <CTableHead>
                      <CTableRow>
                        <CTableHeaderCell scope="col">Obiekt</CTableHeaderCell>
                        <CTableHeaderCell scope="col">Typ</CTableHeaderCell>
                        <CTableHeaderCell scope="col">Polaczenia</CTableHeaderCell>
                        <CTableHeaderCell scope="col">Okna</CTableHeaderCell>
                        <CTableHeaderCell scope="col" />
                      </CTableRow>
                    </CTableHead>
                    <CTableBody>
                      {backendNodes.map((node) => (
                        <CTableRow key={node.node_id}>
                          <CTableDataCell className="mono">{node.node_id}</CTableDataCell>
                          <CTableDataCell>{node.node_type}</CTableDataCell>
                          <CTableDataCell className="mono">
                            {Array.isArray(node.links) && node.links.length > 0 ? node.links.join(", ") : "brak"}
                          </CTableDataCell>
                          <CTableDataCell className="mono">
                            {Array.isArray(node.contact_windows) ? node.contact_windows.length : 0}
                          </CTableDataCell>
                          <CTableDataCell className="text-end">
                            <CButton
                              color="primary"
                              size="sm"
                              variant="ghost"
                              className="me-2"
                              onClick={() => loadNodeToEditor(node, "backend")}
                            >
                              Edytuj
                            </CButton>
                            <CButton
                              color="secondary"
                              size="sm"
                              variant="ghost"
                              onClick={() => setDraftNodes((current) => mergeByNodeId(current, [node]))}
                            >
                              Do szkicu
                            </CButton>
                          </CTableDataCell>
                        </CTableRow>
                      ))}
                    </CTableBody>
                  </CTable>
                </div>
              )}
            </CCardBody>
          </CCard>
        </CCol>

        <CCol xl={5}>
          <CCard className="surface-card mb-4">
            <CCardHeader className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
              <h2 className="h6 mb-0">Szkic obiektow</h2>
              <CBadge color="warning">{draftNodes.length}</CBadge>
            </CCardHeader>
            <CCardBody>
              {draftNodes.length === 0 ? (
                <p className="mb-0 text-body-secondary">Szkic jest pusty. Dodaj obiekty przyciskiem Dodaj obiekt.</p>
              ) : (
                <>
                  <div className="table-responsive mb-3">
                    <CTable hover align="middle" className="mb-0 object-table-small">
                      <CTableHead>
                        <CTableRow>
                          <CTableHeaderCell scope="col">Obiekt</CTableHeaderCell>
                          <CTableHeaderCell scope="col">Typ</CTableHeaderCell>
                          <CTableHeaderCell scope="col">Polaczenia</CTableHeaderCell>
                          <CTableHeaderCell scope="col">Okna</CTableHeaderCell>
                          <CTableHeaderCell scope="col" />
                        </CTableRow>
                      </CTableHead>
                      <CTableBody>
                        {draftNodes.map((node) => (
                          <CTableRow key={node.node_id}>
                            <CTableDataCell className="mono">{node.node_id}</CTableDataCell>
                            <CTableDataCell>{node.node_type}</CTableDataCell>
                            <CTableDataCell className="mono">
                              {node.links.length > 0 ? node.links.join(", ") : "brak"}
                            </CTableDataCell>
                            <CTableDataCell className="mono">{node.contact_windows.length || 0}</CTableDataCell>
                            <CTableDataCell className="text-end">
                              <CButton
                                color="info"
                                size="sm"
                                variant="ghost"
                                className="me-2"
                                onClick={() => loadNodeToEditor(node, "draft")}
                              >
                                Edytuj
                              </CButton>
                              <CButton
                                color="danger"
                                size="sm"
                                variant="ghost"
                                onClick={() => removeDraftNode(node.node_id)}
                              >
                                Usun
                              </CButton>
                            </CTableDataCell>
                          </CTableRow>
                        ))}
                      </CTableBody>
                    </CTable>
                  </div>

                  <div className="d-flex flex-wrap gap-2">
                    <CButton color="success" onClick={saveDraft} disabled={savingDraft}>
                      {savingDraft ? "Zapisywanie..." : "Zapisz i zastap konfiguracje"}
                    </CButton>
                    <CButton color="secondary" variant="outline" onClick={clearDraft} disabled={savingDraft}>
                      Wyczysc szkic
                    </CButton>
                  </div>
                </>
              )}
            </CCardBody>
          </CCard>

          <CCard className="surface-card">
            <CCardHeader>
              <h2 className="h6 mb-0">Import JSON (opcjonalnie)</h2>
            </CCardHeader>
            <CCardBody className="d-flex flex-column gap-3">
              <div>
                <CFormLabel htmlFor="json-import">Wklej JSON (tablica albo obiekt z polem nodes)</CFormLabel>
                <CFormTextarea
                  id="json-import"
                  rows={10}
                  className="mono"
                  value={jsonText}
                  onChange={(event) => setJsonText(event.target.value)}
                />
              </div>

              <div className="d-flex flex-wrap gap-2">
                <CButton color="info" variant="outline" onClick={importJsonToDraft}>
                  Wczytaj do szkicu
                </CButton>
                <CFormInput type="file" accept=".json" onChange={importJsonFile} />
              </div>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>

      <CModal visible={editorVisible} onClose={closeEditorModal} size="xl" alignment="center" scrollable>
        <CModalHeader>
          <CModalTitle>{editorTitle}</CModalTitle>
        </CModalHeader>
        <CModalBody>
          <CForm onSubmit={addEditorNodeToDraft}>
            <CRow className="g-3">
              <CCol md={6}>
                <CFormLabel htmlFor="modal-node-id">Nazwa obiektu (ID)</CFormLabel>
                <CFormInput
                  id="modal-node-id"
                  value={editor.node_id}
                  onChange={(event) => updateEditorField("node_id", event.target.value)}
                  placeholder="Na przyklad SAT_A"
                  disabled={isEditingBackend}
                />
                {isEditingBackend && (
                  <small className="text-body-secondary">
                    Podczas edycji zapisanego obiektu ID jest zablokowane, zeby nie tworzyc duplikatow.
                  </small>
                )}
              </CCol>
              <CCol md={6}>
                <CFormLabel htmlFor="modal-node-type">Typ obiektu</CFormLabel>
                <CFormSelect
                  id="modal-node-type"
                  value={editor.node_type}
                  onChange={(event) => updateEditorField("node_type", event.target.value)}
                  options={NODE_TYPES}
                />
              </CCol>
              <CCol md={6}>
                <CFormLabel htmlFor="modal-orbit">Orbita (opcjonalnie)</CFormLabel>
                <CFormInput
                  id="modal-orbit"
                  value={editor.orbit}
                  onChange={(event) => updateEditorField("orbit", event.target.value)}
                  placeholder="Na przyklad NRHO"
                />
              </CCol>
              <CCol md={6}>
                <CFormLabel htmlFor="modal-location-label">Lokalizacja (opcjonalnie)</CFormLabel>
                <CFormInput
                  id="modal-location-label"
                  value={editor.location_label}
                  onChange={(event) => updateEditorField("location_label", event.target.value)}
                  placeholder="Na przyklad Lunar Gateway Hub"
                />
              </CCol>
              <CCol md={6}>
                <CFormLabel htmlFor="modal-offset">Przesuniecie czasu (sekundy)</CFormLabel>
                <CFormInput
                  id="modal-offset"
                  type="number"
                  value={editor.time_offset_seconds}
                  onChange={(event) => updateEditorField("time_offset_seconds", event.target.value)}
                />
              </CCol>

              <CCol xs={12}>
                <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
                  <CFormLabel className="mb-0">Polaczenia do innych obiektow</CFormLabel>
                  <CBadge color="info">Wybrane: {selectedLinksCount}</CBadge>
                </div>

                <small className="text-body-secondary d-block mb-2">
                  Kliknij obiekty ponizej. Mozesz wybrac dowolna liczbe polaczen, bez limitu.
                </small>

                <CInputGroup className="mb-2">
                  <CFormInput
                    value={linkSearch}
                    onChange={(event) => setLinkSearch(event.target.value)}
                    placeholder="Szukaj obiektu po ID"
                  />
                  <CButton type="button" color="secondary" variant="outline" onClick={() => setLinkSearch("")}>
                    Wyczyść
                  </CButton>
                </CInputGroup>

                <div className="link-choice-grid mb-2">
                  {visibleLinkCandidates.map((nodeId) => {
                    const selected = editor.links.includes(nodeId);
                    return (
                      <button
                        key={nodeId}
                        type="button"
                        className={`link-choice-btn ${selected ? "selected" : ""}`}
                        onClick={() => toggleLink(nodeId)}
                      >
                        <span className="mono">{nodeId}</span>
                      </button>
                    );
                  })}
                </div>

                {visibleLinkCandidates.length === 0 && (
                  <small className="text-body-secondary d-block mb-2">Brak wynikow wyszukiwania.</small>
                )}

                <div className="d-flex flex-wrap gap-2 mb-2">
                  <CFormInput
                    value={editor.new_link}
                    onChange={(event) => updateEditorField("new_link", event.target.value)}
                    placeholder="Dopisz recznie nowe polaczenie"
                  />
                  <CButton color="secondary" type="button" variant="outline" onClick={addLinkFromInput}>
                    Dodaj recznie
                  </CButton>
                </div>

                <div className="d-flex flex-wrap gap-2">
                  {editor.links.length === 0 && <small className="text-body-secondary">Brak polaczen.</small>}
                  {editor.links.map((link) => (
                    <span className="object-link-pill" key={link}>
                      <span className="mono">{link}</span>
                      <button
                        className="object-link-pill-remove"
                        type="button"
                        onClick={() => removeLink(link)}
                        aria-label={`Usun polaczenie ${link}`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              </CCol>
            </CRow>

            <div className="border-top pt-3 mt-4">
              <h3 className="h6 mb-2">Okna kontaktu</h3>
              <small className="text-body-secondary d-block mb-3">
                Wprowadz date i godzine lokalna. System zapisze to automatycznie w UTC.
              </small>

              <div className="d-flex flex-column gap-3">
                {editor.windows.map((windowRow, index) => (
                  <div className="window-row" key={`window-row-${index}`}>
                    <CFormInput
                      type="datetime-local"
                      value={windowRow.start}
                      onChange={(event) => updateWindowRow(index, "start", event.target.value)}
                    />
                    <CFormInput
                      type="datetime-local"
                      value={windowRow.end}
                      onChange={(event) => updateWindowRow(index, "end", event.target.value)}
                    />
                    <CButton color="danger" variant="outline" type="button" onClick={() => removeWindowRow(index)}>
                      Usun
                    </CButton>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <CButton color="secondary" variant="outline" type="button" onClick={addWindowRow}>
                  Dodaj kolejne okno
                </CButton>
              </div>
            </div>
          </CForm>
        </CModalBody>
        <CModalFooter className="d-flex justify-content-between flex-wrap gap-2">
          <CBadge color={isEditingBackend || isEditingDraft ? "warning" : "info"}>{editorModeLabel}</CBadge>
          <div className="d-flex gap-2 flex-wrap">
            <CButton color="secondary" variant="outline" onClick={closeEditorModal} disabled={savingSingle}>
              Zamknij
            </CButton>
            <CButton color="primary" onClick={addEditorNodeToDraft} disabled={savingSingle}>
              {isEditingDraft ? "Aktualizuj w szkicu" : "Dodaj do szkicu"}
            </CButton>
            <CButton color="success" onClick={saveEditorNodeToBackend} disabled={savingSingle}>
              {savingSingle ? "Zapisywanie..." : "Zapisz w systemie"}
            </CButton>
          </div>
        </CModalFooter>
      </CModal>
    </>
  );
}
