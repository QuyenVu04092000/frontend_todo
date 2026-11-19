import { API_URL, handleResponse, withAuthHeaders } from "./api";

export interface Routine {
  id: number;
  title: string;
  description: string | null;
  emoji: string | null;
  /** 0 = Sunday ... 6 = Saturday */
  daysOfWeek: number[];
  /** "HH:MM" (24h) */
  timeOfDay: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Local dates "YYYY-MM-DD" the routine was completed. */
  completions: string[];
}

export interface RoutineInput {
  title?: string;
  description?: string | null;
  emoji?: string | null;
  daysOfWeek?: number[];
  timeOfDay?: string | null;
  isActive?: boolean;
}

const jsonHeaders = () =>
  withAuthHeaders({
    Accept: "application/json",
    "Content-Type": "application/json",
  });

export async function fetchRoutines(from?: string): Promise<Routine[]> {
  const url = new URL("/api/routines", API_URL);
  if (from) url.searchParams.set("from", from);
  const res = await fetch(url.toString(), { headers: jsonHeaders() });
  return handleResponse<Routine[]>(res);
}

export async function createRoutine(input: RoutineInput): Promise<Routine> {
  const res = await fetch(`${API_URL}/api/routines`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  return handleResponse<Routine>(res);
}

export async function updateRoutine(
  id: number,
  input: RoutineInput,
): Promise<Routine> {
  const res = await fetch(`${API_URL}/api/routines/${id}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  return handleResponse<Routine>(res);
}

export async function deleteRoutine(id: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/routines/${id}`, {
    method: "DELETE",
    headers: jsonHeaders(),
  });
  await handleResponse<unknown>(res);
}

export async function setRoutineCompletion(
  id: number,
  date: string,
  completed: boolean,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/routines/${id}/completions/${date}`, {
    method: completed ? "PUT" : "DELETE",
    headers: jsonHeaders(),
  });
  await handleResponse<unknown>(res);
}
