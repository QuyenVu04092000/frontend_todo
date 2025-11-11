import { useMemo, useState, type FormEvent } from "react";
import type { Todo } from "../services/api";
import { API_URL } from "../services/api";
import { formatDateForDisplay } from "../utils/timeline";

interface TodoDetailsModalProps {
  todo: Todo;
  onClose: () => void;
  onUpdateStatus: (todo: Todo, status: Todo["status"]) => Promise<void>;
  onCreateSubTodo: (
    parent: Todo,
    values: { title: string; description?: string }
  ) => Promise<void>;
  onToggleSubTodo: (subTodo: Todo, completed: boolean) => Promise<void>;
}

const STATUS_TEXT: Record<Todo["status"], string> = {
  TODO: "Chưa làm",
  IN_PROGRESS: "Đang làm",
  DONE: "Đã làm",
};

export default function TodoDetailsModal({
  todo,
  onClose,
  onUpdateStatus,
  onCreateSubTodo,
  onToggleSubTodo,
}: TodoDetailsModalProps) {
  const createdAt = useMemo(
    () => new Date(todo.createdAt).toLocaleString(),
    [todo.createdAt]
  );
  const imageSrc = todo.imageUrl
    ? todo.imageUrl.startsWith("http")
      ? todo.imageUrl
      : `${API_URL}${todo.imageUrl}`
    : null;
  const [subTitle, setSubTitle] = useState("");
  const [subDescription, setSubDescription] = useState("");
  const [isCreatingSubTodo, setIsCreatingSubTodo] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleRootStatusChange = async (nextStatus: Todo["status"]) => {
    if (nextStatus === todo.status) return;
    await onUpdateStatus(todo, nextStatus);
  };

  const handleSubTodoToggle = async (subTodo: Todo, checked: boolean) => {
    await onToggleSubTodo(subTodo, checked);
  };

  const handleCreateSubTodoSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!subTitle.trim()) {
      setCreateError("Subtodo title is required");
      return;
    }
    setIsCreatingSubTodo(true);
    setCreateError(null);
    try {
      await onCreateSubTodo(todo, {
        title: subTitle.trim(),
        description: subDescription.trim() || undefined,
      });
      setSubTitle("");
      setSubDescription("");
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create subtodo"
      );
    } finally {
      setIsCreatingSubTodo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 p-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              Todo Detail
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-gray-900">
              {todo.title}
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Created at: {createdAt}
            </p>
            {todo.pendingSync && (
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-orange-500">
                Pending sync
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-500 transition hover:bg-gray-100"
          >
            Close
          </button>
        </header>

        <div className="space-y-6 p-6">
          <section>
            <h3 className="text-sm font-semibold text-gray-700">Description</h3>
            <p className="mt-2 text-sm text-gray-600">
              {todo.description || "No description provided"}
            </p>
          </section>

          {imageSrc && (
            <section>
              <h3 className="text-sm font-semibold text-gray-700">
                Attached image
              </h3>
              <img
                src={imageSrc}
                alt={todo.title}
                className="mt-3 w-full rounded-lg object-cover shadow"
              />
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold text-gray-700">Status</h3>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                Current: {STATUS_TEXT[todo.status]}
              </span>
              <select
                value={todo.status}
                onChange={(event) =>
                  handleRootStatusChange(event.target.value as Todo["status"])
                }
                disabled={todo.pendingSync}
                className="rounded border border-gray-300 px-3 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="TODO">Chưa làm</option>
                <option value="IN_PROGRESS">Đang làm</option>
                <option value="DONE">Đã làm</option>
              </select>
              {todo.pendingSync && (
                <span className="text-xs font-medium text-orange-500">
                  Sync required before changes
                </span>
              )}
            </div>
          </section>

          <section className="grid gap-1 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">
                Start date
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {todo.startDate ? formatDateForDisplay(todo.startDate) : "-"}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700">End date</h3>
              <p className="mt-1 text-sm text-gray-500">
                {todo.endDate ? formatDateForDisplay(todo.endDate) : "-"}
              </p>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                SubTodos ({todo.subtodos?.length ?? 0})
              </h3>
            </div>
            <div className="mt-3 space-y-3">
              {(todo.subtodos ?? []).length === 0 ? (
                <p className="text-sm text-gray-500">No subtodos yet.</p>
              ) : (
                todo.subtodos?.map((subTodo) => (
                  <label
                    key={subTodo.id}
                    className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
                      checked={subTodo.status === "DONE"}
                      onChange={(event) =>
                        handleSubTodoToggle(subTodo, event.target.checked)
                      }
                      disabled={Boolean(todo.pendingSync || subTodo.pendingSync)}
                    />
                    <div>
                      <p
                        className={`text-sm font-medium ${
                          subTodo.status === "DONE"
                            ? "text-green-600 line-through"
                            : "text-gray-700"
                        }`}
                      >
                        {subTodo.title}
                      </p>
                      {subTodo.description && (
                        <p className="text-xs text-gray-500">
                          {subTodo.description}
                        </p>
                      )}
                      {subTodo.pendingSync && (
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-500">
                          Pending sync
                        </p>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
            <form
              className="mt-4 space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3"
              onSubmit={handleCreateSubTodoSubmit}
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-700">
                  Add Subtodo
                </h4>
              </div>
              <div className="grid gap-2">
                <input
                  type="text"
                  value={subTitle}
                  onChange={(event) => setSubTitle(event.target.value)}
                  placeholder="Subtodo title"
                  disabled={todo.pendingSync}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <textarea
                  value={subDescription}
                  onChange={(event) => setSubDescription(event.target.value)}
                  placeholder="Optional description"
                  disabled={todo.pendingSync}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  rows={2}
                />
              </div>
              {createError && (
                <p className="text-xs text-red-600">{createError}</p>
              )}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isCreatingSubTodo || todo.pendingSync}
                  className="inline-flex items-center justify-center rounded-md bg-brand-500 px-3 py-1 text-sm font-semibold text-white transition hover:bg-brand-500/90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isCreatingSubTodo ? "Adding..." : "Add Subtodo"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
