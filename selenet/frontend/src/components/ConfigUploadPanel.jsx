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
    "position_x_km": 6371.0,
    "position_y_km": 0.0,
    "position_z_km": 0.0,
    "time_offset_seconds": 0,
    "links": ["LUNA_RELAY_B"],
    "contact_windows": [
      {
        "start": "2026-04-10T07:50:00Z",
        "end": "2026-04-10T08:20:00Z"
      },
      {
        "start": "2026-04-10T12:10:00Z",
        "end": "2026-04-10T12:50:00Z"
      },
      {
        "start": "2026-04-10T18:45:00Z",
        "end": "2026-04-10T19:30:00Z"
      }
    ]
  },
  {
    "node_id": "LUNA_RELAY_B",
    "node_type": "relay",
    "orbit": "Trans-Lunar Corridor",
    "position_x_km": 180000.0,
    "position_y_km": 9000.0,
    "position_z_km": -500.0,
    "time_offset_seconds": 1,
    "links": ["LUNA_ORBITER_A"],
    "contact_windows": [
      {
        "start": "2026-04-10T07:58:00Z",
        "end": "2026-04-10T08:42:00Z"
      },
      {
        "start": "2026-04-10T12:18:00Z",
        "end": "2026-04-10T13:04:00Z"
      },
      {
        "start": "2026-04-10T18:54:00Z",
        "end": "2026-04-10T19:56:00Z"
      }
    ]
  },
  {
    "node_id": "LUNA_ORBITER_A",
    "node_type": "satellite",
    "orbit": "NRHO",
    "position_x_km": 386000.0,
    "position_y_km": 8000.0,
    "position_z_km": 1200.0,
    "time_offset_seconds": 2,
    "links": [],
    "contact_windows": [
      {
        "start": "2026-04-10T08:00:00Z",
        "end": "2026-04-10T08:40:00Z"
      },
      {
        "start": "2026-04-10T12:20:00Z",
        "end": "2026-04-10T13:00:00Z"
      },
      {
        "start": "2026-04-10T18:50:00Z",
        "end": "2026-04-10T19:50:00Z"
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