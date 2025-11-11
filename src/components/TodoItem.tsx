import { useMemo, useState, type FormEvent } from "react";
import {
  calculateTimeline,
  formatDateForDisplay,
  formatDateForInput,
} from "../utils/timeline";
import type { Todo } from "../services/api";

export type TodoFormValues = {
  title?: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  image?: File | null;
  clearStartDate?: boolean;
  clearEndDate?: boolean;
  status?: Todo["status"];
};

interface TodoItemProps {
  todo: Todo;
  onCreateSubTodo: (parentId: number, values: TodoFormValues) => Promise<void>;
  onUpdateTodo: (id: number, values: TodoFormValues) => Promise<void>;
  onDeleteTodo: (id: number) => Promise<void>;
  onUpdateStatus: (todo: Todo, status: Todo["status"]) => Promise<void>;
}

export default function TodoItem({
  todo,
  onCreateSubTodo,
  onUpdateTodo,
  onDeleteTodo,
  onUpdateStatus,
}: TodoItemProps) {
  const [isAddingSub, setIsAddingSub] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [subTitle, setSubTitle] = useState("");
  const [subDescription, setSubDescription] = useState("");
  const [subStartDate, setSubStartDate] = useState("");
  const [subEndDate, setSubEndDate] = useState("");
  const [subImage, setSubImage] = useState<File | null>(null);
  const [editTitle, setEditTitle] = useState(todo.title);
  const [editDescription, setEditDescription] = useState(
    todo.description ?? ""
  );
  const [editStartDate, setEditStartDate] = useState(
    formatDateForInput(todo.startDate)
  );
  const [editEndDate, setEditEndDate] = useState(
    formatDateForInput(todo.endDate)
  );
  const [editImage, setEditImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subError, setSubError] = useState<string | null>(null);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isSubmittingSub, setIsSubmittingSub] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const timeline = useMemo(() => calculateTimeline(todo), [todo]);
  const statusSelectId = useMemo(() => `todo-status-${todo.id}`, [todo.id]);
  const totalSubtodos = todo.subtodos?.length ?? 0;
  const completedSubtodos = useMemo(
    () => todo.subtodos?.filter((sub) => sub.status === "DONE").length ?? 0,
    [todo.subtodos]
  );
  const progressLabel =
    totalSubtodos > 0
      ? `${completedSubtodos}/${totalSubtodos} subtodos done`
      : null;
  const statusClasses =
    todo.status === "DONE"
      ? "text-green-600 line-through"
      : todo.status === "IN_PROGRESS"
      ? "text-yellow-600"
      : "text-gray-800";
  const descriptionClasses =
    todo.status === "DONE" ? "text-gray-400 line-through" : "text-gray-600";
  const timelineClasses =
    todo.status === "DONE" ? "text-sm text-gray-400" : "text-sm text-gray-500";
  const progressClasses =
    todo.status === "DONE" ? "text-xs text-gray-400" : "text-xs text-gray-500";
  const cardClasses = `rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${
    todo.status === "DONE" ? "border-green-200 bg-green-50" : ""
  }`;

  const handleDelete = async () => {
    if (
      !window.confirm(
        "Are you sure you want to delete this todo and its subtodos?"
      )
    )
      return;
    try {
      await onDeleteTodo(todo.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete todo");
    }
  };

  const handleSubTodoSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!subTitle.trim()) {
      setSubError("Title is required");
      return;
    }

    setSubError(null);
    setIsSubmittingSub(true);
    try {
      await onCreateSubTodo(todo.id, {
        title: subTitle.trim(),
        description: subDescription.trim() ? subDescription.trim() : null,
        startDate: subStartDate || null,
        endDate: subEndDate || null,
        image: subImage,
        clearStartDate: subStartDate === "",
        clearEndDate: subEndDate === "",
      });
      setSubTitle("");
      setSubDescription("");
      setSubStartDate("");
      setSubEndDate("");
      setSubImage(null);
      setIsAddingSub(false);
    } catch (err) {
      setSubError(
        err instanceof Error ? err.message : "Failed to create subtodo"
      );
    } finally {
      setIsSubmittingSub(false);
    }
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editTitle.trim()) {
      setError("Title is required");
      return;
    }
    setError(null);
    setIsSubmittingEdit(true);
    try {
      await onUpdateTodo(todo.id, {
        title: editTitle.trim(),
        description: editDescription.trim() ? editDescription.trim() : null,
        startDate: editStartDate || null,
        endDate: editEndDate || null,
        image: editImage,
        clearStartDate: editStartDate === "",
        clearEndDate: editEndDate === "",
      });
      setEditImage(null);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update todo");
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  return (
    <div className={cardClasses}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex-1 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <span className={`text-xl font-semibold ${statusClasses}`}>
                {todo.title}
              </span>
              <div className="flex items-center gap-2">
                <label
                  htmlFor={statusSelectId}
                  className="text-sm text-gray-500"
                >
                  Trạng thái
                </label>
                <select
                  id={statusSelectId}
                  value={todo.status}
                  onChange={(event) =>
                    void (async () => {
                      const nextStatus = event.target.value as Todo["status"];
                      if (nextStatus === todo.status) return;
                      try {
                        setIsUpdatingStatus(true);
                        await onUpdateStatus(todo, nextStatus);
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : "Failed to update todo status"
                        );
                      } finally {
                        setIsUpdatingStatus(false);
                      }
                    })()
                  }
                  disabled={isUpdatingStatus}
                  className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <option value="TODO">Chưa làm</option>
                  <option value="IN_PROGRESS">Đang làm</option>
                  <option value="DONE">Đã làm</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsEditing((prev) => !prev)}
                className="rounded-md border border-transparent bg-brand-500 px-3 py-1 text-sm font-medium text-white transition hover:bg-brand-500/90"
              >
                {isEditing ? "Cancel" : "Edit"}
              </button>
              <button
                type="button"
                onClick={() => setIsAddingSub((prev) => !prev)}
                className="rounded-md border border-brand-500 px-3 py-1 text-sm font-medium text-brand-500 transition hover:bg-brand-500/10"
              >
                {isAddingSub ? "Close" : "Add Subtodo"}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-md border border-red-500 px-3 py-1 text-sm font-medium text-red-500 transition hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>
          </div>

          {todo.description && (
            <p className={descriptionClasses}>{todo.description}</p>
          )}

          {todo.imageUrl && (
            <img
              src={todo.imageUrl}
              alt={todo.title}
              className="h-40 w-40 rounded-lg object-cover shadow"
            />
          )}

          <p className={timelineClasses}>
            Timeline: {formatDateForDisplay(timeline.startDate)} –{" "}
            {formatDateForDisplay(timeline.endDate)}
          </p>
          {progressLabel && <p className={progressClasses}>{progressLabel}</p>}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {isEditing && (
        <form
          onSubmit={handleEditSubmit}
          className="mt-4 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
        >
          <div className="grid gap-1">
            <label
              className="text-sm font-medium text-gray-700"
              htmlFor={`edit-title-${todo.id}`}
            >
              Title
            </label>
            <input
              id={`edit-title-${todo.id}`}
              type="text"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div className="grid gap-1">
            <label
              className="text-sm font-medium text-gray-700"
              htmlFor={`edit-description-${todo.id}`}
            >
              Description
            </label>
            <textarea
              id={`edit-description-${todo.id}`}
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor={`edit-start-${todo.id}`}
              >
                Start date
              </label>
              <input
                id={`edit-start-${todo.id}`}
                type="date"
                value={editStartDate}
                onChange={(event) => setEditStartDate(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
            <div className="grid gap-1">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor={`edit-end-${todo.id}`}
              >
                End date
              </label>
              <input
                id={`edit-end-${todo.id}`}
                type="date"
                value={editEndDate}
                onChange={(event) => setEditEndDate(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>
          <div className="grid gap-1">
            <label
              className="text-sm font-medium text-gray-700"
              htmlFor={`edit-image-${todo.id}`}
            >
              Image
            </label>
            <input
              id={`edit-image-${todo.id}`}
              type="file"
              accept="image/*"
              onChange={(event) =>
                setEditImage(event.target.files?.[0] ?? null)
              }
              className="w-full text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmittingEdit}
            className="inline-flex items-center justify-center rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmittingEdit ? "Saving..." : "Save changes"}
          </button>
        </form>
      )}

      {isAddingSub && (
        <form
          onSubmit={handleSubTodoSubmit}
          className="mt-4 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
        >
          <h3 className="text-sm font-semibold text-gray-800">Add subtodo</h3>
          <div className="grid gap-1">
            <label
              className="text-sm font-medium text-gray-700"
              htmlFor={`sub-title-${todo.id}`}
            >
              Title
            </label>
            <input
              id={`sub-title-${todo.id}`}
              type="text"
              value={subTitle}
              onChange={(event) => setSubTitle(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div className="grid gap-1">
            <label
              className="text-sm font-medium text-gray-700"
              htmlFor={`sub-description-${todo.id}`}
            >
              Description
            </label>
            <textarea
              id={`sub-description-${todo.id}`}
              value={subDescription}
              onChange={(event) => setSubDescription(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor={`sub-start-${todo.id}`}
              >
                Start date
              </label>
              <input
                id={`sub-start-${todo.id}`}
                type="date"
                value={subStartDate}
                onChange={(event) => setSubStartDate(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
            <div className="grid gap-1">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor={`sub-end-${todo.id}`}
              >
                End date
              </label>
              <input
                id={`sub-end-${todo.id}`}
                type="date"
                value={subEndDate}
                onChange={(event) => setSubEndDate(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>
          <div className="grid gap-1">
            <label
              className="text-sm font-medium text-gray-700"
              htmlFor={`sub-image-${todo.id}`}
            >
              Image
            </label>
            <input
              id={`sub-image-${todo.id}`}
              type="file"
              accept="image/*"
              onChange={(event) => setSubImage(event.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          </div>
          {subError && <p className="text-sm text-red-600">{subError}</p>}
          <button
            type="submit"
            disabled={isSubmittingSub}
            className="inline-flex items-center justify-center rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmittingSub ? "Creating..." : "Create subtodo"}
          </button>
        </form>
      )}
    </div>
  );
}
