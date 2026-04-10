import { useState } from "react";

import {
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CForm,
  CFormInput,
  CFormLabel,
  CFormTextarea,
} from "@coreui/react";

const TEMPLATE = `[
  {
    "node_id": "ESTRACK_PL",
    "node_type": "ground_station",
    "orbit": "Earth Surface",
    "time_offset_seconds": 0,
    "contact_windows": [
      {
        "start": "2026-04-10T08:00:00Z",
        "end": "2026-04-10T10:30:00Z"
      }
    ]
  },
  {
    "node_id": "LUNA_ORBITER_A",
    "node_type": "satellite",
    "orbit": "NRHO",
    "time_offset_seconds": 2,
    "contact_windows": [
      {
        "start": "2026-04-10T08:00:00Z",
        "end": "2026-04-10T12:00:00Z"
      }
    ]
  }
]`;

export default function ConfigUploadPanel({ onUploadJson, onUploadFile }) {
  const [text, setText] = useState(TEMPLATE);
  const [localError, setLocalError] = useState("");

  const submitJson = async (event) => {
    event.preventDefault();
    setLocalError("");

    try {
      const parsed = JSON.parse(text);
      const nodes = Array.isArray(parsed) ? parsed : parsed.nodes;

      if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error("JSON payload must contain at least one node.");
      }

      await onUploadJson(nodes);
    } catch (error) {
      setLocalError(error.message);
    }
  };

  const submitFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setLocalError("");
    try {
      await onUploadFile(file);
      event.target.value = "";
    } catch (error) {
      setLocalError(error.message);
    }
  };

  return (
    <CCard className="surface-card h-100">
      <CCardHeader>
        <h2 className="h6 mb-0">Node & Satellite Configuration</h2>
        <small className="text-body-secondary">Load orbital windows and time offsets from JSON or YAML</small>
      </CCardHeader>
      <CCardBody className="d-flex flex-column gap-4">
        <CForm className="d-flex flex-column gap-3" onSubmit={submitJson}>
          <div>
            <CFormLabel htmlFor="node-json">JSON Editor</CFormLabel>
            <CFormTextarea
              id="node-json"
              rows={9}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="mono"
            />
          </div>
          <CButton type="submit" color="info" variant="outline">
            Upload JSON
          </CButton>
        </CForm>

        <div className="border-top pt-3">
          <CFormLabel htmlFor="node-file">Upload JSON or YAML file</CFormLabel>
          <CFormInput id="node-file" type="file" accept=".json,.yaml,.yml" onChange={submitFile} />
        </div>

        {localError && <small className="text-danger">{localError}</small>}
      </CCardBody>
    </CCard>
  );
}