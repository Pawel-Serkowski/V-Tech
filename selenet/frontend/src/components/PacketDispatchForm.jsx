import { useEffect, useMemo, useState } from "react";

import {
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CForm,
  CFormLabel,
  CFormSelect,
  CFormTextarea,
  CRow,
} from "@coreui/react";

export default function PacketDispatchForm({
  onDispatch,
  nodes = [],
  loadingNodes = false,
  dispatchContext = null,
  loadingDispatchContext = false,
}) {
  const [sourceNode, setSourceNode] = useState("");
  const [destinationNode, setDestinationNode] = useState("");
  const [priority, setPriority] = useState("2");
  const [payload, setPayload] = useState('{"telemetry": "health-check", "sequence": 1}');
  const [localError, setLocalError] = useState("");

  const nodeIds = useMemo(() => {
    return (Array.isArray(nodes) ? nodes : [])
      .map((node) => node?.node_id)
      .filter((nodeId) => typeof nodeId === "string" && nodeId.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }, [nodes]);

  const dispatchConfigError = useMemo(() => {
    if (typeof dispatchContext?.configuration_error !== "string") {
      return "";
    }
    return dispatchContext.configuration_error.trim();
  }, [dispatchContext]);

  const allowedSourceNodeIds = useMemo(() => {
    const rawAllowed = Array.isArray(dispatchContext?.allowed_source_nodes)
      ? dispatchContext.allowed_source_nodes
      : [];

    if (rawAllowed.length === 0) {
      return [];
    }

    const knownIds = new Set(nodeIds);
    return rawAllowed.filter((nodeId) => knownIds.has(nodeId));
  }, [dispatchContext, nodeIds]);

  const destinationNodeIds = useMemo(() => {
    return nodeIds.filter((nodeId) => nodeId !== sourceNode);
  }, [nodeIds, sourceNode]);

  const adjacencyMap = useMemo(() => {
    const map = new Map();
    const knownIds = new Set(nodeIds);

    (Array.isArray(nodes) ? nodes : []).forEach((node) => {
      const nodeId = node?.node_id;
      if (typeof nodeId !== "string" || nodeId.length === 0) {
        return;
      }

      if ("links" in (node ?? {})) {
        const links = Array.isArray(node?.links)
          ? node.links
              .map((item) => (typeof item?.dest_node === "string" ? item.dest_node : ""))
              .map((item) => item.trim())
              .filter((item) => item.length > 0 && item !== nodeId && knownIds.has(item))
          : [];
        map.set(nodeId, links);
        return;
      }

      map.set(
        nodeId,
        [...knownIds].filter((candidate) => candidate !== nodeId)
      );
    });

    return map;
  }, [nodes, nodeIds]);

  const routePreview = useMemo(() => {
    if (!sourceNode || !destinationNode) {
      return null;
    }
    if (sourceNode === destinationNode) {
      return [sourceNode];
    }

    const queue = [sourceNode];
    const visited = new Set([sourceNode]);
    const parentByNode = new Map();

    while (queue.length > 0) {
      const current = queue.shift();
      const neighbors = adjacencyMap.get(current) ?? [];

      for (const nextNode of neighbors) {
        if (visited.has(nextNode)) {
          continue;
        }

        visited.add(nextNode);
        parentByNode.set(nextNode, current);

        if (nextNode === destinationNode) {
          const path = [destinationNode];
          let trace = destinationNode;
          while (trace !== sourceNode) {
            trace = parentByNode.get(trace);
            if (!trace) {
              return null;
            }
            path.push(trace);
          }
          path.reverse();
          return path;
        }

        queue.push(nextNode);
      }
    }

    return null;
  }, [adjacencyMap, destinationNode, sourceNode]);

  const hasConnection = sourceNode !== "" && destinationNode !== "" && routePreview !== null;
  const isDispatchContextReady = Boolean(dispatchContext) && !loadingDispatchContext;
  const canSubmit = (
    isDispatchContextReady
    && !dispatchConfigError
    && allowedSourceNodeIds.length > 0
    && destinationNodeIds.length > 0
    && hasConnection
    && sourceNode !== destinationNode
  );

  useEffect(() => {
    if (allowedSourceNodeIds.length === 0) {
      setSourceNode("");
      return;
    }

    setSourceNode((current) => {
      if (current && allowedSourceNodeIds.includes(current)) {
        return current;
      }
      return allowedSourceNodeIds[0];
    });
  }, [allowedSourceNodeIds]);

  useEffect(() => {
    if (destinationNodeIds.length === 0) {
      setDestinationNode("");
      return;
    }

    setDestinationNode((current) => {
      if (current && destinationNodeIds.includes(current)) {
        return current;
      }
      return destinationNodeIds[0];
    });
  }, [destinationNodeIds]);

  const submitPacket = async (event) => {
    event.preventDefault();
    setLocalError("");

    try {
      if (!isDispatchContextReady) {
        throw new Error("Dispatch context is still loading from backend.");
      }

      if (dispatchConfigError) {
        throw new Error(dispatchConfigError);
      }

      if (!canSubmit) {
        throw new Error("Brak dostepnej sciezki miedzy wybranymi routerami.");
      }

      const parsedPayload = JSON.parse(payload);

      await onDispatch({
        source_node: sourceNode,
        destination_node: destinationNode,
        priority: Number(priority),
        payload: parsedPayload,
      });
    } catch (error) {
      setLocalError(error.message);
    }
  };

  return (
    <CCard className="surface-card h-100">
      <CCardHeader>
        <h2 className="h6 mb-0">Packet Dispatch Console</h2>
        <small className="text-body-secondary">
          {dispatchContext?.summary || "Send telemetry from selected source node to selected destination node"}
        </small>
        <small className="text-body-secondary d-block mt-1">
          Backend config: set DISPATCH_ORIGIN_SCOPE to earth, moon, or satellite. For satellite scope set DISPATCH_ORIGIN_NODE_ID (example: SAT_1).
        </small>
      </CCardHeader>
      <CCardBody>
        <CForm onSubmit={submitPacket}>
          <CRow className="g-3">
            <CCol md={6}>
              <CFormLabel htmlFor="sourceNode">Source Node</CFormLabel>
              <CFormSelect
                id="sourceNode"
                value={sourceNode}
                onChange={(event) => setSourceNode(event.target.value)}
                disabled={loadingNodes || loadingDispatchContext || allowedSourceNodeIds.length <= 1}
                options={
                  allowedSourceNodeIds.length > 0
                    ? allowedSourceNodeIds.map((nodeId) => ({ label: nodeId, value: nodeId }))
                    : [{
                        label:
                          loadingNodes || loadingDispatchContext
                            ? "Loading dispatch nodes..."
                            : "No source nodes allowed for this backend location",
                        value: "",
                      }]
                }
              />
            </CCol>
            <CCol md={6}>
              <CFormLabel htmlFor="destinationNode">Destination Node</CFormLabel>
              <CFormSelect
                id="destinationNode"
                value={destinationNode}
                onChange={(event) => setDestinationNode(event.target.value)}
                disabled={loadingNodes || loadingDispatchContext || destinationNodeIds.length === 0}
                options={
                  destinationNodeIds.length > 0
                    ? destinationNodeIds.map((nodeId) => ({
                        label: nodeId,
                        value: nodeId,
                      }))
                    : [{
                        label:
                          loadingNodes || loadingDispatchContext
                            ? "Loading nodes..."
                            : "No destination nodes available",
                        value: "",
                      }]
                }
              />
            </CCol>
            <CCol md={6}>
              <CFormLabel htmlFor="priority">Priority</CFormLabel>
              <CFormSelect
                id="priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                options={[
                  { label: "1 - Critical", value: "1" },
                  { label: "2 - High", value: "2" },
                  { label: "3 - Bulk", value: "3" },
                ]}
              />
            </CCol>
            <CCol md={12}>
              <CFormLabel htmlFor="payload">Payload (JSON)</CFormLabel>
              <CFormTextarea
                id="payload"
                rows={5}
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                className="mono"
              />
            </CCol>
            <CCol md={12} className="d-flex flex-column gap-2">
              <CButton color="primary" type="submit" disabled={!canSubmit}>
                Send Packet
              </CButton>
              {dispatchConfigError && (
                <small className="text-danger">{dispatchConfigError}</small>
              )}
              {allowedSourceNodeIds.length === 0 && !loadingNodes && !loadingDispatchContext && !dispatchConfigError && (
                <small className="text-danger">Brak dozwolonych wezlow zrodlowych dla tej lokalizacji backendu.</small>
              )}
              {nodeIds.length < 2 && !loadingNodes && (
                <small className="text-warning">Potrzeba co najmniej 2 routerow, aby wyslac pakiet.</small>
              )}
              {sourceNode && destinationNode && sourceNode === destinationNode && (
                <small className="text-warning">Zrodlo i cel sa takie same. Wybierz inny cel.</small>
              )}
              {sourceNode && destinationNode && sourceNode !== destinationNode && !hasConnection && (
                <small className="text-danger">
                  Brak polaczenia miedzy routerami {sourceNode} i {destinationNode} (wg aktualnych links).
                </small>
              )}
              {sourceNode && destinationNode && sourceNode !== destinationNode && hasConnection && routePreview && (
                <small className="text-success">Wykryta sciezka: {routePreview.join(" -> ")}</small>
              )}
              {localError && <small className="text-danger">{localError}</small>}
            </CCol>
          </CRow>
        </CForm>
      </CCardBody>
    </CCard>
  );
}