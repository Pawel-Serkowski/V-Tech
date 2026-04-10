import { useState } from "react";

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
    <section className="panel p-5">
      <h2 className="hud-title text-sm text-oceanic-100">Packet Dispatch Console</h2>
      <form className="mt-4 space-y-3" onSubmit={submitPacket}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-oceanic-100">
            Source Node
            <input
              className="mt-1 w-full rounded-md border border-oceanic-300/30 bg-slate-950/50 p-2 text-sm text-oceanic-100 outline-none focus:border-solar-300"
              onChange={(event) => setSourceNode(event.target.value)}
              value={sourceNode}
            />
          </label>
          <label className="text-sm text-oceanic-100">
            Destination Node
            <input
              className="mt-1 w-full rounded-md border border-oceanic-300/30 bg-slate-950/50 p-2 text-sm text-oceanic-100 outline-none focus:border-solar-300"
              onChange={(event) => setDestinationNode(event.target.value)}
              value={destinationNode}
            />
          </label>
        </div>

        <label className="text-sm text-oceanic-100">
          Priority
          <select
            className="mt-1 w-full rounded-md border border-oceanic-300/30 bg-slate-950/50 p-2 text-sm text-oceanic-100 outline-none focus:border-solar-300"
            onChange={(event) => setPriority(event.target.value)}
            value={priority}
          >
            <option value="1">1 - Critical</option>
            <option value="2">2 - High</option>
            <option value="3">3 - Bulk</option>
          </select>
        </label>

        <label className="text-sm text-oceanic-100">
          Payload (JSON)
          <textarea
            className="mt-1 h-28 w-full rounded-md border border-oceanic-300/30 bg-slate-950/50 p-2 text-xs text-oceanic-100 outline-none focus:border-solar-300"
            onChange={(event) => setPayload(event.target.value)}
            value={payload}
          />
        </label>

        <button
          className="rounded-md border border-oceanic-200/70 bg-oceanic-300/20 px-3 py-2 text-sm font-semibold text-oceanic-100 hover:bg-oceanic-300/35"
          type="submit"
        >
          Send Packet to Earth Gateway
        </button>

        {localError && <p className="text-sm text-red-200">{localError}</p>}
      </form>
    </section>
  );
}