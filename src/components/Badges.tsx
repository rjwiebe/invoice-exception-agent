import { STATUS_LABEL } from "@/lib/format";

export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`badge b-${status}`}>{STATUS_LABEL[status] ?? status}</span>
);
