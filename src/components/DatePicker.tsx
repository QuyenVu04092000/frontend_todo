import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { CalendarIcon, ChevronIcon, XIcon } from "./icons";

/**
 * Calendar date picker that replaces `<input type="date">`.
 * Value is a local date string `YYYY-MM-DD` ("" = no date).
 * The popover is portaled to <body> so scrollable modals can't clip it.
 */
interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Earliest / latest selectable day (`YYYY-MM-DD`). */
  min?: string;
  max?: string;
  /** Other end of a start/end pair: days in between get a soft highlight. */
  rangeWith?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const POPOVER_WIDTH = 296;
const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (key: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
};
const addDays = (d: Date, days: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, months: number) =>
  new Date(d.getFullYear(), d.getMonth() + months, 1);
const todayKey = () => toKey(new Date());

const displayFormat = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const formatMonth = (d: Date) =>
  `Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
const fullFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "full" });

/** 6 weeks starting on the Monday on/before the 1st of the month. */
const buildMonthGrid = (month: Date): Date[] => {
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const gridStart = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
};

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  rangeWith,
  placeholder = "Chọn ngày",
  disabled,
  id,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const selected = fromKey(value);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(() =>
    startOfMonth(selected ?? new Date()),
  );
  const [focusKey, setFocusKey] = useState<string>(value || todayKey());
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    placement: "below" | "above";
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();

  const isDisabledDay = useCallback(
    (key: string) => Boolean((min && key < min) || (max && key > max)),
    [min, max],
  );

  const openPicker = () => {
    if (disabled) return;
    const base = selected ?? fromKey(rangeWith ?? "") ?? new Date();
    setViewMonth(startOfMonth(base));
    setFocusKey(value || toKey(base));
    setOpen(true);
  };

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const select = (key: string) => {
    if (isDisabledDay(key)) return;
    onChange(key);
    close();
  };

  // Place the popover under the field (or above when there's no room),
  // clamped horizontally to the viewport.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popHeight = popoverRef.current?.offsetHeight ?? 360;
    const width = Math.min(
      POPOVER_WIDTH,
      window.innerWidth - VIEWPORT_MARGIN * 2,
    );
    let left = rect.left;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, rect.right - width);
    }
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement =
      spaceBelow < popHeight + POPOVER_GAP && rect.top > spaceBelow
        ? "above"
        : "below";
    const top =
      placement === "below"
        ? rect.bottom + POPOVER_GAP
        : Math.max(VIEWPORT_MARGIN, rect.top - popHeight - POPOVER_GAP);
    setPosition({ top, left, placement });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
    // Re-measure once the popover has rendered with its real height.
    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition, viewMonth]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      close(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close]);

  // Keep keyboard focus on the focused day.
  useEffect(() => {
    if (!open || !position) return;
    const button = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-day="${focusKey}"]`,
    );
    button?.focus({ preventScroll: true });
  }, [open, position, focusKey, viewMonth]);

  const moveFocus = (days: number) => {
    const current = fromKey(focusKey) ?? new Date();
    const next = addDays(current, days);
    setFocusKey(toKey(next));
    if (
      next.getMonth() !== viewMonth.getMonth() ||
      next.getFullYear() !== viewMonth.getFullYear()
    ) {
      setViewMonth(startOfMonth(next));
    }
  };

  const onPopoverKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const handled: Record<string, () => void> = {
      ArrowLeft: () => moveFocus(-1),
      ArrowRight: () => moveFocus(1),
      ArrowUp: () => moveFocus(-7),
      ArrowDown: () => moveFocus(7),
      PageUp: () => {
        const prev = addMonths(viewMonth, -1);
        setViewMonth(prev);
        setFocusKey(toKey(prev));
      },
      PageDown: () => {
        const next = addMonths(viewMonth, 1);
        setViewMonth(next);
        setFocusKey(toKey(next));
      },
      Escape: () => close(),
    };
    const action = handled[event.key];
    if (!action) return;
    // Esc closes only the calendar, never the surrounding modal.
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    action();
  };

  const days = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const today = todayKey();
  const rangeLow =
    value && rangeWith ? (value < rangeWith ? value : rangeWith) : "";
  const rangeHigh =
    value && rangeWith ? (value < rangeWith ? rangeWith : value) : "";

  const quickPicks = [
    { label: "Hôm nay", key: today },
    { label: "Ngày mai", key: toKey(addDays(new Date(), 1)) },
    { label: "Tuần sau", key: toKey(addDays(new Date(), 7)) },
  ];

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={
          ariaLabel
            ? `${ariaLabel}: ${selected ? fullFormat.format(selected) : "chưa chọn"}`
            : undefined
        }
        className={`field flex min-h-[44px] items-center gap-2 pr-9 text-left disabled:cursor-not-allowed disabled:opacity-60 ${
          open ? "border-brand-400 ring-4 ring-brand-500/15" : ""
        }`}
      >
        <CalendarIcon
          width={16}
          height={16}
          className={`shrink-0 ${selected ? "text-brand-500" : "text-slate-400"}`}
        />
        <span
          className={`min-w-0 flex-1 truncate ${
            selected ? "text-slate-800" : "text-slate-400"
          }`}
        >
          {selected ? displayFormat.format(selected) : placeholder}
        </span>
      </button>
      {selected && !disabled && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label={ariaLabel ? `Xoá ${ariaLabel}` : "Xoá ngày"}
        >
          <XIcon width={13} height={13} />
        </button>
      )}

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            id={dialogId}
            role="dialog"
            aria-modal="false"
            aria-label={ariaLabel ?? "Chọn ngày"}
            onKeyDown={onPopoverKeyDown}
            style={{
              position: "fixed",
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              width: Math.min(
                POPOVER_WIDTH,
                window.innerWidth - VIEWPORT_MARGIN * 2,
              ),
              visibility: position ? "visible" : "hidden",
            }}
            className={`z-[70] rounded-2xl border border-slate-200 bg-white p-3 shadow-lift ${
              position?.placement === "above" ? "origin-bottom" : "origin-top"
            } animate-fade-in`}
          >
            {/* Month navigation */}
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setViewMonth((m) => addMonths(m, -1))}
                className="icon-btn h-8 w-8"
                aria-label="Tháng trước"
              >
                <ChevronIcon width={16} height={16} className="rotate-180" />
              </button>
              <p
                className="text-sm font-semibold text-slate-900"
                aria-live="polite"
              >
                {formatMonth(viewMonth)}
              </p>
              <button
                type="button"
                onClick={() => setViewMonth((m) => addMonths(m, 1))}
                className="icon-btn h-8 w-8"
                aria-label="Tháng sau"
              >
                <ChevronIcon width={16} height={16} />
              </button>
            </div>

            {/* Weekday header */}
            <div className="grid grid-cols-7 pb-1">
              {WEEKDAYS.map((day, index) => (
                <span
                  key={day}
                  className={`text-center text-[11px] font-semibold uppercase tracking-wide ${
                    index >= 5 ? "text-rose-400" : "text-slate-400"
                  }`}
                >
                  {day}
                </span>
              ))}
            </div>

            {/* Days */}
            <div
              ref={gridRef}
              role="grid"
              className="grid grid-cols-7 gap-y-0.5"
            >
              {days.map((day) => {
                const key = toKey(day);
                const inMonth = day.getMonth() === viewMonth.getMonth();
                const isSelected = key === value;
                const isRangeEnd = Boolean(rangeWith) && key === rangeWith;
                const inRange =
                  Boolean(rangeLow) && key > rangeLow && key < rangeHigh;
                const isToday = key === today;
                const isOff = isDisabledDay(key);
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                return (
                  <div
                    key={key}
                    className={`flex justify-center ${
                      inRange ? "bg-brand-50" : ""
                    } ${
                      inRange && day.getDay() === 1 ? "rounded-l-full" : ""
                    } ${inRange && day.getDay() === 0 ? "rounded-r-full" : ""}`}
                  >
                    <button
                      type="button"
                      data-day={key}
                      tabIndex={key === focusKey ? 0 : -1}
                      disabled={isOff}
                      onClick={() => select(key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          select(key);
                        }
                      }}
                      aria-pressed={isSelected}
                      aria-label={fullFormat.format(day)}
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-sm tabular-nums transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                        isSelected
                          ? "bg-brand-500 font-semibold text-white shadow-sm shadow-brand-500/30"
                          : isRangeEnd
                            ? "bg-brand-100 font-semibold text-brand-700"
                            : isOff
                              ? "cursor-not-allowed text-slate-300 line-through decoration-slate-200"
                              : inMonth
                                ? `${isWeekend ? "text-rose-500" : "text-slate-700"} hover:bg-slate-100`
                                : "text-slate-300 hover:bg-slate-50"
                      } ${
                        isToday && !isSelected
                          ? "ring-1 ring-inset ring-brand-400 font-semibold"
                          : ""
                      }`}
                    >
                      {day.getDate()}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Quick picks */}
            <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-3">
              {quickPicks.map((pick) => (
                <button
                  key={pick.label}
                  type="button"
                  disabled={isDisabledDay(pick.key)}
                  onClick={() => select(pick.key)}
                  className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-brand-50 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pick.label}
                </button>
              ))}
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    close();
                  }}
                  className="ml-auto whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-50"
                >
                  Xoá
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
