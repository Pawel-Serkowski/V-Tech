import { useState } from "react";

import {
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CForm,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormTextarea,
  CRow,
} from "@coreui/react";

export default function PacketDispatchForm({ onDispatch }) {
  const [sourceNode, setSourceNode] = useState("ESTRACK_PL");
  const [destinationNode, setDestinationNode] = useState("LUNA_ORBITER_A");
  const [priority, setPriority] = useState("2");
  const [payload, setPayload] = useState('{"telemetry": "health-check", "sequence": 1}');
  const [localError, setLocalError] = useState("");

  const submitPacket = async (event) => {
    event.preventDefault();
    setLocalError("");

    try {
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
        <small className="text-body-secondary">Send telemetry from Earth node to selected satellite or relay</small>
      </CCardHeader>
      <CCardBody>
        <CForm onSubmit={submitPacket}>
          <CRow className="g-3">
            <CCol md={6}>
              <CFormLabel htmlFor="sourceNode">Source Node</CFormLabel>
              <CFormInput
                id="sourceNode"
                value={sourceNode}
                onChange={(event) => setSourceNode(event.target.value)}
                placeholder="ESTRACK_PL"
              />
            </CCol>
            <CCol md={6}>
              <CFormLabel htmlFor="destinationNode">Destination Node</CFormLabel>
              <CFormInput
                id="destinationNode"
                value={destinationNode}
                onChange={(event) => setDestinationNode(event.target.value)}
                placeholder="LUNA_ORBITER_A"
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
              <CButton color="primary" type="submit">
                Send Packet to Gateway
              </CButton>
              {localError && <small className="text-danger">{localError}</small>}
            </CCol>
          </CRow>
        </CForm>
      </CCardBody>
    </CCard>
  );
}