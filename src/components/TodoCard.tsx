import { useState } from "react";
import type { Todo } from "../services/api";
import { API_URL } from "../services/api";
import { calculateTimeline, formatDateForDisplay } from "../utils/timeline";

const STATUS_BADGE_CLASSES: Record<Todo["status"], string> = {
  TODO: "bg-gray-100 text-gray-700 border border-gray-200",
  IN_PROGRESS: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  DONE: "bg-green-100 text-green-700 border border-green-200",
};

const STATUS_TITLE_CLASSES: Record<Todo["status"], string> = {
  TODO: "text-lg font-semibold text-gray-800",
  IN_PROGRESS: "text-lg font-semibold text-yellow-600",
  DONE: "text-lg font-semibold text-green-600 line-through",
};

const SUBTODO_TITLE_CLASSES: Record<Todo["status"], string> = {
  TODO: "text-sm font-medium text-gray-700",
  IN_PROGRESS: "text-sm font-medium text-yellow-600",
  DONE: "text-sm font-medium text-green-600 line-through",
};

const STATUS_LABEL: Record<Todo["status"], string> = {
  TODO: "Chưa làm",
  IN_PROGRESS: "Đang làm",
  DONE: "Đã làm",
};

interface TodoCardProps {
  todo: Todo;
  onUpdateStatus: (todo: Todo, status: Todo["status"]) => Promise<void>;
  onViewDetails?: (todo: Todo) => void;
  onToggleSubTodo?: (subTodo: Todo, completed: boolean) => Promise<void>;
}

export default function TodoCard({
  todo,
  onUpdateStatus,
  onViewDetails,
  onToggleSubTodo,
}: TodoCardProps) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const timeline = calculateTimeline(todo);
  const imageSrc = todo.imageUrl
    ? todo.imageUrl.startsWith("http")
      ? todo.imageUrl
      : `${API_URL}${todo.imageUrl}`
    : null;

  const handleStatusChange = async (statusValue: Todo["status"]) => {
    if (statusValue === todo.status) return;
    setIsUpdatingStatus(true);
    setLocalError(null);
    try {
      await onUpdateStatus(todo, statusValue);
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "Không thể cập nhật trạng thái."
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleSubTodoCheckbox = async (subTodo: Todo, checked: boolean) => {
    if (!onToggleSubTodo) return;
    setLocalError(null);
    try {
      await onToggleSubTodo(subTodo, checked);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Không thể cập nhật subtodo."
      );
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm ring-1 ring-transparent transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <span className={STATUS_TITLE_CLASSES[todo.status]}>
            {todo.title}
          </span>
          {todo.pendingSync && (
            <p className="text-xs font-medium uppercase tracking-wide text-orange-500">
              Pending sync
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
              STATUS_BADGE_CLASSES[todo.status]
            }`}
          >
            {STATUS_LABEL[todo.status]}
          </span>
        </div>
      </div>
      <div className="mt-3">
        <label className="sr-only" htmlFor={`status-select-${todo.id}`}>
          Update status
        </label>
        <select
          id={`status-select-${todo.id}`}
          value={todo.status}
          onChange={(event) =>
            handleStatusChange(event.target.value as Todo["status"])
          }
          disabled={isUpdatingStatus || todo.pendingSync}
          className="w-full rounded-md border border-r-8 border-transparent outline outline-gray-200 bg-white px-2 py-2 text-xs font-medium text-gray-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        >
          <option value="TODO">Chưa làm</option>
          <option value="IN_PROGRESS">Đang làm</option>
          <option value="DONE">Đã làm</option>
        </select>
      </div>
      {todo.description && (
        <p className="mt-3 text-sm text-gray-600">{todo.description}</p>
      )}

      {imageSrc && (
        <img
          src={imageSrc}
          alt={todo.title}
          className="mt-3 h-40 w-full rounded-lg object-cover"
        />
      )}

      {todo.subtodos && todo.subtodos.length > 0 && (
        <details className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700">
            Todos ({todo.subtodos.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {todo.subtodos.map((subTodo) => (
              <li key={subTodo.id} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={subTodo.status === "DONE"}
                  onChange={(event) =>
                    handleSubTodoCheckbox(subTodo, event.target.checked)
                  }
                  disabled={Boolean(todo.pendingSync || subTodo.pendingSync)}
                  className={`mt-1 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500 ${
                    todo.pendingSync || subTodo.pendingSync
                      ? "cursor-not-allowed opacity-60"
                      : ""
                  }`}
                />
                <div>
                  <p className={SUBTODO_TITLE_CLASSES[subTodo.status]}>
                    {subTodo.title}
                  </p>
                  {subTodo.description && (
                    <p className="text-xs text-gray-500">
                      {subTodo.description}
                    </p>
                  )}
                  {subTodo.pendingSync && (
                    <p className="text-[10px] font-medium uppercase tracking-wide text-orange-500">
                      Pending sync
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {onViewDetails && (
        <button
          type="button"
          onClick={() => onViewDetails(todo)}
          className="mt-4 inline-flex items-center justify-center rounded-md border border-brand-500 px-3 py-1 text-xs font-semibold text-brand-500 transition hover:bg-brand-500/10"
        >
          View details
        </button>
      )}

      {localError && <p className="mt-3 text-xs text-red-600">{localError}</p>}
    </div>
  );
}
