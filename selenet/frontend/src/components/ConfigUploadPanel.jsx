import { useState } from "react";

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
    <section className="panel p-5">
      <h2 className="hud-title text-sm text-oceanic-100">Node Configuration Upload</h2>

      <form className="mt-4 space-y-3" onSubmit={submitJson}>
        <label className="block text-xs uppercase tracking-wide text-oceanic-200">
          JSON Editor
        </label>
        <textarea
          className="h-44 w-full rounded-md border border-oceanic-300/30 bg-slate-950/50 p-3 text-xs text-oceanic-100 outline-none focus:border-solar-300"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          className="rounded-md border border-solar-300/60 bg-solar-300/20 px-3 py-2 text-sm font-semibold text-solar-100 hover:bg-solar-300/30"
          type="submit"
        >
          Upload JSON
        </button>
      </form>

      <div className="mt-5 border-t border-oceanic-300/20 pt-4">
        <label className="block text-xs uppercase tracking-wide text-oceanic-200">
          Upload JSON or YAML file
        </label>
        <input
          accept=".json,.yaml,.yml"
          className="mt-2 block w-full cursor-pointer rounded-md border border-oceanic-300/30 bg-slate-950/45 p-2 text-sm"
          onChange={submitFile}
          type="file"
        />
      </div>

      {localError && <p className="mt-3 text-sm text-red-200">{localError}</p>}
    </section>
  );
}