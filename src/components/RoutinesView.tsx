import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createRoutine,
  deleteRoutine,
  fetchRoutines,
  setRoutineCompletion,
  updateRoutine,
  type Routine,
  type RoutineInput,
} from "../services/routines";
import {
  addDays,
  ALL_DAYS,
  bestStreak,
  completionRate,
  currentStreak,
  DAY_LETTER,
  DAY_SHORT,
  describeSchedule,
  HISTORY_DAYS,
  isScheduledOn,
  startOfToday,
  toDateKey,
  trackingStart,
  WEEKDAYS,
} from "../utils/routine";
import { AlertIcon, CheckIcon, PlusIcon, XIcon } from "./icons";
import RoutineFormModal, { type RoutineDraft } from "./RoutineFormModal";

interface RoutinesViewProps {
  /** Bumped by the parent when the server says routines changed (SSE). */
  refreshKey: number;
  /** Bumped by the parent's floating "+" button to open the create form. */
  createSignal: number;
}

const SUGGESTIONS: Array<Partial<RoutineDraft>> = [
  { title: "Drink 2L of water", emoji: "💧", daysOfWeek: ALL_DAYS },
  { title: "Workout", emoji: "🏋️", daysOfWeek: [1, 3, 5], timeOfDay: "18:00" },
  {
    title: "Read 20 pages",
    emoji: "📚",
    daysOfWeek: ALL_DAYS,
    timeOfDay: "21:30",
  },
  {
    title: "Plan tomorrow",
    emoji: "📝",
    daysOfWeek: WEEKDAYS,
    timeOfDay: "22:00",
  },
];

const STRIP_DAYS = 7;

const ProgressRing = ({
  value,
  size = 64,
}: {
  value: number;
  size?: number;
}) => {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={stroke}
        className="fill-none stroke-slate-100"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value)}
        className="fill-none stroke-emerald-500 transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  );
};

export default function RoutinesView({
  refreshKey,
  createSignal,
}: RoutinesViewProps) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(startOfToday);
  const [selectedKey, setSelectedKey] = useState(() =>
    toDateKey(startOfToday()),
  );
  const [formState, setFormState] = useState<
    | { mode: "create"; draft?: Partial<RoutineDraft> | null }
    | { mode: "edit"; routine: Routine }
    | null
  >(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const from = toDateKey(addDays(startOfToday(), -HISTORY_DAYS));
      setRoutines(await fetchRoutines(from));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load routines");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(refreshKey > 0);
  }, [load, refreshKey]);

  // Roll over to the new day if the app stays open past midnight.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = startOfToday();
      if (now.getTime() !== today.getTime()) {
        setSelectedKey((key) =>
          key === toDateKey(today) ? toDateKey(now) : key,
        );
        setToday(now);
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [today]);

  useEffect(() => {
    if (createSignal > 0) setFormState({ mode: "create" });
  }, [createSignal]);

  useEffect(() => {
    if (!formState) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [formState]);

  const todayKey = toDateKey(today);
  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedKey.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [selectedKey]);
  const isSelectedToday = selectedKey === todayKey;

  const active = useMemo(() => routines.filter((r) => r.isActive), [routines]);
  const paused = useMemo(() => routines.filter((r) => !r.isActive), [routines]);
  const scheduled = active.filter((r) => isScheduledOn(r, selectedDate));
  const unscheduled = active.filter((r) => !isScheduledOn(r, selectedDate));
  const doneCount = scheduled.filter((r) =>
    r.completions.includes(selectedKey),
  ).length;

  const stripDays = useMemo(
    () =>
      Array.from({ length: STRIP_DAYS }, (_, index) =>
        addDays(today, index - (STRIP_DAYS - 1)),
      ),
    [today],
  );

  const toggleCompletion = async (routine: Routine, dateKey: string) => {
    const completed = !routine.completions.includes(dateKey);
    const apply = (list: Routine[], done: boolean) =>
      list.map((item) =>
        item.id === routine.id
          ? {
              ...item,
              completions: done
                ? [...item.completions.filter((d) => d !== dateKey), dateKey]
                : item.completions.filter((d) => d !== dateKey),
            }
          : item,
      );

    setRoutines((prev) => apply(prev, completed));
    try {
      await setRoutineCompletion(routine.id, dateKey, completed);
      setError(null);
    } catch (err) {
      setRoutines((prev) => apply(prev, !completed));
      setError(
        err instanceof Error ? err.message : "Couldn't update this routine",
      );
    }
  };

  const handleSubmit = async (input: RoutineInput) => {
    if (formState?.mode === "edit") {
      const updated = await updateRoutine(formState.routine.id, input);
      setRoutines((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
    } else {
      const created = await createRoutine(input);
      setRoutines((prev) => [...prev, created]);
    }
  };

  const handleDelete = async (routine: Routine) => {
    await deleteRoutine(routine.id);
    setRoutines((prev) => prev.filter((item) => item.id !== routine.id));
  };

  const resume = async (routine: Routine) => {
    try {
      const updated = await updateRoutine(routine.id, { isActive: true });
      setRoutines((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't resume routine");
    }
  };

  const sortByTime = (list: Routine[]) =>
    [...list].sort((a, b) =>
      (a.timeOfDay ?? "99:99").localeCompare(b.timeOfDay ?? "99:99"),
    );

  const renderRow = (routine: Routine) => {
    const done = routine.completions.includes(selectedKey);
    const streak = currentStreak(routine, today);
    return (
      <li
        key={routine.id}
        className={`flex items-center gap-3 rounded-xl border bg-white p-3 transition ${
          done ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200/80"
        }`}
      >
        <button
          type="button"
          onClick={() => void toggleCompletion(routine, selectedKey)}
          aria-pressed={done}
          aria-label={
            done ? `Undo ${routine.title}` : `Complete ${routine.title}`
          }
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-90 ${
            done
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-300 text-transparent hover:border-emerald-400 hover:text-emerald-300"
          }`}
        >
          <CheckIcon width={20} height={20} strokeWidth={3} />
        </button>
        <button
          type="button"
          onClick={() => setFormState({ mode: "edit", routine })}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl">
            {routine.emoji ?? "✨"}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate text-[15px] font-semibold ${
                done
                  ? "text-slate-500 line-through decoration-slate-300"
                  : "text-slate-900"
              }`}
            >
              {routine.title}
            </span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {routine.timeOfDay ? `${routine.timeOfDay} · ` : ""}
              {describeSchedule(routine.daysOfWeek)}
            </span>
          </span>
          {streak > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-600"
              title={`${streak}-day streak`}
            >
              🔥 {streak}
            </span>
          )}
        </button>
      </li>
    );
  };

  const overallBest = routines.reduce(
    (max, routine) => Math.max(max, bestStreak(routine, today)),
    0,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
      <section className="space-y-4 lg:col-span-2">
        {/* Day summary + day picker */}
        <div className="panel p-4 md:p-5">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <ProgressRing
                value={scheduled.length ? doneCount / scheduled.length : 0}
              />
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums text-slate-900">
                {doneCount}/{scheduled.length}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {isSelectedToday ? "Today" : DAY_SHORT[selectedDate.getDay()]}
              </p>
              <p className="truncate text-lg font-semibold text-slate-900">
                {selectedDate.toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
              </p>
              <p className="text-sm text-slate-500">
                {isLoading
                  ? "Loading…"
                  : scheduled.length === 0
                    ? "Nothing scheduled"
                    : doneCount === scheduled.length
                      ? "All done — nice work! 🎉"
                      : `${scheduled.length - doneCount} left to do`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFormState({ mode: "create" })}
              className="btn-primary hidden md:inline-flex"
            >
              <PlusIcon width={16} height={16} />
              New routine
            </button>
          </div>

          <div className="no-scrollbar mt-4 grid grid-cols-7 gap-1.5">
            {stripDays.map((day) => {
              const key = toDateKey(day);
              const isSelected = key === selectedKey;
              const dueThatDay = active.filter((r) => isScheduledOn(r, day));
              const doneThatDay = dueThatDay.filter((r) =>
                r.completions.includes(key),
              ).length;
              const allDone =
                dueThatDay.length > 0 && doneThatDay === dueThatDay.length;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(key)}
                  aria-pressed={isSelected}
                  className={`flex flex-col items-center gap-1 rounded-xl py-2 text-xs transition ${
                    isSelected
                      ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30"
                      : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <span className="font-medium">
                    {DAY_LETTER[day.getDay()]}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {day.getDate()}
                  </span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      allDone
                        ? isSelected
                          ? "bg-white"
                          : "bg-emerald-500"
                        : doneThatDay > 0
                          ? isSelected
                            ? "bg-white/60"
                            : "bg-emerald-300"
                          : "bg-transparent"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            <AlertIcon className="mt-0.5 shrink-0" />
            <p className="flex-1">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="-m-1 rounded p-1 text-amber-700 hover:bg-amber-100"
              aria-label="Dismiss"
            >
              <XIcon width={16} height={16} />
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-[70px] animate-pulse rounded-xl border border-slate-200/60 bg-white/70"
              />
            ))}
          </div>
        ) : routines.length === 0 ? (
          <div className="panel p-5 text-center md:p-8">
            <p className="text-3xl">🌱</p>
            <h3 className="mt-2 text-base font-semibold text-slate-900">
              Build your first routine
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Small habits, repeated on the days you choose. Start with one of
              these or create your own.
            </p>
            <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.title}
                  type="button"
                  onClick={() =>
                    setFormState({ mode: "create", draft: suggestion })
                  }
                  className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <span className="text-xl">{suggestion.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {suggestion.title}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {describeSchedule(suggestion.daysOfWeek ?? ALL_DAYS)}
                    </span>
                  </span>
                  <PlusIcon width={16} height={16} className="text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {scheduled.length > 0 ? (
              <ul className="space-y-2">
                {sortByTime(scheduled).map(renderRow)}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                No routines scheduled for this day.
              </p>
            )}

            {unscheduled.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer list-none px-1 text-sm font-medium text-slate-500 hover:text-slate-700">
                  <span className="inline-block transition group-open:rotate-90">
                    ›
                  </span>{" "}
                  Not scheduled this day ({unscheduled.length})
                </summary>
                <ul className="mt-2 space-y-2 opacity-75">
                  {sortByTime(unscheduled).map(renderRow)}
                </ul>
              </details>
            )}

            {paused.length > 0 && (
              <div>
                <p className="mb-2 px-1 text-sm font-medium text-slate-500">
                  Paused ({paused.length})
                </p>
                <ul className="space-y-2">
                  {paused.map((routine) => (
                    <li
                      key={routine.id}
                      className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 px-3 py-2.5"
                    >
                      <span className="text-xl grayscale">
                        {routine.emoji ?? "✨"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setFormState({ mode: "edit", routine })}
                        className="min-w-0 flex-1 truncate text-left text-sm text-slate-500"
                      >
                        {routine.title}
                      </button>
                      <button
                        type="button"
                        onClick={() => void resume(routine)}
                        className="text-xs font-semibold text-brand-500 hover:text-brand-600"
                      >
                        Resume
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {/* Insights */}
      {!isLoading && active.length > 0 && (
        <aside className="space-y-4">
          <div className="panel p-4 md:p-5">
            <h3 className="text-sm font-semibold text-slate-800">
              Last 7 days
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-separate border-spacing-1 text-xs">
                <thead>
                  <tr>
                    <th className="sr-only">Routine</th>
                    {stripDays.map((day) => (
                      <th
                        key={toDateKey(day)}
                        className="w-7 font-medium text-slate-400"
                      >
                        {DAY_LETTER[day.getDay()]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortByTime(active).map((routine) => (
                    <tr key={routine.id}>
                      <td
                        className="max-w-[7rem] truncate pr-1 text-slate-600"
                        title={routine.title}
                      >
                        <span className="mr-1">{routine.emoji ?? "✨"}</span>
                        {routine.title}
                      </td>
                      {stripDays.map((day) => {
                        const key = toDateKey(day);
                        const due =
                          isScheduledOn(routine, day) &&
                          day >= trackingStart(routine);
                        const done = routine.completions.includes(key);
                        const missed = due && !done && key !== todayKey;
                        return (
                          <td key={key} className="p-0">
                            <span
                              title={`${key}: ${
                                done
                                  ? "done"
                                  : missed
                                    ? "missed"
                                    : due
                                      ? "due"
                                      : "rest day"
                              }`}
                              className={`mx-auto block h-6 w-6 rounded-md ${
                                done
                                  ? "bg-emerald-500"
                                  : missed
                                    ? "bg-red-100"
                                    : due
                                      ? "border-2 border-dashed border-slate-300"
                                      : "bg-slate-100"
                              }`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Done
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-red-100" /> Missed
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-100" /> Rest
                day
              </span>
            </div>
          </div>

          <div className="panel p-4 md:p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-slate-800">
                Consistency · 30 days
              </h3>
              {overallBest > 0 && (
                <span className="text-xs text-slate-500">
                  Best streak 🔥 {overallBest}
                </span>
              )}
            </div>
            <ul className="mt-3 space-y-3">
              {sortByTime(active).map((routine) => {
                const rate = completionRate(routine, 30, today);
                return (
                  <li key={routine.id}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate text-slate-600">
                        {routine.emoji ?? "✨"} {routine.title}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-700">
                        {rate === null ? "—" : `${rate}%`}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand-400 to-emerald-500"
                        style={{ width: `${rate ?? 0}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      )}

      {formState && (
        <RoutineFormModal
          routine={formState.mode === "edit" ? formState.routine : null}
          draft={formState.mode === "create" ? formState.draft : null}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
