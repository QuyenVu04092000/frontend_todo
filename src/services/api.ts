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

const withAuthHeaders = (headers: HeadersInit = {}) => {
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

export async function updateTodo(
  id: number,
  payload: {
    title?: string | null;
    description?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  }
): Promise<Todo> {
  const res = await fetch(`${API_URL}/api/todos/${id}`, {
    method: "PATCH",
    headers: withAuthHeaders({
      ...jsonHeaders,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
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
