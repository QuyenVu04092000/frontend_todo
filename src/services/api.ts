export interface TimelineEvent {
  id: number;
  type:
    | "CREATED"
    | "UPDATED"
    | "STATUS_CHANGED"
    | "TIMELINE_UPDATED"
    | "IMAGE_UPDATED"
    | "SUBTODO_ADDED"
    | "SUBTODO_STATUS_CHANGED"
    | string;
  message: string;
  actorUserId?: number | null;
  createdAt: string;
}

export interface Todo {
  id: number;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE" | string;
  parentId?: number | null;
  createdAt: string;
  updatedAt: string;
  subtodos?: Todo[];
  timeline?: TimelineEvent[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ApiError extends Error {
  status?: number;
}

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const TOKEN_STORAGE_KEY = "todo_auth_token";

const jsonHeaders: HeadersInit = {
  Accept: "application/json",
};

let inMemoryToken: string | null = null;

const getStoredToken = (): string | null => {
  if (typeof window === "undefined") {
    return inMemoryToken;
  }
  if (inMemoryToken) {
    return inMemoryToken;
  }
  const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
  inMemoryToken = stored;
  return stored;
};

export const getAuthToken = (): string | null => getStoredToken();

export const setAuthToken = (token: string | null) => {
  inMemoryToken = token;
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
};

export const clearAuthToken = () => {
  setAuthToken(null);
};

export const withAuthHeaders = (headers: HeadersInit = {}) => {
  const token = getStoredToken();
  if (!token) return headers;
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
};

export async function handleResponse<T>(res: Response): Promise<T> {
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // ignore JSON parse failures
  }

  if (!res.ok || payload?.success === false) {
    const message = payload?.message || res.statusText || "Request failed";
    const error: ApiError = new Error(message);
    error.status = res.status;
    if (res.status === 401) {
      clearAuthToken();
    }
    throw error;
  }

  return (payload?.data ?? payload) as T;
}

export async function fetchTodos(): Promise<Todo[]> {
  const res = await fetch(`${API_URL}/api/todos`, {
    method: "GET",
    headers: withAuthHeaders(jsonHeaders),
  });
  return handleResponse<Todo[]>(res);
}

export async function createTodo(data: FormData): Promise<Todo> {
  const res = await fetch(`${API_URL}/api/todos`, {
    method: "POST",
    body: data,
    headers: withAuthHeaders(),
  });
  return handleResponse<Todo>(res);
}

/** Fields the todo detail form can change in one Save. */
export interface TodoChanges {
  title?: string;
  description?: string | null;
  status?: Todo["status"];
  /** `YYYY-MM-DD`, or null to clear. Ignored by the backend for subtodos. */
  startDate?: string | null;
  endDate?: string | null;
  /** A new image to upload. */
  imageFile?: File | null;
  /** Remove the current image (only used when no `imageFile` is sent). */
  removeImage?: boolean;
}

export const OFFLINE_SAVE_MESSAGE = "Không có kết nối, chưa lưu được";

/**
 * Saves every changed field of a todo with a single
 * `PATCH /api/todos/:id` (multipart). Only fields present in `changes`
 * are sent. Not queued offline: the caller shows an error instead.
 */
export async function saveTodo(
  id: number,
  changes: TodoChanges,
): Promise<Todo> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error(OFFLINE_SAVE_MESSAGE);
  }

  const form = new FormData();
  if (typeof changes.title !== "undefined") {
    form.append("title", changes.title);
  }
  if (typeof changes.description !== "undefined") {
    form.append("description", changes.description ?? "");
  }
  if (typeof changes.status !== "undefined") {
    form.append("status", changes.status);
  }
  if (typeof changes.startDate !== "undefined") {
    form.append("startDate", changes.startDate ?? "");
  }
  if (typeof changes.endDate !== "undefined") {
    form.append("endDate", changes.endDate ?? "");
  }
  if (changes.imageFile) {
    form.append("image", changes.imageFile);
  } else if (changes.removeImage) {
    form.append("imageUrl", "");
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/todos/${id}`, {
      method: "PATCH",
      headers: withAuthHeaders(jsonHeaders),
      body: form,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(OFFLINE_SAVE_MESSAGE);
    }
    throw error;
  }
  return handleResponse<Todo>(res);
}

export async function deleteTodo(id: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/todos/${id}`, {
    method: "DELETE",
    headers: withAuthHeaders(jsonHeaders),
  });
  await handleResponse(res);
}

export async function updateTodoStatus(
  id: number,
  status: Todo["status"]
): Promise<Todo> {
  const res = await fetch(`${API_URL}/api/todos/${id}/status`, {
    method: "PATCH",
    headers: withAuthHeaders({
      ...jsonHeaders,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ status }),
  });
  return handleResponse<Todo>(res);
}

export async function updateTodoStatusesBatch(
  updates: Array<{ id: number; status: Todo["status"] }>,
  options: { keepalive?: boolean } = {}
): Promise<void> {
  const requestInit: RequestInit = {
    method: "PATCH",
    headers: withAuthHeaders({
      ...jsonHeaders,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ updates }),
    keepalive: options.keepalive ?? false,
  };

  try {
    const res = await fetch(`${API_URL}/api/todos/batch-update`, requestInit);
    await handleResponse(res);
    return;
  } catch (error) {
    const apiError = error as ApiError;
    if (apiError?.status !== 404) {
      throw error;
    }
  }

  const fallbackRes = await fetch(`${API_URL}/api/todos/status/batch`, {
    ...requestInit,
    method: "POST",
  });
  await handleResponse(fallbackRes);
}
