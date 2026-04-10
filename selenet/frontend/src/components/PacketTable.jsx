const PRIORITY_LABEL = {
  1: "Critical",
  2: "High",
  3: "Bulk",
};

function statusClass(status) {
  if (!status) {
    return "bg-slate-500/20 text-slate-200";
  }
  if (status.includes("DELIVERED")) {
    return "bg-green-500/20 text-green-200";
  }
  if (status.includes("ERROR") || status.includes("FAILED")) {
    return "bg-red-500/20 text-red-200";
  }
  if (status.includes("WAITING")) {
    return "bg-yellow-500/20 text-yellow-200";
  }
  return "bg-cyan-500/20 text-cyan-100";
}

export default function PacketTable({ packets, loading }) {
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="hud-title text-sm text-oceanic-100">Packet Routing View</h2>
        <span className="rounded border border-oceanic-300/40 px-2 py-1 text-xs text-oceanic-200">
          {packets.length} packets
        </span>
      </div>

      <div className="mt-4 overflow-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-oceanic-200">
            <tr>
              <th className="pb-3 pr-3">Packet ID</th>
              <th className="pb-3 pr-3">Route</th>
              <th className="pb-3 pr-3">Priority</th>
              <th className="pb-3 pr-3">Next Hop</th>
              <th className="pb-3 pr-3">Status</th>
              <th className="pb-3">Earth Timestamp</th>
            </tr>
          </thead>
          <tbody className="text-oceanic-100">
            {loading && (
              <tr>
                <td className="py-3 text-oceanic-200" colSpan={6}>
                  Loading packet telemetry...
                </td>
              </tr>
            )}

            {!loading && packets.length === 0 && (
              <tr>
                <td className="py-3 text-oceanic-200" colSpan={6}>
                  No packets in history yet.
                </td>
              </tr>
            )}

            {packets.map((packet) => (
              <tr className="border-t border-oceanic-400/20" key={packet.packet_id}>
                <td className="py-3 pr-3 align-top font-semibold">{packet.packet_id.slice(0, 8)}</td>
                <td className="py-3 pr-3 align-top">
                  {packet.source_node} -> {packet.destination_node}
                </td>
                <td className="py-3 pr-3 align-top">
                  {PRIORITY_LABEL[packet.priority] || `P${packet.priority}`}
                </td>
                <td className="py-3 pr-3 align-top">{packet.next_hop || "unassigned"}</td>
                <td className="py-3 pr-3 align-top">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(
                      packet.current_status
                    )}`}
                  >
                    {packet.current_status}
                  </span>
                </td>
                <td className="py-3 align-top text-xs text-oceanic-200">{packet.earth_timestamp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}