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
  pendingSync?: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const jsonHeaders = {
  Accept: "application/json",
};

async function handleResponse<T>(res: Response): Promise<T> {
  let payload: any = null;
  try {
    payload = await res.json();
  } catch (error) {
    // ignore JSON parsing errors
  }

  if (!res.ok) {
    const message = payload?.message || res.statusText || "Request failed";
    throw new Error(message);
  }

  if (payload?.success === false) {
    throw new Error(payload?.message || "Request failed");
  }

  return (payload?.data ?? payload) as T;
}

export async function fetchTodos(): Promise<Todo[]> {
  const res = await fetch(`${API_URL}/api/todos`, {
    method: "GET",
    headers: jsonHeaders,
  });
  return handleResponse<Todo[]>(res);
}

export async function createTodo(data: FormData): Promise<Todo> {
  const res = await fetch(`${API_URL}/api/todos`, {
    method: "POST",
    body: data,
  });
  return handleResponse<Todo>(res);
}

export async function updateTodo(id: number, data: FormData): Promise<Todo> {
  const res = await fetch(`${API_URL}/api/todos/${id}`, {
    method: "PUT",
    body: data,
  });
  return handleResponse<Todo>(res);
}

export async function deleteTodo(id: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/todos/${id}`, {
    method: "DELETE",
    headers: jsonHeaders,
  });
  await handleResponse(res);
}

export async function updateTodoStatus(
  id: number,
  status: Todo["status"]
): Promise<Todo> {
  const res = await fetch(`${API_URL}/api/todos/${id}/status`, {
    method: "PATCH",
    headers: {
      ...jsonHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  return handleResponse<Todo>(res);
}
