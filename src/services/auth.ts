import {
  API_URL,
  clearAuthToken,
  getAuthToken,
  handleResponse,
  setAuthToken,
} from "./api";

export interface AuthenticatedUser {
  id: number;
  email: string;
  name?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSuccessPayload {
  token: string;
  user: AuthenticatedUser;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export const registerUser = async (
  payload: RegisterPayload
): Promise<AuthSuccessPayload> => {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await handleResponse<AuthSuccessPayload>(res);
  setAuthToken(data.token);
  return data;
};

export const loginUser = async (
  payload: LoginPayload
): Promise<AuthSuccessPayload> => {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await handleResponse<AuthSuccessPayload>(res);
  setAuthToken(data.token);
  return data;
};

export const fetchProfile = async (): Promise<AuthenticatedUser> => {
  const token = getAuthToken();
  if (!token) {
    throw Object.assign(new Error("Not authenticated"), { status: 401 });
  }

  const headers: HeadersInit = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(`${API_URL}/api/auth/me`, {
    method: "GET",
    headers,
  });

  return handleResponse<AuthenticatedUser>(res);
};

export const logoutUser = () => {
  clearAuthToken();
};
