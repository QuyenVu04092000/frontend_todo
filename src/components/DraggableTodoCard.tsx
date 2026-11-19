import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { useMemo, type SyntheticEvent } from "react";

import type { Todo } from "../services/api";
import { API_URL } from "../services/api";
import { formatDateForDisplay } from "../utils/timeline";
import {
  CalendarIcon,
  ChecklistIcon,
  ExpandIcon,
  NoteIcon,
  TrashIcon,
} from "./icons";
import { STATUS_META, STATUS_ORDER } from "./status";

interface DraggableTodoCardProps {
  todo: Todo;
  onUpdateStatus: (todo: Todo, status: Todo["status"]) => Promise<void>;
  onViewDetails: (todo: Todo) => void;
  onToggleSubTodo: (subTodo: Todo, completed: boolean) => Promise<void>;
  onDeleteTodo: (todo: Todo) => Promise<void>;
  onDeleteSubTodo: (subTodo: Todo) => Promise<void>;
  /** When false (mobile), the card can't be dragged; status changes via buttons. */
  dragEnabled?: boolean;
}

const MAX_VISIBLE_SUBTODOS = 3;

// Keep taps on controls from starting a drag.
const stopDrag = (event: SyntheticEvent) => event.stopPropagation();
const noDragProps = {
  onPointerDown: stopDrag,
  onMouseDown: stopDrag,
  onTouchStart: stopDrag,
};

const DraggableTodoCard = ({
  todo,
  onUpdateStatus,
  onViewDetails,
  onToggleSubTodo,
  onDeleteTodo,
  onDeleteSubTodo,
  dragEnabled = true,
}: DraggableTodoCardProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: todo.id,
      data: { todo },
      disabled: !dragEnabled,
    });
  const dragProps = dragEnabled ? { ...attributes, ...listeners } : {};

  const style = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    transition: isDragging
      ? "none"
      : "transform 220ms cubic-bezier(0.25, 0.8, 0.25, 1)",
    zIndex: isDragging ? 40 : undefined,
  };

  const subtodos = todo.subtodos ?? [];
  const completedSubTodos = useMemo(
    () => subtodos.filter((sub) => sub.status === "DONE").length,
    [subtodos]
  );
  const progress = subtodos.length
    ? Math.round((completedSubTodos / subtodos.length) * 100)
    : 0;

  const imageSrc = useMemo(() => {
    if (!todo.imageUrl) return null;
    if (
      todo.imageUrl.startsWith("http://") ||
      todo.imageUrl.startsWith("https://") ||
      todo.imageUrl.startsWith("blob:")
    ) {
      return todo.imageUrl;
    }
    return `${API_URL}${todo.imageUrl}`;
  }, [todo.imageUrl]);

  const isOverdue = useMemo(() => {
    if (!todo.endDate || todo.status === "DONE") return false;
    const end = new Date(todo.endDate);
    if (Number.isNaN(end.getTime())) return false;
    end.setHours(23, 59, 59, 999);
    return end.getTime() < Date.now();
  }, [todo.endDate, todo.status]);

  const isPending = todo.id < 0;
  const meta = STATUS_META[todo.status];
  const visibleSubtodos = subtodos.slice(0, MAX_VISIBLE_SUBTODOS);
  const hiddenCount = subtodos.length - visibleSubtodos.length;
  const showMarkAllDone =
    todo.status === "DONE" &&
    subtodos.length > 0 &&
    completedSubTodos < subtodos.length;
  const hasFooterExtras =
    Boolean(todo.startDate || todo.endDate) || showMarkAllDone || isPending;

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...dragProps}
      className={`group relative flex touch-manipulation flex-col gap-3 rounded-xl border bg-white p-3.5 text-left transition-shadow duration-200 ${
        dragEnabled ? "cursor-grab active:cursor-grabbing" : ""
      } ${
        isDragging
          ? "border-brand-300 shadow-lift ring-2 ring-brand-500/20"
          : "border-slate-200/80 shadow-card hover:border-slate-300 hover:shadow-lift"
      } ${isPending ? "opacity-70" : ""}`}
    >
      <header className="flex items-start gap-2">
        <button
          type="button"
          {...noDragProps}
          onClick={() => onViewDetails(todo)}
          className="min-w-0 flex-1 text-left"
        >
          <h3
            className={`break-words text-[15px] font-semibold leading-snug ${
              todo.status === "DONE"
                ? "text-slate-500 line-through decoration-slate-300"
                : "text-slate-900"
            }`}
          >
            {todo.title}
          </h3>
          {(todo.description || subtodos.length > 0) && (
            <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              {subtodos.length > 0 && (
                <span
                  className={`inline-flex items-center gap-1 tabular-nums ${
                    completedSubTodos === subtodos.length
                      ? "text-emerald-600"
                      : ""
                  }`}
                  title="Checklist"
                >
                  <ChecklistIcon width={13} height={13} />
                  {completedSubTodos}/{subtodos.length}
                </span>
              )}
              {todo.description && (
                <span
                  className="inline-flex items-center text-slate-400"
                  title="Có ghi chú"
                  aria-label="Có ghi chú"
                >
                  <NoteIcon width={13} height={13} />
                </span>
              )}
            </span>
          )}
        </button>
        <div className="-mr-1 -mt-1 flex shrink-0 items-center opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
          <button
            type="button"
            {...noDragProps}
            onClick={() => onViewDetails(todo)}
            className="icon-btn h-8 w-8"
            aria-label="Open details"
            title="Details"
          >
            <ExpandIcon width={16} height={16} />
          </button>
          <button
            type="button"
            {...noDragProps}
            onClick={() => {
              onDeleteTodo(todo).catch(() => {
                // swallow; parent handles error state
              });
            }}
            className="icon-btn h-8 w-8 hover:bg-red-50 hover:text-red-600"
            aria-label={`Delete ${todo.title}`}
            title="Delete"
          >
            <TrashIcon width={16} height={16} />
          </button>
        </div>
      </header>

      {imageSrc && (
        <button
          type="button"
          {...noDragProps}
          onClick={() => onViewDetails(todo)}
          className="overflow-hidden rounded-lg border border-slate-100 bg-slate-50"
        >
          <img
            src={imageSrc}
            alt={`${todo.title} reference`}
            className="h-36 w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
            loading="lazy"
            draggable={false}
          />
        </button>
      )}

      {subtodos.length > 0 && (
        <div className="space-y-2">
          <div className="h-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <ul className="space-y-0.5">
            {visibleSubtodos.map((subTodo) => {
              const isDone = subTodo.status === "DONE";
              return (
                <li
                  key={subTodo.id}
                  className="group/sub flex items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    {...noDragProps}
                    className="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-brand-500"
                    checked={isDone}
                    onChange={(event) =>
                      onToggleSubTodo(subTodo, event.target.checked)
                    }
                    aria-label={`Mark ${subTodo.title} as done`}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      isDone ? "text-slate-400 line-through" : "text-slate-700"
                    }`}
                  >
                    {subTodo.title}
                  </span>
                  <button
                    type="button"
                    {...noDragProps}
                    onClick={() => {
                      onDeleteSubTodo(subTodo).catch(() => {
                        // swallow; parent handles error state
                      });
                    }}
                    className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 md:opacity-0 md:group-hover/sub:opacity-100"
                    aria-label={`Delete ${subTodo.title}`}
                  >
                    <TrashIcon width={14} height={14} />
                  </button>
                </li>
              );
            })}
          </ul>
          {hiddenCount > 0 && (
            <button
              type="button"
              {...noDragProps}
              onClick={() => onViewDetails(todo)}
              className="px-1 text-xs font-medium text-brand-500 hover:text-brand-600"
            >
              +{hiddenCount} more
            </button>
          )}
        </div>
      )}

      {/* Mobile: quick status switch instead of drag & drop */}
      <div
        role="radiogroup"
        aria-label="Status"
        className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 md:hidden"
      >
        {STATUS_ORDER.map((status) => {
          const isActive = todo.status === status;
          return (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={isPending}
              onClick={() => {
                if (!isActive) void onUpdateStatus(todo, status);
              }}
              className={`flex min-h-[36px] items-center justify-center gap-1.5 rounded-md px-1 text-xs font-semibold transition disabled:opacity-50 ${
                isActive
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 active:bg-white/60"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_META[status].dot}`}
              />
              <span className="truncate">{STATUS_META[status].label}</span>
            </button>
          );
        })}
      </div>

      <footer
        className={`flex-wrap items-center gap-2 border-t border-slate-100 pt-3 ${
          hasFooterExtras ? "flex" : "hidden md:flex"
        }`}
      >
        <label className="relative hidden md:block" {...noDragProps}>
          <span className="sr-only">Status</span>
          <span
            className={`pointer-events-none absolute left-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${meta.dot}`}
          />
          <select
            value={todo.status}
            onChange={(event) =>
              onUpdateStatus(todo, event.target.value as Todo["status"])
            }
            className={`cursor-pointer appearance-none rounded-full py-1 pl-6 pr-3 text-xs font-semibold ring-1 ring-inset focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${meta.badge}`}
          >
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {STATUS_META[status].label}
              </option>
            ))}
          </select>
        </label>

        {(todo.startDate || todo.endDate) && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
              isOverdue
                ? "bg-red-50 text-red-600"
                : "bg-slate-100 text-slate-600"
            }`}
            title={isOverdue ? "Overdue" : "Timeline"}
          >
            <CalendarIcon width={12} height={12} />
            {todo.startDate ? formatDateForDisplay(todo.startDate) : "…"}
            {" → "}
            {todo.endDate ? formatDateForDisplay(todo.endDate) : "…"}
          </span>
        )}

        {showMarkAllDone && (
            <button
              type="button"
              {...noDragProps}
              onClick={async () => {
                await Promise.all(
                  subtodos.map((sub) => onToggleSubTodo(sub, true))
                );
              }}
              className="ml-auto text-xs font-medium text-brand-500 hover:text-brand-600"
            >
              Mark checklist done
            </button>
          )}

        {isPending && (
          <span className="ml-auto text-xs italic text-slate-400">
            Syncing…
          </span>
        )}
      </footer>
    </article>
  );
};

export default DraggableTodoCard;
