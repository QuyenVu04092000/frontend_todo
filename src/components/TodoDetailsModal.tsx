import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Todo } from "../services/api";
import { API_URL } from "../services/api";
import { formatDateForDisplay, formatDateForInput } from "../utils/timeline";

interface TodoDetailsModalProps {
  todo: Todo;
  onClose: () => void;
  onUpdateStatus: (todo: Todo, status: Todo["status"]) => Promise<void>;
  onCreateSubTodo: (
    parent: Todo,
    values: { title: string; description?: string }
  ) => Promise<void>;
  onToggleSubTodo: (subTodo: Todo, completed: boolean) => Promise<void>;
  onDeleteTodo: (todo: Todo) => Promise<void>;
  onDeleteSubTodo: (subTodo: Todo) => Promise<void>;
  onUpdateDetails: (
    todo: Todo,
    values: { title: string; description: string | null }
  ) => Promise<void>;
  onUpdateTimeline: (
    todo: Todo,
    values: { startDate: string | null; endDate: string | null }
  ) => Promise<void>;
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
  onDeleteTodo,
  onDeleteSubTodo,
  onUpdateDetails,
  onUpdateTimeline,
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
  const [startInput, setStartInput] = useState<string>(
    formatDateForInput(todo.startDate)
  );
  const [endInput, setEndInput] = useState<string>(
    formatDateForInput(todo.endDate)
  );
  const [isSavingTimeline, setIsSavingTimeline] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineSuccess, setTimelineSuccess] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>(todo.title);
  const [editDescription, setEditDescription] = useState<string>(
    todo.description ?? ""
  );
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsSuccess, setDetailsSuccess] = useState<string | null>(null);

  useEffect(() => {
    setEditTitle(todo.title);
    setEditDescription(todo.description ?? "");
    setDetailsError(null);
    setDetailsSuccess(null);
    setStartInput(formatDateForInput(todo.startDate));
    setEndInput(formatDateForInput(todo.endDate));
    setTimelineError(null);
    setTimelineSuccess(null);
  }, [todo.description, todo.endDate, todo.id, todo.startDate, todo.title]);

  const handleRootStatusChange = async (nextStatus: Todo["status"]) => {
    if (nextStatus === todo.status) return;
    await onUpdateStatus(todo, nextStatus);
  };

  const handleSubTodoToggle = async (subTodo: Todo, checked: boolean) => {
    await onToggleSubTodo(subTodo, checked);
  };

  const handleSubTodoDelete = async (subTodo: Todo) => {
    setCreateError(null);
    try {
      await onDeleteSubTodo(subTodo);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to delete subtodo"
      );
    }
  };

  const handleTodoDelete = async () => {
    try {
      await onDeleteTodo(todo);
      onClose();
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to delete todo"
      );
    }
  };

  const handleDetailsReset = () => {
    setEditTitle(todo.title);
    setEditDescription(todo.description ?? "");
    setDetailsError(null);
    setDetailsSuccess(null);
  };

  const handleDetailsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = editTitle.trim();
    const trimmedDescription = editDescription.trim();
    if (!trimmedTitle) {
      setDetailsError("Title is required");
      setDetailsSuccess(null);
      return;
    }

    const currentDescription = (todo.description ?? "").trim();
    if (
      trimmedTitle === todo.title &&
      trimmedDescription === currentDescription
    ) {
      setDetailsError(null);
      setDetailsSuccess("No changes to save");
      return;
    }

    setIsSavingDetails(true);
    setDetailsError(null);
    setDetailsSuccess(null);

    try {
      await onUpdateDetails(todo, {
        title: trimmedTitle,
        description: trimmedDescription ? trimmedDescription : null,
      });
      setEditTitle(trimmedTitle);
      setEditDescription(trimmedDescription);
      setDetailsSuccess("Todo details updated");
    } catch (error) {
      setDetailsError(
        error instanceof Error ? error.message : "Failed to update todo"
      );
    } finally {
      setIsSavingDetails(false);
    }
  };

  const handleTimelineSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSavingTimeline(true);
    setTimelineError(null);
    setTimelineSuccess(null);

    try {
      await onUpdateTimeline(todo, {
        startDate: startInput ? startInput : null,
        endDate: endInput ? endInput : null,
      });
      setTimelineSuccess("Timeline updated");
    } catch (error) {
      setTimelineError(
        error instanceof Error ? error.message : "Failed to update timeline"
      );
    }

    setIsSavingTimeline(false);
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
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTodoDelete}
              className="rounded-full border border-red-200 px-3 py-1 text-sm font-semibold text-red-500 transition hover:bg-red-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-500 transition hover:bg-gray-100"
            >
              Close
            </button>
          </div>
        </header>

        <div className="space-y-6 p-6">
          <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-sm font-semibold text-gray-700">
              Edit details
            </h3>
            <form onSubmit={handleDetailsSubmit} className="mt-3 space-y-4">
              <div className="grid gap-1">
                <label
                  className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                  htmlFor="todo-title"
                >
                  Title
                </label>
                <input
                  id="todo-title"
                  type="text"
                  value={editTitle}
                  onChange={(event) => {
                    setEditTitle(event.target.value);
                    setDetailsError(null);
                    setDetailsSuccess(null);
                  }}
                  disabled={isSavingDetails}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="Project kickoff"
                />
              </div>
              <div className="grid gap-1">
                <label
                  className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                  htmlFor="todo-description"
                >
                  Description
                </label>
                <textarea
                  id="todo-description"
                  value={editDescription}
                  onChange={(event) => {
                    setEditDescription(event.target.value);
                    setDetailsError(null);
                    setDetailsSuccess(null);
                  }}
                  disabled={isSavingDetails}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-70"
                  rows={4}
                  placeholder="Context, goals, links..."
                />
              </div>
              {(detailsError || detailsSuccess) && (
                <p
                  className={`text-sm ${
                    detailsError ? "text-red-600" : "text-emerald-600"
                  }`}
                >
                  {detailsError ?? detailsSuccess}
                </p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={isSavingDetails}
                  className="inline-flex items-center rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-brand-500/90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSavingDetails ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  onClick={handleDetailsReset}
                  disabled={isSavingDetails}
                  className="rounded-full border border-gray-300 px-4 py-2 text-xs font-medium text-gray-600 transition hover:border-brand-500 hover:text-brand-500 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Reset
                </button>
              </div>
            </form>
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
              {/* <select
                value={todo.status}
                onChange={(event) =>
                  handleRootStatusChange(event.target.value as Todo["status"])
                }
                className="rounded border border-gray-300 px-3 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="TODO">Chưa làm</option>
                <option value="IN_PROGRESS">Đang làm</option>
                <option value="DONE">Đã làm</option>
              </select> */}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-sm font-semibold text-gray-700">Timeline</h3>
            <p className="mt-1 text-xs text-gray-500">
              Set the planned start and end dates for this todo.
            </p>
            <form
              onSubmit={handleTimelineSubmit}
              className="mt-3 grid gap-3 md:grid-cols-2"
            >
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Start date
                <input
                  type="date"
                  value={startInput}
                  onChange={(event) => {
                    setStartInput(event.target.value);
                    setTimelineError(null);
                    setTimelineSuccess(null);
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  disabled={isSavingTimeline}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                End date
                <input
                  type="date"
                  value={endInput}
                  onChange={(event) => {
                    setEndInput(event.target.value);
                    setTimelineError(null);
                    setTimelineSuccess(null);
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  disabled={isSavingTimeline}
                />
              </label>
              <div className="col-span-full flex flex-col gap-2 text-sm">
                {timelineError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-600">
                    {timelineError}
                  </p>
                )}
                {timelineSuccess && (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-600">
                    {timelineSuccess}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={isSavingTimeline}
                  className="self-start rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-brand-500/90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSavingTimeline ? "Saving…" : "Save timeline"}
                </button>
              </div>
            </form>
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
                  <div
                    key={subTodo.id}
                    className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      checked={subTodo.status === "DONE"}
                      onChange={(event) =>
                        handleSubTodoToggle(subTodo, event.target.checked)
                      }
                    />
                    <div className="flex-1">
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
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void handleSubTodoDelete(subTodo);
                      }}
                      className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
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
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <textarea
                  value={subDescription}
                  onChange={(event) => setSubDescription(event.target.value)}
                  placeholder="Optional description"
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  rows={2}
                />
              </div>
              {createError && (
                <p className="text-xs text-red-600">{createError}</p>
              )}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isCreatingSubTodo}
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
