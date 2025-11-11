import { CSS as DndCSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import type { CSSProperties } from "react";
import type { Todo } from "../services/api";
import TodoCard from "./TodoCard";

interface DraggableTodoCardProps {
  todo: Todo;
  onUpdateStatus: (todo: Todo, status: Todo["status"]) => Promise<void>;
  onViewDetails: (todo: Todo) => void;
  onToggleSubTodo: (subTodo: Todo, completed: boolean) => Promise<void>;
}

export default function DraggableTodoCard({ todo, onUpdateStatus, onViewDetails, onToggleSubTodo }: DraggableTodoCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `todo-${todo.id}`,
    data: { todo },
    disabled: Boolean(todo.pendingSync),
  });

  const style: CSSProperties = {
    transform: transform ? DndCSS.Translate.toString(transform) : undefined,
    opacity: isDragging ? 0.5 : 1,
    transition: isDragging ? undefined : "transform 180ms ease, box-shadow 180ms ease",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={todo.pendingSync ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}
    >
      <TodoCard
        todo={todo}
        onUpdateStatus={onUpdateStatus}
        onViewDetails={onViewDetails}
        onToggleSubTodo={onToggleSubTodo}
      />
    </div>
  );
}
