import { PropsWithChildren } from "react";
import { useDroppable } from "@dnd-kit/core";

interface KanbanColumnProps {
  id: string;
  title: string;
  subtitle?: string;
  accentClass?: string;
}

const KanbanColumn = ({
  id,
  title,
  subtitle,
  accentClass = "text-gray-500",
  children,
}: PropsWithChildren<KanbanColumnProps>) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <section
      ref={setNodeRef}
      className={`flex flex-col gap-4 rounded-2xl bg-white p-4 shadow transition ${
        isOver ? "ring-2 ring-brand-500/70" : "ring-1 ring-gray-100"
      }`}
    >
      <header className="space-y-1">
        <p
          className={`text-xs font-semibold uppercase tracking-widest ${accentClass}`}
        >
          {title}
        </p>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </header>
      <div className="flex flex-1 flex-col gap-3">{children}</div>
    </section>
  );
};

export default KanbanColumn;
