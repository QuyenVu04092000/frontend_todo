import { PropsWithChildren } from "react";
import { useDroppable } from "@dnd-kit/core";

import type { Todo } from "../services/api";
import { STATUS_META } from "./status";

interface KanbanColumnProps {
  id: Todo["status"];
  title: string;
  count: number;
  className?: string;
}

const KanbanColumn = ({
  id,
  title,
  count,
  className = "",
  children,
}: PropsWithChildren<KanbanColumnProps>) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  const meta = STATUS_META[id];

  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-[12rem] flex-col gap-3 rounded-2xl p-2.5 transition md:min-h-[24rem] md:p-3 ${
        meta.columnBg
      } ${isOver ? `ring-2 ${meta.ring} ring-offset-2 ring-offset-slate-50` : ""} ${className}`}
    >
      <header className="hidden items-center justify-between px-1.5 pt-1 md:flex">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        </div>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 shadow-sm">
          {count}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-2.5">{children}</div>
    </section>
  );
};

export default KanbanColumn;
