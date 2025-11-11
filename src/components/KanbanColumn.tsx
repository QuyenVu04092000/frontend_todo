import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";

interface KanbanColumnProps {
  id: string;
  title: string;
  subtitle?: string;
  accentClass: string;
  children: ReactNode;
}

export default function KanbanColumn({ id, title, subtitle, accentClass, children }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[420px] flex-col rounded-2xl border border-gray-200 bg-gray-50/70 p-4 transition ${
        isOver ? "ring-2 ring-brand-500 ring-offset-2" : "ring-0"
      }`}
    >
      <header className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className={`text-sm font-semibold uppercase tracking-wide ${accentClass}`}>{title}</h2>
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
      </header>
      <div className="flex-1 space-y-3">
        {children}
      </div>
    </div>
  );
}
