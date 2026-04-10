export default function QueueLoadPanel({ queueLoad }) {
  const maxLoad = Math.max(...queueLoad.map((item) => item.queued_packets), 1);

  return (
    <section className="panel p-5">
      <h2 className="hud-title text-sm text-oceanic-100">Queue Load by Node</h2>
      <div className="mt-4 space-y-3">
        {queueLoad.length === 0 && <p className="text-sm text-oceanic-200">No queued packets.</p>}

        {queueLoad.map((item) => (
          <div className="rounded-md border border-oceanic-300/30 p-3" key={item.node_id}>
            <div className="flex items-center justify-between text-sm text-oceanic-100">
              <span>{item.node_id}</span>
              <span>{item.queued_packets}</span>
            </div>
            <div className="mt-2 h-2 rounded bg-slate-950/50">
              <div
                className="h-2 rounded bg-gradient-to-r from-oceanic-200 to-solar-300"
                style={{ width: `${Math.max((item.queued_packets / maxLoad) * 100, 8)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}