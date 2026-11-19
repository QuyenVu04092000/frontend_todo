import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Todo, TodoChanges } from "../services/api";
import { API_URL } from "../services/api";
import { formatDateForInput } from "../utils/timeline";
import {
  ChevronIcon,
  ImageIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "./icons";
import { STATUS_META, STATUS_ORDER } from "./status";

interface TodoDetailsModalProps {
  todo: Todo;
  onClose: () => void;
  /** Saves every changed field of the form in one request. */
  onSave: (todo: Todo, changes: TodoChanges) => Promise<Todo>;
  onCreateSubTodo: (parent: Todo, values: { title: string }) => Promise<void>;
  onToggleSubTodo: (subTodo: Todo, completed: boolean) => Promise<void>;
  onRenameSubTodo: (subTodo: Todo, title: string) => Promise<void>;
  onDeleteTodo: (todo: Todo) => Promise<void>;
  onDeleteSubTodo: (subTodo: Todo) => Promise<void>;
}

const STATUS_TEXT: Record<Todo["status"], string> = {
  TODO: "Chưa làm",
  IN_PROGRESS: "Đang làm",
  DONE: "Đã làm",
};

const DISCARD_CONFIRM = "Bạn có thay đổi chưa lưu. Bỏ thay đổi?";

/** Unsaved edits of the form. Dates are `YYYY-MM-DD` ("" = none). */
interface Draft {
  title: string;
  description: string;
  status: Todo["status"];
  startDate: string;
  endDate: string;
  imageFile: File | null;
  removeImage: boolean;
}

const draftFromTodo = (todo: Todo): Draft => ({
  title: todo.title,
  description: todo.description ?? "",
  status: todo.status,
  startDate: formatDateForInput(todo.startDate),
  endDate: formatDateForInput(todo.endDate),
  imageFile: null,
  removeImage: false,
});

const sameDraft = (a: Draft, b: Draft) =>
  a.title === b.title &&
  a.description === b.description &&
  a.status === b.status &&
  a.startDate === b.startDate &&
  a.endDate === b.endDate &&
  a.imageFile === b.imageFile &&
  a.removeImage === b.removeImage;

/** Only the fields that differ from the saved todo. */
const computeChanges = (draft: Draft, todo: Todo): TodoChanges => {
  const changes: TodoChanges = {};
  const title = draft.title.trim();
  if (title !== todo.title) changes.title = title;

  const description = draft.description.trim();
  if (description !== (todo.description ?? "").trim()) {
    changes.description = description || null;
  }

  if (draft.status !== todo.status) changes.status = draft.status;

  if (draft.startDate !== formatDateForInput(todo.startDate)) {
    changes.startDate = draft.startDate || null;
  }
  if (draft.endDate !== formatDateForInput(todo.endDate)) {
    changes.endDate = draft.endDate || null;
  }

  if (draft.imageFile) {
    changes.imageFile = draft.imageFile;
  } else if (draft.removeImage && todo.imageUrl) {
    changes.removeImage = true;
  }
  return changes;
};

const resolveImageSrc = (imageUrl?: string | null) => {
  if (!imageUrl) return null;
  if (
    imageUrl.startsWith("http://") ||
    imageUrl.startsWith("https://") ||
    imageUrl.startsWith("blob:")
  ) {
    return imageUrl;
  }
  return `${API_URL}${imageUrl}`;
};

type Feedback = { kind: "error" | "success"; text: string } | null;

export default function TodoDetailsModal({
  todo,
  onClose,
  onSave,
  onCreateSubTodo,
  onToggleSubTodo,
  onRenameSubTodo,
  onDeleteTodo,
  onDeleteSubTodo,
}: TodoDetailsModalProps) {
  const createdAt = useMemo(
    () => new Date(todo.createdAt).toLocaleString(),
    [todo.createdAt],
  );

  // ---------- Draft (everything except the checklist) ----------

  const [draft, setDraft] = useState<Draft>(() => draftFromTodo(todo));
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // The saved values the current draft was based on. When the todo changes
  // under us (SSE, checklist actions) we only follow it if the user hasn't
  // edited anything yet; a dirty draft is never overwritten.
  const baseRef = useRef<{ id: number; draft: Draft }>({
    id: todo.id,
    draft: draftFromTodo(todo),
  });
  useEffect(() => {
    const nextBase = draftFromTodo(todo);
    const prev = baseRef.current;
    if (prev.id !== todo.id) {
      setDraft(nextBase);
      setFeedback(null);
    } else {
      setDraft((current) =>
        sameDraft(current, prev.draft) ? nextBase : current,
      );
    }
    baseRef.current = { id: todo.id, draft: nextBase };
  }, [todo]);

  const changes = useMemo(() => computeChanges(draft, todo), [draft, todo]);
  const isDirty = Object.keys(changes).length > 0;

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setFeedback(null);
  };

  const handleDiscard = () => {
    setDraft(draftFromTodo(todo));
    setFeedback(null);
  };

  const handleSave = async () => {
    if (!isDirty || isSaving) return;
    if (!draft.title.trim()) {
      setFeedback({ kind: "error", text: "Tiêu đề không được để trống" });
      return;
    }
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      setFeedback({
        kind: "error",
        text: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc",
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      const updated = await onSave(todo, changes);
      const nextBase = draftFromTodo(updated);
      baseRef.current = { id: updated.id, draft: nextBase };
      setDraft(nextBase);
      setFeedback({ kind: "success", text: "Đã lưu" });
    } catch (error) {
      // Keep the draft so nothing typed is lost.
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Lưu thất bại",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Lets the keyboard shortcut call the latest handleSave.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;

  const requestClose = useCallback(() => {
    if (isDirty && !window.confirm(DISCARD_CONFIRM)) return;
    onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Inline checklist editing handles its own Escape.
        if (event.defaultPrevented) return;
        requestClose();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // ---------- Image preview ----------

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!draft.imageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(draft.imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.imageFile]);

  const displayedImage = draft.imageFile
    ? previewUrl
    : draft.removeImage
      ? null
      : resolveImageSrc(todo.imageUrl);

  // ---------- Notes auto-grow ----------

  const notesRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight excludes borders; add them back so no scrollbar appears.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, [draft.description]);

  // ---------- Checklist ----------
  // The checklist is independent of the draft: tick, add, rename and delete
  // are applied immediately (like Microsoft To Do / Things / TickTick) and
  // never make the form dirty.

  const subtodos = todo.subtodos ?? [];
  const completedCount = subtodos.filter((sub) => sub.status === "DONE").length;
  const checklistProgress = subtodos.length
    ? Math.round((completedCount / subtodos.length) * 100)
    : 0;

  const [newStep, setNewStep] = useState("");
  const newStepRef = useRef<HTMLInputElement>(null);

  const reportError = (error: unknown, fallback: string) =>
    setFeedback({
      kind: "error",
      text: error instanceof Error ? error.message : fallback,
    });

  // The new step shows up optimistically, so clear the input right away and
  // let the user keep typing; put the text back only if the request fails.
  const handleAddStep = async (event?: FormEvent) => {
    event?.preventDefault();
    const title = newStep.trim();
    if (!title) return;
    setNewStep("");
    newStepRef.current?.focus();
    try {
      await onCreateSubTodo(todo, { title });
    } catch (error) {
      setNewStep((current) => current || title);
      reportError(error, "Không thêm được bước");
    }
  };

  const handleToggleStep = async (subTodo: Todo, checked: boolean) => {
    try {
      await onToggleSubTodo(subTodo, checked);
    } catch (error) {
      reportError(error, "Không cập nhật được bước");
    }
  };

  const handleDeleteStep = async (subTodo: Todo) => {
    try {
      await onDeleteSubTodo(subTodo);
    } catch (error) {
      reportError(error, "Không xoá được bước");
    }
  };

  const handleRenameStep = async (subTodo: Todo, title: string) => {
    try {
      await onRenameSubTodo(subTodo, title);
    } catch (error) {
      reportError(error, "Không đổi tên được bước");
    }
  };

  const handleTodoDelete = async () => {
    try {
      await onDeleteTodo(todo);
      onClose();
    } catch (error) {
      reportError(error, "Không xoá được todo");
    }
  };

  // ---------- Activity ----------

  const activity = useMemo(
    () =>
      [...(todo.timeline ?? [])].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [todo.timeline],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="todo-detail-title"
        className="flex h-[94vh] w-full animate-sheet-up flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-slate-300 sm:hidden" />
        <header className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-5 pb-4 pt-3 sm:px-6 sm:pt-5">
          <div className="min-w-0 flex-1">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                STATUS_META[todo.status].badge
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${STATUS_META[todo.status].dot}`}
              />
              {STATUS_TEXT[todo.status]}
            </span>
            <h2
              id="todo-detail-title"
              className="mt-2 break-words text-xl font-semibold leading-tight text-slate-900 sm:text-2xl"
            >
              {todo.title}
            </h2>
            <p className="mt-1 text-xs text-slate-500">Created {createdAt}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleTodoDelete}
              className="icon-btn hover:bg-red-50 hover:text-red-600"
              aria-label="Delete todo"
              title="Delete todo"
            >
              <TrashIcon />
            </button>
            <button
              type="button"
              onClick={requestClose}
              className="icon-btn"
              aria-label="Close"
            >
              <XIcon />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          {/* Title */}
          <div className="grid gap-1.5">
            <label className="field-label" htmlFor="todo-title">
              Title
            </label>
            <input
              id="todo-title"
              type="text"
              value={draft.title}
              onChange={(event) => updateDraft({ title: event.target.value })}
              disabled={isSaving}
              className="field"
              placeholder="Project kickoff"
            />
          </div>

          {/* Status (draft only) */}
          <section>
            <h3 className="field-label mb-2">Status</h3>
            <div
              role="radiogroup"
              aria-label="Status"
              className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1"
            >
              {STATUS_ORDER.map((status) => {
                const isActive = draft.status === status;
                return (
                  <button
                    key={status}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    disabled={isSaving}
                    onClick={() => updateDraft({ status })}
                    className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition ${
                      isActive
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${STATUS_META[status].dot}`}
                    />
                    {STATUS_TEXT[status]}
                  </button>
                );
              })}
            </div>
            {draft.status === "DONE" &&
              todo.status !== "DONE" &&
              completedCount < subtodos.length && (
                <p className="mt-2 text-xs text-slate-500">
                  Khi lưu, mọi bước trong checklist cũng sẽ được đánh dấu xong.
                </p>
              )}
          </section>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <label className="grid min-w-0 gap-1.5">
              <span className="field-label">Start</span>
              <input
                type="date"
                value={draft.startDate}
                max={draft.endDate || undefined}
                onChange={(event) =>
                  updateDraft({ startDate: event.target.value })
                }
                disabled={isSaving}
                className="field min-h-[44px]"
              />
            </label>
            <label className="grid min-w-0 gap-1.5">
              <span className="field-label">End</span>
              <input
                type="date"
                value={draft.endDate}
                min={draft.startDate || undefined}
                onChange={(event) =>
                  updateDraft({ endDate: event.target.value })
                }
                disabled={isSaving}
                className="field min-h-[44px]"
              />
            </label>
          </div>

          {/* Notes */}
          <div className="grid gap-1.5">
            <label className="field-label" htmlFor="todo-notes">
              Notes
            </label>
            <textarea
              id="todo-notes"
              ref={notesRef}
              value={draft.description}
              onChange={(event) =>
                updateDraft({ description: event.target.value })
              }
              disabled={isSaving}
              className="field max-h-80 resize-none overflow-y-auto"
              rows={2}
              placeholder="Thêm ghi chú…"
            />
          </div>

          {/* Checklist (applied immediately, not part of the draft) */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="field-label">Checklist</h3>
              {subtodos.length > 0 && (
                <span className="text-xs font-medium tabular-nums text-slate-500">
                  {completedCount}/{subtodos.length}
                </span>
              )}
            </div>
            {subtodos.length > 0 && (
              <div className="mb-2 h-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${checklistProgress}%` }}
                />
              </div>
            )}
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {subtodos.map((subTodo) => (
                <ChecklistItem
                  key={subTodo.id}
                  item={subTodo}
                  onToggle={handleToggleStep}
                  onRename={handleRenameStep}
                  onDelete={handleDeleteStep}
                />
              ))}
              <li className="bg-white">
                <form
                  onSubmit={handleAddStep}
                  className="flex items-center gap-2 px-3"
                >
                  <PlusIcon
                    width={18}
                    height={18}
                    className="shrink-0 text-slate-400"
                  />
                  <input
                    ref={newStepRef}
                    type="text"
                    value={newStep}
                    onChange={(event) => setNewStep(event.target.value)}
                    placeholder="Thêm bước…"
                    aria-label="Thêm bước"
                    className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none sm:text-sm"
                  />
                  {newStep.trim() && (
                    <button
                      type="submit"
                      className="rounded-md px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50"
                    >
                      Thêm
                    </button>
                  )}
                </form>
              </li>
            </ul>
          </section>

          {/* Image (draft only) */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="field-label">Image</h3>
              {displayedImage && (
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer text-xs font-semibold text-brand-600 hover:text-brand-700">
                    Replace
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      disabled={isSaving}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) {
                          updateDraft({ imageFile: file, removeImage: false });
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() =>
                      updateDraft({
                        imageFile: null,
                        removeImage: Boolean(todo.imageUrl),
                      })
                    }
                    className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
            {displayedImage ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <img
                  src={displayedImage}
                  alt={todo.title}
                  className="max-h-96 w-full object-contain"
                  loading="lazy"
                />
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center transition hover:border-brand-400 hover:bg-brand-50/40">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={isSaving}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) {
                      updateDraft({ imageFile: file, removeImage: false });
                    }
                  }}
                />
                <ImageIcon
                  width={28}
                  height={28}
                  className="mb-2 text-slate-400"
                />
                <span className="text-sm font-medium text-slate-700">
                  Tap to choose an image
                </span>
                <span className="mt-1 text-xs text-slate-400">
                  PNG, JPG, GIF up to 5MB
                </span>
              </label>
            )}
          </section>

          {/* Activity */}
          {activity.length > 0 && (
            <details className="group rounded-xl border border-slate-200">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
                <ChevronIcon
                  width={16}
                  height={16}
                  className="text-slate-400 transition-transform group-open:rotate-90"
                />
                Activity
                <span className="font-normal text-slate-400">
                  ({activity.length})
                </span>
              </summary>
              <ol className="space-y-2.5 border-t border-slate-100 px-3 py-3">
                {activity.map((event) => (
                  <li key={event.id} className="flex gap-2.5 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                    <div className="min-w-0">
                      <p className="break-words text-slate-700">
                        {event.message}
                      </p>
                      <p className="text-xs text-slate-400">
                        {new Date(event.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>

        {/* Sticky footer: one message area + Discard / Save */}
        <footer className="pb-safe shrink-0 border-t border-slate-100 bg-slate-50/80 px-5 pt-3 sm:px-6 sm:pb-4">
          {feedback && (
            <p
              role={feedback.kind === "error" ? "alert" : "status"}
              className={`mb-3 rounded-lg px-3 py-2 text-sm ${
                feedback.kind === "error"
                  ? "border border-red-200 bg-red-50 text-red-700"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {feedback.text}
            </p>
          )}
          <div className="flex items-center gap-3">
            <span
              className={`hidden text-xs font-medium sm:block ${
                isDirty ? "text-amber-600" : "text-slate-400"
              }`}
            >
              {isDirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <div className="flex flex-1 items-center gap-2 sm:flex-none sm:justify-end sm:ml-auto">
              <button
                type="button"
                onClick={handleDiscard}
                disabled={!isDirty || isSaving}
                className="btn-secondary flex-1 sm:flex-none"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!isDirty || isSaving}
                className="btn-primary flex-1 sm:flex-none"
                title="Save (Ctrl/⌘ + Enter)"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

interface ChecklistItemProps {
  item: Todo;
  onToggle: (item: Todo, checked: boolean) => Promise<void>;
  onRename: (item: Todo, title: string) => Promise<void>;
  onDelete: (item: Todo) => Promise<void>;
}

/** One checklist step: checkbox, inline-editable name, delete. */
function ChecklistItem({
  item,
  onToggle,
  onRename,
  onDelete,
}: ChecklistItemProps) {
  const isDone = item.status === "DONE";
  const isPending = item.id < 0;
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(item.title);
  // Set when Esc/Enter already finished the edit, so the blur that follows
  // doesn't save again.
  const finishedRef = useRef(false);

  const startEditing = () => {
    if (isPending) return;
    finishedRef.current = false;
    setValue(item.title);
    setIsEditing(true);
  };

  const commit = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setIsEditing(false);
    const title = value.trim();
    if (title && title !== item.title) void onRename(item, title);
  };

  const cancel = () => {
    finishedRef.current = true;
    setIsEditing(false);
    setValue(item.title);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      // Keep the modal open: only leave edit mode.
      event.preventDefault();
      event.nativeEvent.stopImmediatePropagation();
      cancel();
    }
  };

  return (
    <li className="group/step flex items-center gap-3 bg-white px-3 py-1.5">
      <input
        type="checkbox"
        className="h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 accent-brand-500 disabled:cursor-default"
        checked={isDone}
        disabled={isPending}
        onChange={(event) => void onToggle(item, event.target.checked)}
        aria-label={`Mark ${item.title} as done`}
      />
      {isEditing ? (
        <input
          type="text"
          autoFocus
          onFocus={(event) => event.target.select()}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-label="Tên bước"
          className="min-w-0 flex-1 rounded-md border border-brand-300 px-2 py-1 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className={`min-w-0 flex-1 cursor-text break-words py-1 text-left text-sm ${
            isDone ? "text-slate-400 line-through" : "text-slate-800"
          }`}
          title="Bấm để sửa tên"
        >
          {item.title}
        </button>
      )}
      <button
        type="button"
        onClick={() => void onDelete(item)}
        disabled={isPending}
        className="icon-btn h-8 w-8 shrink-0 hover:bg-red-50 hover:text-red-600 md:opacity-0 md:focus:opacity-100 md:group-hover/step:opacity-100"
        aria-label={`Delete ${item.title}`}
      >
        <TrashIcon width={15} height={15} />
      </button>
    </li>
  );
}
