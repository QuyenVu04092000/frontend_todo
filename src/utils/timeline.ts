import type { Todo } from "../services/api";

const toDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function calculateTimeline(todo: Todo): { startDate: Date | null; endDate: Date | null } {
  if (todo.subtodos?.length) {
    const startDates = todo.subtodos
      .map((st) => toDate(st.startDate))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => a.getTime() - b.getTime());
    const endDates = todo.subtodos
      .map((st) => toDate(st.endDate))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime());

    return {
      startDate: startDates[0] ?? null,
      endDate: endDates[0] ?? null,
    };
  }

  return {
    startDate: toDate(todo.startDate),
    endDate: toDate(todo.endDate),
  };
}

export const formatDateForInput = (value?: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

export const formatDateForDisplay = (value?: Date | string | null): string => {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
};
