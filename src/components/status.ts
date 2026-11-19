import type { Todo } from "../services/api";

export const STATUS_META: Record<
  Todo["status"],
  {
    label: string;
    short: string;
    dot: string;
    badge: string;
    columnBg: string;
    ring: string;
  }
> = {
  TODO: {
    label: "Chưa làm",
    short: "Todo",
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-700 ring-slate-200",
    columnBg: "bg-slate-100/70",
    ring: "ring-slate-300",
  },
  IN_PROGRESS: {
    label: "Đang làm",
    short: "In progress",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    columnBg: "bg-amber-50/60",
    ring: "ring-amber-300",
  },
  DONE: {
    label: "Đã làm",
    short: "Done",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    columnBg: "bg-emerald-50/60",
    ring: "ring-emerald-300",
  },
};

export const STATUS_ORDER: Todo["status"][] = ["TODO", "IN_PROGRESS", "DONE"];
