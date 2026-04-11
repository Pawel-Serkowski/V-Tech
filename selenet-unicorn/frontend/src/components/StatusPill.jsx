import { formatStatusLabel, statusTone } from "../utils/packet-utils";

export default function StatusPill({ status }) {
  return <span className={`status-pill ${statusTone(status)}`}>{formatStatusLabel(status)}</span>;
}
