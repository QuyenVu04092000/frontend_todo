import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { useMemo } from "react";

import type { Todo } from "../services/api";
import { API_URL } from "../services/api";
import { formatDateForDisplay } from "../utils/timeline";

interface DraggableTodoCardProps {
  todo: Todo;
  onUpdateStatus: (todo: Todo, status: Todo["status"]) => Promise<void>;
  onViewDetails: (todo: Todo) => void;
  onToggleSubTodo: (subTodo: Todo, completed: boolean) => Promise<void>;
  onDeleteTodo: (todo: Todo) => Promise<void>;
  onDeleteSubTodo: (subTodo: Todo) => Promise<void>;
}

const STATUS_ORDER: Todo["status"][] = ["TODO", "IN_PROGRESS", "DONE"];

const getNextStatus = (current: Todo["status"]): Todo["status"] | null => {
  const index = STATUS_ORDER.indexOf(current);
  if (index === -1 || index === STATUS_ORDER.length - 1) {
    return null;
  }
  return STATUS_ORDER[index + 1];
};

const DraggableTodoCard = ({
  todo,
  onUpdateStatus,
  onViewDetails,
  onToggleSubTodo,
  onDeleteTodo,
  onDeleteSubTodo,
}: DraggableTodoCardProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: todo.id,
      data: { todo },
    });

  const style = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    opacity: isDragging ? 0.6 : 1,
    transition: isDragging
      ? "none"
      : "transform 220ms cubic-bezier(0.25, 0.8, 0.25, 1)",
  };

  const subtodos = todo.subtodos ?? [];
  const completedSubTodos = useMemo(
    () => subtodos.filter((sub) => sub.status === "DONE").length,
    [subtodos]
  );

  const nextStatus = getNextStatus(todo.status);

  const imageSrc = useMemo(() => {
    if (!todo.imageUrl) return null;
    if (
      todo.imageUrl.startsWith("http://") ||
      todo.imageUrl.startsWith("https://")
    ) {
      return todo.imageUrl;
    }
    return `${API_URL}${todo.imageUrl}`;
  }, [todo.imageUrl]);

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group flex cursor-grab flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-xl active:cursor-grabbing"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-gray-900">{todo.title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onViewDetails(todo)}
            className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-500 transition hover:border-brand-500 hover:text-brand-500"
          >
            Details
          </button>
          <button
            type="button"
            onClick={() => {
              onDeleteTodo(todo).catch(() => {
                // swallow; parent handles error state
              });
            }}
            className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </header>

      <select
        value={todo.status}
        onChange={(event) =>
          onUpdateStatus(todo, event.target.value as Todo["status"])
        }
        className="rounded border border-transparent outline outline-gray-300 px-4 py-1 text-sm focus-visible:ring-brand-500/30"
      >
        <option value="TODO">Chưa làm</option>
        <option value="IN_PROGRESS">Đang làm</option>
        <option value="DONE">Đã làm</option>
      </select>

      {todo.description && (
        <p className="line-clamp-3 text-sm text-gray-600">{todo.description}</p>
      )}

      {imageSrc && (
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
          <img
            src={imageSrc}
            alt={`${todo.title} reference`}
            className="w-full max-h-64 object-contain transition-transform duration-300 ease-out group-hover:scale-[1.01]"
            loading="lazy"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
        <div>
          <p className="font-semibold uppercase tracking-wider text-gray-400">
            Start
          </p>
          <p>{todo.startDate ? formatDateForDisplay(todo.startDate) : "-"}</p>
        </div>
        <div>
          <p className="font-semibold uppercase tracking-wider text-gray-400">
            End
          </p>
          <p>{todo.endDate ? formatDateForDisplay(todo.endDate) : "-"}</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Subtodos
        </p>
        {subtodos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
            No subtodos yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {subtodos.map((subTodo) => {
              const isDone = subTodo.status === "DONE";
              return (
                <li
                  key={subTodo.id}
                  className="flex items-start gap-2 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2 text-xs"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                    checked={isDone}
                    onChange={(event) =>
                      onToggleSubTodo(subTodo, event.target.checked)
                    }
                  />
                  <div className="flex-1 space-y-1">
                    <p
                      className={`font-medium ${
                        isDone ? "text-gray-500 line-through" : "text-gray-700"
                      }`}
                    >
                      {subTodo.title}
                    </p>
                    {subTodo.description && (
                      <p className="text-[11px] text-gray-500">
                        {subTodo.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteSubTodo(subTodo).catch(() => {
                        // swallow; parent handles error state
                      });
                    }}
                    className="rounded-full border border-gray-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 transition hover:border-red-400 hover:text-red-500"
                    aria-label={`Delete ${subTodo.title}`}
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              todo.status === "DONE"
                ? "bg-green-100 text-green-700"
                : todo.status === "IN_PROGRESS"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {todo.status.replace("_", " ")}
          </span>
          {subtodos.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-600">
              <span role="img" aria-hidden="true">
                🧩
              </span>
              {completedSubTodos}/{subtodos.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {todo.status === "DONE" && subtodos.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                await Promise.all(
                  subtodos.map((sub) => onToggleSubTodo(sub, true))
                );
              }}
              className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-500 transition hover:border-brand-500 hover:text-brand-500"
            >
              Mark subtodos done
            </button>
          )}
        </div>
      </footer>
    </article>
  );
};

export default DraggableTodoCard;
