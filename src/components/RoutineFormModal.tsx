import { useEffect, useState, type FormEvent } from "react";

import type { Routine, RoutineInput } from "../services/routines";
import {
  ALL_DAYS,
  DAY_LETTER,
  DAY_SHORT,
  WEEKDAYS,
  WEEKENDS,
  WEEK_ORDER,
} from "../utils/routine";
import { TrashIcon, XIcon } from "./icons";

const EMOJIS = [
  "🏃",
  "💧",
  "📚",
  "🧘",
  "🏋️",
  "🥗",
  "😴",
  "📝",
  "💊",
  "🧹",
  "🎸",
  "💻",
];

const PRESETS: Array<{ label: string; days: number[] }> = [
  { label: "Every day", days: ALL_DAYS },
  { label: "Weekdays", days: WEEKDAYS },
  { label: "Weekends", days: WEEKENDS },
];

const sameDays = (a: number[], b: number[]) =>
  a.length === b.length && a.every((day) => b.includes(day));

export interface RoutineDraft {
  title: string;
  emoji: string | null;
  description: string;
  daysOfWeek: number[];
  timeOfDay: string;
}

interface RoutineFormModalProps {
  routine?: Routine | null;
  /** Prefill for a new routine (e.g. from a suggestion). */
  draft?: Partial<RoutineDraft> | null;
  onClose: () => void;
  onSubmit: (input: RoutineInput) => Promise<void>;
  onDelete?: (routine: Routine) => Promise<void>;
}

export default function RoutineFormModal({
  routine,
  draft,
  onClose,
  onSubmit,
  onDelete,
}: RoutineFormModalProps) {
  const isEdit = Boolean(routine);
  const [title, setTitle] = useState(routine?.title ?? draft?.title ?? "");
  const [emoji, setEmoji] = useState<string | null>(
    routine?.emoji ?? draft?.emoji ?? null,
  );
  const [description, setDescription] = useState(
    routine?.description ?? draft?.description ?? "",
  );
  const [days, setDays] = useState<number[]>(
    routine?.daysOfWeek ?? draft?.daysOfWeek ?? ALL_DAYS,
  );
  const [timeOfDay, setTimeOfDay] = useState(
    routine?.timeOfDay ?? draft?.timeOfDay ?? "",
  );
  const [isActive, setIsActive] = useState(routine?.isActive ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleDay = (day: number) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("Give your routine a name");
      return;
    }
    if (days.length === 0) {
      setError("Pick at least one day");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        emoji,
        description: description.trim() || null,
        daysOfWeek: [...days].sort(),
        timeOfDay: timeOfDay || null,
        ...(isEdit ? { isActive } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save routine");
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!routine || !onDelete) return;
    if (
      !window.confirm(
        `Delete "${routine.title}"? Its check-in history will be removed too.`,
      )
    ) {
      return;
    }
    setIsSaving(true);
    try {
      await onDelete(routine);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete routine");
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-form-title"
        className="flex max-h-[92vh] w-full animate-sheet-up flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-slate-300 sm:hidden" />
        <header className="flex items-center justify-between px-5 pb-3 pt-3 sm:px-6 sm:pt-5">
          <h2
            id="routine-form-title"
            className="text-lg font-semibold text-slate-900"
          >
            {isEdit ? "Edit routine" : "New routine"}
          </h2>
          <div className="flex items-center gap-1">
            {isEdit && onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSaving}
                className="icon-btn hover:bg-red-50 hover:text-red-600"
                aria-label="Delete routine"
                title="Delete routine"
              >
                <TrashIcon />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="icon-btn"
              aria-label="Close"
            >
              <XIcon />
            </button>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-4 sm:px-6">
            <div className="grid gap-1.5">
              <label className="field-label" htmlFor="routine-title">
                Name
              </label>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xl">
                  {emoji ?? "✨"}
                </span>
                <input
                  id="routine-title"
                  type="text"
                  autoFocus={!isEdit}
                  value={title}
                  maxLength={120}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setError(null);
                  }}
                  className="field"
                  placeholder="e.g. Morning run"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <span className="field-label">Icon</span>
              <div className="flex flex-wrap gap-1.5">
                {EMOJIS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setEmoji(item === emoji ? null : item)}
                    aria-pressed={item === emoji}
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-xl text-lg transition ${
                      item === emoji
                        ? "bg-brand-100 ring-2 ring-brand-500"
                        : "bg-slate-100 hover:bg-slate-200"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <span className="field-label">Repeat</span>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((preset) => {
                  const active = sameDays(days, preset.days);
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setDays(preset.days)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                        active
                          ? "bg-brand-500 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEK_ORDER.map((day) => {
                  const active = days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      aria-pressed={active}
                      aria-label={DAY_SHORT[day]}
                      title={DAY_SHORT[day]}
                      className={`flex h-10 items-center justify-center rounded-xl text-sm font-semibold transition ${
                        active
                          ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                    >
                      <span className="sm:hidden">{DAY_LETTER[day]}</span>
                      <span className="hidden sm:inline">{DAY_SHORT[day]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid min-w-0 gap-1.5">
                <label className="field-label" htmlFor="routine-time">
                  Time (optional)
                </label>
                <input
                  id="routine-time"
                  type="time"
                  value={timeOfDay}
                  onChange={(event) => setTimeOfDay(event.target.value)}
                  className="field min-h-[44px]"
                />
              </div>
              {isEdit && (
                <div className="grid min-w-0 gap-1.5">
                  <span className="field-label">Status</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    onClick={() => setIsActive((prev) => !prev)}
                    className="flex min-h-[44px] items-center justify-between rounded-xl border border-slate-200 px-3.5 text-sm font-medium text-slate-700"
                  >
                    {isActive ? "Active" : "Paused"}
                    <span
                      className={`relative h-6 w-10 rounded-full transition ${
                        isActive ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                          isActive ? "left-[18px]" : "left-0.5"
                        }`}
                      />
                    </span>
                  </button>
                </div>
              )}
            </div>

            <div className="grid gap-1.5">
              <label className="field-label" htmlFor="routine-description">
                Note (optional)
              </label>
              <textarea
                id="routine-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="field resize-none"
                rows={2}
                maxLength={1000}
                placeholder="Why it matters, how to do it…"
              />
            </div>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>

          <div className="pb-safe flex items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-5 pt-4 sm:justify-end sm:px-6 sm:pb-4">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1 sm:flex-none"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="btn-primary flex-1 sm:flex-none"
            >
              {isSaving
                ? "Saving…"
                : isEdit
                  ? "Save routine"
                  : "Create routine"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
