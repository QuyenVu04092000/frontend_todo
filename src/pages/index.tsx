import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  closestCorners,
  DndContext,
  PointerSensor,
  defaultDropAnimation,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import { useRouter } from "next/router";

import type { ApiError, Todo } from "../services/api";
import {
  createTodo,
  fetchTodos,
  updateTodoStatus,
  updateTodoStatusesBatch,
  getAuthToken,
  API_URL,
  updateTodo,
  updateTodoWithImage,
  deleteTodo,
} from "../services/api";
import type { TodoFormValues } from "../components/TodoItem";
import KanbanColumn from "../components/KanbanColumn";
import DraggableTodoCard from "../components/DraggableTodoCard";
import TodoDetailsModal from "../components/TodoDetailsModal";
import {
  enqueueOperation,
  consumeQueue,
  pushBackQueue,
  type SerializedTodoPayload,
  type OfflineOperation,
} from "../utils/offlineQueue";
import { useAuth } from "../context/AuthContext";

interface DeferredPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface RootFormState {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  image: File | null;
}

const initialRootForm: RootFormState = {
  title: "",
  description: "",
  startDate: "",
  endDate: "",
  image: null,
};

const LOCAL_CACHE_KEY = "todo_cached_todos_v1";

const STATUS_COLUMNS: Array<{
  id: Todo["status"];
  title: string;
  accentClass: string;
}> = [
  { id: "TODO", title: "Todo", accentClass: "text-gray-500" },
  { id: "IN_PROGRESS", title: "In Progress", accentClass: "text-yellow-600" },
  { id: "DONE", title: "Done", accentClass: "text-green-600" },
];

const cloneTodos = (list: Todo[]): Todo[] =>
  list.map((todo) => ({
    ...todo,
    subtodos: todo.subtodos ? cloneTodos(todo.subtodos) : todo.subtodos,
  }));

const removeTodoFromTree = (list: Todo[], targetId: number): Todo[] =>
  list
    .filter((todo) => todo.id !== targetId)
    .map((todo) => ({
      ...todo,
      subtodos: todo.subtodos
        ? removeTodoFromTree(todo.subtodos, targetId)
        : todo.subtodos,
    }));

const addSubTodoToParent = (
  list: Todo[],
  parentId: number,
  subTodo: Todo
): Todo[] =>
  list.map((todo) => {
    if (todo.id === parentId) {
      return {
        ...todo,
        subtodos: [...(todo.subtodos ?? []), subTodo],
      };
    }
    if (todo.subtodos?.length) {
      return {
        ...todo,
        subtodos: addSubTodoToParent(todo.subtodos, parentId, subTodo),
      };
    }
    return todo;
  });

const upsertTodoInTree = (list: Todo[], updated: Todo): Todo[] =>
  list.map((todo) => {
    if (todo.id === updated.id) {
      return updated;
    }
    if (todo.subtodos?.length) {
      return {
        ...todo,
        subtodos: upsertTodoInTree(todo.subtodos, updated),
      };
    }
    return todo;
  });

const applyStatusToList = (
  list: Todo[],
  targetId: number,
  status: Todo["status"]
): Todo[] =>
  list.map((todo) => {
    if (todo.id === targetId) {
      const subtodos =
        status === "DONE"
          ? todo.subtodos?.map((sub) => ({
              ...sub,
              status: "DONE",
            }))
          : todo.subtodos;
      return {
        ...todo,
        status,
        subtodos,
      };
    }

    if (todo.subtodos?.some((sub) => sub.id === targetId)) {
      return {
        ...todo,
        subtodos: todo.subtodos.map((sub) =>
          sub.id === targetId
            ? {
                ...sub,
                status,
              }
            : sub
        ),
      };
    }

    return todo;
  });

const applyMetaToList = (
  list: Todo[],
  targetId: number,
  updates: Partial<
    Pick<Todo, "title" | "description" | "startDate" | "endDate">
  >
): Todo[] =>
  list.map((todo) => {
    if (todo.id === targetId) {
      return { ...todo, ...updates };
    }
    if (todo.subtodos?.length) {
      return {
        ...todo,
        subtodos: applyMetaToList(todo.subtodos, targetId, updates),
      };
    }
    return todo;
  });

const STATUS_QUEUE_STORAGE_KEY = "todo_status_queue_v1";

interface StatusUpdateRequest {
  todoId: number;
  status: Todo["status"];
  snapshot: Todo[];
}

const isOfflineError = (error: unknown) =>
  typeof window !== "undefined" &&
  (!navigator.onLine ||
    (error instanceof TypeError && error.message === "Failed to fetch"));

const buildFormData = (values: TodoFormValues, parentId?: number): FormData => {
  const form = new FormData();

  if (typeof values.title !== "undefined") {
    form.append("title", values.title);
  }

  if (typeof values.description !== "undefined") {
    form.append("description", values.description ?? "");
  }

  if (values.clearStartDate) {
    form.append("startDate", "");
  } else if (values.startDate) {
    form.append("startDate", values.startDate);
  }

  if (values.clearEndDate) {
    form.append("endDate", "");
  } else if (values.endDate) {
    form.append("endDate", values.endDate);
  }

  if (values.image) {
    form.append("image", values.image);
  }

  if (values.status) {
    form.append("status", values.status);
  }

  if (typeof parentId !== "undefined") {
    form.append("parentId", String(parentId));
  }

  return form;
};

const normalizeTodo = (input: any): Todo => {
  const normalized: Todo = {
    id: typeof input.id === "number" ? input.id : Number(input.id),
    title: input.title ?? "Untitled",
    description:
      typeof input.description === "string" &&
      input.description.trim().length > 0
        ? input.description
        : null,
    status: (input.status as Todo["status"]) ?? "TODO",
    parentId:
      typeof input.parentId === "number"
        ? input.parentId
        : input.parentId ?? null,
    imageUrl: input.imageUrl ?? undefined,
    startDate: input.startDate ?? undefined,
    endDate: input.endDate ?? undefined,
    createdAt:
      typeof input.createdAt === "string"
        ? input.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof input.updatedAt === "string"
        ? input.updatedAt
        : new Date().toISOString(),
    subtodos: Array.isArray(input.subtodos)
      ? input.subtodos.map((sub: any) => normalizeTodo(sub))
      : [],
    timeline: Array.isArray(input.timeline)
      ? input.timeline.map((event: any) => ({
          id: event.id,
          type: event.type,
          message: event.message,
          actorUserId:
            typeof event.actorUserId === "number"
              ? event.actorUserId
              : event.actorUserId ?? null,
          createdAt:
            typeof event.createdAt === "string"
              ? event.createdAt
              : new Date(event.createdAt).toISOString(),
        }))
      : [],
  };

  return normalized;
};

const normalizeDateInput = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading, user, logout } = useAuth();

  const [todos, setTodos] = useState<Todo[]>([]);
  const todosRef = useRef<Todo[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasRestoredStatusQueueRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState<RootFormState>(initialRootForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTodoId, setSelectedTodoId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [installPromptEvent, setInstallPromptEvent] =
    useState<DeferredPromptEvent | null>(null);
  const [isInstallAvailable, setIsInstallAvailable] = useState(false);
  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const scrollLockRef = useRef<{
    htmlOverflow: string;
    htmlTouchAction: string;
    htmlOverscrollBehavior: string;
    bodyOverflow: string;
    bodyTouchAction: string;
    bodyOverscrollBehavior: string;
  } | null>(null);

  const lockScrollDuringDrag = useCallback(() => {
    if (typeof document === "undefined") return;
    if (scrollLockRef.current) return;

    const html = document.documentElement;
    const body = document.body;

    scrollLockRef.current = {
      htmlOverflow: html.style.overflow,
      htmlTouchAction: html.style.getPropertyValue("touch-action"),
      htmlOverscrollBehavior: html.style.getPropertyValue(
        "overscroll-behavior"
      ),
      bodyOverflow: body.style.overflow,
      bodyTouchAction: body.style.getPropertyValue("touch-action"),
      bodyOverscrollBehavior: body.style.getPropertyValue(
        "overscroll-behavior"
      ),
    };

    html.style.overflow = "hidden";
    html.style.setProperty("touch-action", "none");
    html.style.setProperty("overscroll-behavior", "none");
    body.style.overflow = "hidden";
    body.style.setProperty("touch-action", "none");
    body.style.setProperty("overscroll-behavior", "none");
  }, []);

  const releaseScrollLock = useCallback(() => {
    if (typeof document === "undefined") return;
    const previous = scrollLockRef.current;
    if (!previous) return;

    const html = document.documentElement;
    const body = document.body;

    html.style.overflow = previous.htmlOverflow;
    if (previous.htmlTouchAction) {
      html.style.setProperty("touch-action", previous.htmlTouchAction);
    } else {
      html.style.removeProperty("touch-action");
    }
    if (previous.htmlOverscrollBehavior) {
      html.style.setProperty(
        "overscroll-behavior",
        previous.htmlOverscrollBehavior
      );
    } else {
      html.style.removeProperty("overscroll-behavior");
    }

    body.style.overflow = previous.bodyOverflow;
    if (previous.bodyTouchAction) {
      body.style.setProperty("touch-action", previous.bodyTouchAction);
    } else {
      body.style.removeProperty("touch-action");
    }
    if (previous.bodyOverscrollBehavior) {
      body.style.setProperty(
        "overscroll-behavior",
        previous.bodyOverscrollBehavior
      );
    } else {
      body.style.removeProperty("overscroll-behavior");
    }

    scrollLockRef.current = null;
  }, []);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      void router.replace("/login");
    }
  }, [isAuthLoading, isAuthenticated, router]);

  const persistTodos = useCallback((list: Todo[]) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(list));
  }, []);

  const updateTodosState = useCallback(
    (updater: (prev: Todo[]) => Todo[]) => {
      setTodos((prev) => {
        const next = updater(prev);
        persistTodos(next);
        return next;
      });
    },
    [persistTodos]
  );

  const loadTodos = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const data = await fetchTodos();
      const normalised = data.map((todo) => normalizeTodo(todo));
      setTodos(normalised as Todo[]);
      persistTodos(normalised as Todo[]);
      setError(null);
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError?.status === 401) {
        logout();
        await router.replace("/login");
        return;
      }

      const cached =
        typeof window !== "undefined"
          ? window.localStorage.getItem(LOCAL_CACHE_KEY)
          : null;
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Todo[];
          setTodos(parsed);
          setError("Offline mode: showing cached todos.");
        } catch {
          setError(err instanceof Error ? err.message : "Failed to load todos");
        }
      } else {
        setError(err instanceof Error ? err.message : "Failed to load todos");
      }
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, persistTodos, logout, router]);

  const flushOfflineQueue = useCallback(async () => {
    if (!isAuthenticated) return;
    if (typeof window === "undefined" || !navigator.onLine) return;
    const operations = consumeQueue();
    if (!operations.length) return;

    let hasProcessed = false;
    const remaining: OfflineOperation[] = [];

    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      try {
        if (operation.type === "createTodo") {
          const formData = buildFormData(
            operation.payload.values,
            operation.payload.parentId ?? undefined
          );
          await createTodo(formData);
        } else if (operation.type === "updateStatus") {
          await updateTodoStatus(
            operation.payload.id,
            operation.payload.status
          );
        }
        hasProcessed = true;
      } catch (err) {
        remaining.push(operation, ...operations.slice(index + 1));
        break;
      }
    }

    pushBackQueue(remaining);
    if (hasProcessed) {
      await loadTodos();
    }
  }, [isAuthenticated, loadTodos]);

  useEffect(() => {
    void loadTodos();
  }, [loadTodos]);

  useEffect(() => {
    void flushOfflineQueue();
    if (typeof window === "undefined") return;
    const onlineHandler = () => {
      void flushOfflineQueue();
    };
    window.addEventListener("online", onlineHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    };
  }, [flushOfflineQueue]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as DeferredPromptEvent);
      setIsInstallAvailable(true);
      setInstallMessage(null);
    };

    const handleAppInstalled = () => {
      setInstallPromptEvent(null);
      setIsInstallAvailable(false);
      setInstallMessage(
        "App installed! You can launch it from your home screen."
      );
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallPwa = useCallback(async () => {
    if (!installPromptEvent) return;
    try {
      setInstallMessage(null);
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      setInstallPromptEvent(null);
      setIsInstallAvailable(false);
      if (choice.outcome === "accepted") {
        setInstallMessage(
          "Install started. Check your device to finish adding the app."
        );
      } else {
        setInstallMessage("Install dismissed. You can try again later.");
      }
    } catch {
      setInstallMessage("Install prompt failed. Please try again later.");
      setInstallPromptEvent(null);
      setIsInstallAvailable(false);
    }
  }, [installPromptEvent]);

  useEffect(() => {
    return () => {
      releaseScrollLock();
    };
  }, [releaseScrollLock]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  useEffect(() => {
    todosRef.current = cloneTodos(todos);
  }, [todos]);

  const dropAnimation = useMemo<DropAnimation>(
    () => ({
      ...defaultDropAnimation,
      duration: 250,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    }),
    []
  );

  const statusQueueRef = useRef<StatusUpdateRequest[]>([]);

  const persistStatusQueue = useCallback(() => {
    if (typeof window === "undefined") return;
    const serialized = statusQueueRef.current.map(({ todoId, status }) => ({
      todoId,
      status,
    }));
    window.localStorage.setItem(
      STATUS_QUEUE_STORAGE_KEY,
      JSON.stringify(serialized)
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isAuthenticated || isLoading) return;
    if (hasRestoredStatusQueueRef.current) return;

    hasRestoredStatusQueueRef.current = true;

    try {
      const raw = window.localStorage.getItem(STATUS_QUEUE_STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Array<{
        todoId: number;
        status: Todo["status"];
      }>;
      if (!Array.isArray(stored) || stored.length === 0) return;

      let working = cloneTodos(todosRef.current);
      const rebuiltQueue: StatusUpdateRequest[] = [];

      stored.forEach(({ todoId, status }) => {
        rebuiltQueue.push({
          todoId,
          status,
          snapshot: cloneTodos(working),
        });
        working = applyStatusToList(working, todoId, status);
      });

      statusQueueRef.current = rebuiltQueue;
      updateTodosState(() => working);
    } catch {
      window.localStorage.removeItem(STATUS_QUEUE_STORAGE_KEY);
    }
  }, [isAuthenticated, isLoading, updateTodosState]);

  useEffect(() => {
    if (typeof window === "undefined" || !isAuthenticated) {
      return;
    }

    const token = getAuthToken();
    if (!token) {
      return;
    }

    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const streamUrl = new URL("/api/todos/stream", API_URL);
      streamUrl.searchParams.set("token", token);
      const source = new EventSource(streamUrl.toString());
      eventSourceRef.current = source;

      source.onmessage = (event) => {
        if (!event.data) return;
        try {
          const payload = JSON.parse(event.data) as {
            type?: string;
            userId?: number;
            todos?: any[];
            removedIds?: number[];
          };

          if (!payload || payload.userId !== user?.id) {
            return;
          }

          switch (payload.type) {
            case "create":
            case "update":
            case "status_single":
            case "status_batch":
              if (Array.isArray(payload.todos)) {
                const normalized = payload.todos.map((todo) =>
                  normalizeTodo(todo)
                );
                updateTodosState((prev) => {
                  let next = cloneTodos(prev);
                  for (const todo of normalized) {
                    next = upsertTodoInTree(next, todo);
                  }
                  return next;
                });
              }
              break;
            case "delete":
              if (Array.isArray(payload.removedIds)) {
                updateTodosState((prev) => {
                  let next = cloneTodos(prev);
                  for (const id of payload.removedIds ?? []) {
                    next = removeTodoFromTree(next, id);
                  }
                  return next;
                });
              }
              break;
            default:
              break;
          }
        } catch {
          // ignore malformed payloads
        }
      };

      source.onerror = () => {
        source.close();
        if (!stopped) {
          retryTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [isAuthenticated, updateTodosState, user?.id]);

  const handleCreateTodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.title.trim()) {
      setFormError("Title is required");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    const values: TodoFormValues = {
      title: formState.title.trim(),
      description: formState.description.trim()
        ? formState.description.trim()
        : null,
      startDate: formState.startDate || null,
      endDate: formState.endDate || null,
      image: formState.image,
      clearStartDate: formState.startDate === "",
      clearEndDate: formState.endDate === "",
    };

    const tempId = Date.now() * -1;
    const timestamp = new Date().toISOString();
    const optimisticTodo: Todo = {
      id: tempId,
      title: values.title,
      description: values.description ?? null,
      startDate: values.startDate ?? undefined,
      endDate: values.endDate ?? undefined,
      status: values.status ?? "TODO",
      parentId: null,
      imageUrl: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      subtodos: [],
      timeline: [],
    };

    updateTodosState((prev) => [optimisticTodo, ...prev]);

    const formData = buildFormData(values);

    try {
      const created = await createTodo(formData);
      const normalized = normalizeTodo(created);
      updateTodosState((prev) => {
        const trimmed = removeTodoFromTree(prev, tempId);
        return [normalized, ...trimmed];
      });
      setFormState(initialRootForm);
      setFormError(null);
      setShowCreateModal(false);
      void loadTodos();
    } catch (err) {
      if (isOfflineError(err)) {
        if (formState.image) {
          updateTodosState((prev) => removeTodoFromTree(prev, tempId));
          setFormError("Image uploads require an internet connection.");
          setIsSubmitting(false);
          return;
        }

        const payloadValues: SerializedTodoPayload = {
          title: values.title,
          description: values.description,
          startDate: values.startDate,
          endDate: values.endDate,
          status: "TODO",
        };

        enqueueOperation({
          type: "createTodo",
          payload: { values: payloadValues, parentId: null },
        });

        setFormState(initialRootForm);
        setFormError(null);
        setShowCreateModal(false);
        setError("Offline mode: todo will sync when you're back online.");
      } else {
        updateTodosState((prev) => removeTodoFromTree(prev, tempId));
        setFormError(
          err instanceof Error ? err.message : "Failed to create todo"
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateSubTodo = useCallback(
    async (parent: Todo, values: { title: string; description?: string }) => {
      const payloadValues: SerializedTodoPayload = {
        title: values.title.trim(),
        description: values.description?.trim()
          ? values.description.trim()
          : null,
        status: "TODO",
      };

      const tempId = Date.now() * -1;
      const timestamp = new Date().toISOString();
      const optimisticSubTodo: Todo = {
        id: tempId,
        title: payloadValues.title,
        description: payloadValues.description ?? null,
        startDate: undefined,
        endDate: undefined,
        status: "TODO",
        parentId: parent.id,
        imageUrl: undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
        subtodos: [],
        timeline: [],
      };

      updateTodosState((prev) =>
        addSubTodoToParent(prev, parent.id, optimisticSubTodo)
      );

      try {
        const formData = buildFormData(payloadValues, parent.id);
        const created = await createTodo(formData);
        const normalized = normalizeTodo(created);
        updateTodosState((prev) => {
          const trimmed = removeTodoFromTree(prev, tempId);
          if (normalized.parentId) {
            return addSubTodoToParent(trimmed, normalized.parentId, normalized);
          }
          return [normalized, ...trimmed];
        });
        void loadTodos();
      } catch (err) {
        if (isOfflineError(err)) {
          enqueueOperation({
            type: "createTodo",
            payload: { values: payloadValues, parentId: parent.id },
          });
          setError("Offline mode: subtodo will sync when you're back online.");
        } else {
          updateTodosState((prev) => removeTodoFromTree(prev, tempId));
          setError(
            err instanceof Error ? err.message : "Failed to create subtodo"
          );
        }
      }
    },
    [loadTodos, updateTodosState]
  );

  const applyLocalStatusChange = useCallback(
    (targetId: number, status: Todo["status"]) => {
      updateTodosState((prev) => applyStatusToList(prev, targetId, status));
    },
    [updateTodosState]
  );

  const enqueueStatusUpdate = useCallback(
    (todoId: number, status: Todo["status"], snapshot: Todo[]) => {
      const existing = statusQueueRef.current.find(
        (item) => item.todoId === todoId
      );
      const snapshotToStore = existing ? existing.snapshot : snapshot;
      statusQueueRef.current = statusQueueRef.current.filter(
        (item) => item.todoId !== todoId
      );
      statusQueueRef.current.push({
        todoId,
        status,
        snapshot: snapshotToStore,
      });
      persistStatusQueue();
    },
    [persistStatusQueue]
  );

  const flushPendingStatusQueue = useCallback(
    async ({ keepalive = false }: { keepalive?: boolean } = {}) => {
      if (statusQueueRef.current.length === 0) {
        return true;
      }

      const payload = statusQueueRef.current.map(({ todoId, status }) => ({
        id: todoId,
        status,
      }));

      try {
        await updateTodoStatusesBatch(payload, { keepalive });
        const ids = payload.map((item) => item.id);
        statusQueueRef.current = [];
        persistStatusQueue();
        updateTodosState((prev) =>
          ids.reduce((acc, id) => applyStatusToList(acc, id, "TODO"), prev)
        );
        if (!keepalive) {
          setError(null);
        }
        return true;
      } catch (err) {
        if (!keepalive) {
          const apiError = err as ApiError;
          if (apiError?.status === 401) {
            statusQueueRef.current = [];
            persistStatusQueue();
            await logout();
            await router.replace("/login");
          } else {
            setError(
              err instanceof Error
                ? err.message
                : "Failed to sync pending status updates"
            );
          }
        }
        return false;
      }
    },
    [logout, persistStatusQueue, router, updateTodosState]
  );

  const handleUpdateStatus = useCallback(
    async (todo: Todo, status: Todo["status"]) => {
      if (todo.status === status) return;

      if (todo.id < 0) {
        setError(
          "Please wait for this todo to sync before updating its status."
        );
        return;
      }

      setError(null);
      const snapshot = cloneTodos(todosRef.current);
      applyLocalStatusChange(todo.id, status);
      enqueueStatusUpdate(todo.id, status, snapshot);

      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (offline) {
        enqueueOperation({
          type: "updateStatus",
          payload: { id: todo.id, status },
        });
        setError("Offline mode: status change queued for sync.");
      }
    },
    [applyLocalStatusChange, enqueueStatusUpdate]
  );

  const handleDeleteTodo = useCallback(
    async (target: Todo) => {
      const snapshot = cloneTodos(todosRef.current);
      statusQueueRef.current = statusQueueRef.current.filter(
        (item) => item.todoId !== target.id
      );
      persistStatusQueue();
      updateTodosState((prev) => removeTodoFromTree(prev, target.id));
      try {
        await deleteTodo(target.id);
        setError(null);
        setSelectedTodoId((current) =>
          current === target.id ? null : current
        );
      } catch (err) {
        updateTodosState(() => snapshot);
        const message =
          err instanceof Error ? err.message : "Failed to delete todo";
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [deleteTodo, persistStatusQueue, updateTodosState]
  );

  const handleDeleteSubTodo = useCallback(
    async (subTodo: Todo) => {
      const snapshot = cloneTodos(todosRef.current);
      statusQueueRef.current = statusQueueRef.current.filter(
        (item) => item.todoId !== subTodo.id
      );
      persistStatusQueue();
      updateTodosState((prev) => removeTodoFromTree(prev, subTodo.id));
      try {
        await deleteTodo(subTodo.id);
        setError(null);
      } catch (err) {
        updateTodosState(() => snapshot);
        const message =
          err instanceof Error ? err.message : "Failed to delete subtodo";
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [deleteTodo, persistStatusQueue, updateTodosState]
  );

  const handleUpdateDetails = useCallback(
    async (
      target: Todo,
      values: { title: string; description: string | null }
    ) => {
      const snapshot = cloneTodos(todosRef.current);
      updateTodosState((prev) =>
        applyMetaToList(prev, target.id, {
          title: values.title,
          description: values.description,
        })
      );

      try {
        const updated = await updateTodo(target.id, {
          title: values.title,
          description: values.description,
        });
        const normalized = normalizeTodo(updated);
        updateTodosState((prev) => upsertTodoInTree(prev, normalized));
        setError(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update todo";
        setError(message);
        updateTodosState(() => snapshot);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [setError, updateTodo, updateTodosState]
  );

  const handleUpdateTimeline = useCallback(
    async (
      target: Todo,
      values: { startDate: string | null; endDate: string | null }
    ) => {
      const snapshot = cloneTodos(todosRef.current);
      const payload = {
        startDate: normalizeDateInput(values.startDate),
        endDate: normalizeDateInput(values.endDate),
      };

      updateTodosState((prev) =>
        applyMetaToList(prev, target.id, {
          startDate: normalizeDateInput(values.startDate),
          endDate: normalizeDateInput(values.endDate),
        })
      );

      try {
        const updated = await updateTodo(target.id, payload);
        const normalized = normalizeTodo(updated);
        updateTodosState((prev) => upsertTodoInTree(prev, normalized));
        setError(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update timeline";
        setError(message);
        updateTodosState(() => snapshot);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [updateTodo, updateTodosState]
  );

  const handleUpdateImage = useCallback(
    async (target: Todo, imageFile: File | null) => {
      const snapshot = cloneTodos(todosRef.current);

      // Optimistically update
      if (imageFile) {
        const tempUrl = URL.createObjectURL(imageFile);
        updateTodosState((prev) =>
          prev.map((t) => {
            if (t.id === target.id) {
              return { ...t, imageUrl: tempUrl };
            }
            if (t.subtodos?.some((st) => st.id === target.id)) {
              return {
                ...t,
                subtodos: t.subtodos.map((st) =>
                  st.id === target.id ? { ...st, imageUrl: tempUrl } : st
                ),
              };
            }
            return t;
          })
        );
      } else {
        // Optimistically remove image
        updateTodosState((prev) =>
          prev.map((t) => {
            if (t.id === target.id) {
              return { ...t, imageUrl: null };
            }
            if (t.subtodos?.some((st) => st.id === target.id)) {
              return {
                ...t,
                subtodos: t.subtodos.map((st) =>
                  st.id === target.id ? { ...st, imageUrl: null } : st
                ),
              };
            }
            return t;
          })
        );
      }

      try {
        const formData = new FormData();
        // Keep existing title and description
        formData.append("title", target.title);
        if (target.description) {
          formData.append("description", target.description);
        }

        if (imageFile) {
          formData.append("image", imageFile);
        } else {
          // Send empty string to indicate image removal
          formData.append("imageUrl", "");
        }

        const updated = await updateTodoWithImage(target.id, formData);
        const normalized = normalizeTodo(updated);

        // Clean up temporary URL if it was created
        if (imageFile) {
          const tempUrl = URL.createObjectURL(imageFile);
          URL.revokeObjectURL(tempUrl);
        }

        updateTodosState((prev) => upsertTodoInTree(prev, normalized));
        setError(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update image";
        setError(message);
        updateTodosState(() => snapshot);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [updateTodosState]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePageHide = () => {
      if (statusQueueRef.current.length === 0) return;
      void flushPendingStatusQueue({ keepalive: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handlePageHide();
      }
    };

    window.addEventListener("beforeunload", handlePageHide);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handlePageHide);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushPendingStatusQueue]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      void flushPendingStatusQueue();
    };

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [flushPendingStatusQueue]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      void flushPendingStatusQueue();
    };

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [flushPendingStatusQueue]);

  const handleToggleSubTodo = useCallback(
    async (subTodo: Todo, completed: boolean) => {
      const targetStatus: Todo["status"] = completed ? "DONE" : "TODO";
      await handleUpdateStatus(subTodo, targetStatus);
    },
    [handleUpdateStatus]
  );

  const handleDragStart = useCallback(() => {
    lockScrollDuringDrag();
  }, [lockScrollDuringDrag]);

  const handleDragCancel = useCallback(() => {
    releaseScrollLock();
  }, [releaseScrollLock]);

  useEffect(
    () => () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    },
    []
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      releaseScrollLock();
      const { active, over } = event;
      if (!over) return;

      const todo: Todo | undefined = active.data.current?.todo;
      const newStatus = over.id as Todo["status"] | undefined;

      if (!todo || !newStatus || todo.status === newStatus) {
        return;
      }

      try {
        await handleUpdateStatus(todo, newStatus);
      } catch {
        // Already handled in handleUpdateStatus
      }
    },
    [handleUpdateStatus, releaseScrollLock]
  );

  const groupedTodos = useMemo(() => {
    const groups: Record<Todo["status"], Todo[]> = {
      TODO: [],
      IN_PROGRESS: [],
      DONE: [],
    };
    for (const todo of todos) {
      const status = (todo.status ?? "TODO") as Todo["status"];
      (groups[status] ?? groups.TODO).push({ ...todo, status });
    }
    return groups;
  }, [todos]);

  const selectedTodo = useMemo(
    () =>
      selectedTodoId != null
        ? todos.find((todo) => todo.id === selectedTodoId) ?? null
        : null,
    [todos, selectedTodoId]
  );

  const heading = useMemo(() => {
    if (isLoading) return "Loading your board...";
    if (todos.length === 0) return "Start planning with your first todo";
    return "Todo Board";
  }, [isLoading, todos.length]);

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 text-sm text-gray-500">
        Loading your workspace...
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <nav className="mb-6 flex items-center justify-between rounded-2xl bg-white/80 px-6 py-4 shadow">
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-500">
              Todo App
            </p>
            <h1 className="text-lg font-semibold text-gray-900">
              Hello, {user?.name || user?.email}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {isInstallAvailable && (
              <button
                type="button"
                onClick={handleInstallPwa}
                className="rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white shadow transition hover:bg-brand-500/90"
              >
                Install app
              </button>
            )}
            <button
              type="button"
              onClick={() => logout()}
              className="rounded-full border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition hover:border-brand-500 hover:text-brand-500"
            >
              Log out
            </button>
          </div>
        </nav>

        <header className="mb-8 text-center">
          <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">
            {heading}
          </h2>
          <p className="mt-2 text-gray-600">
            Organise todos, collaborate with subtasks, and track progress with
            timelines.
          </p>
          {installMessage && (
            <p className="mt-3 text-sm text-brand-500">{installMessage}</p>
          )}
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <div className="grid gap-4 md:grid-cols-3">
            {STATUS_COLUMNS.map((column) => (
              <KanbanColumn
                key={column.id}
                id={column.id}
                title={column.title}
                subtitle={`${groupedTodos[column.id].length} tasks`}
                accentClass={column.accentClass}
              >
                {column.id === "TODO" && (
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(true)}
                    className="flex w-full items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-sm font-medium text-gray-500 transition hover:border-brand-500 hover:text-brand-500"
                  >
                    + Add new todo
                  </button>
                )}
                {groupedTodos[column.id].map((todo) => (
                  <DraggableTodoCard
                    key={todo.id}
                    todo={todo}
                    onUpdateStatus={handleUpdateStatus}
                    onViewDetails={(item) => setSelectedTodoId(item.id)}
                    onToggleSubTodo={handleToggleSubTodo}
                    onDeleteTodo={handleDeleteTodo}
                    onDeleteSubTodo={handleDeleteSubTodo}
                  />
                ))}
              </KanbanColumn>
            ))}
          </div>
        </DndContext>
      </div>

      {selectedTodo && (
        <TodoDetailsModal
          todo={selectedTodo}
          onClose={() => setSelectedTodoId(null)}
          onUpdateStatus={handleUpdateStatus}
          onCreateSubTodo={handleCreateSubTodo}
          onToggleSubTodo={handleToggleSubTodo}
          onDeleteTodo={handleDeleteTodo}
          onDeleteSubTodo={handleDeleteSubTodo}
          onUpdateDetails={handleUpdateDetails}
          onUpdateTimeline={handleUpdateTimeline}
          onUpdateImage={handleUpdateImage}
        />
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-xl">
            <header className="border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-gray-400">
                    New Todo
                  </p>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Create a todo
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setFormState(initialRootForm);
                    setFormError(null);
                  }}
                  className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-500 transition hover:bg-gray-100"
                >
                  Close
                </button>
              </div>
            </header>
            <form onSubmit={handleCreateTodo} className="space-y-4 px-6 py-5">
              <div className="grid gap-1">
                <label
                  className="text-sm font-semibold text-gray-800"
                  htmlFor="modal-title"
                >
                  Title
                </label>
                <input
                  id="modal-title"
                  type="text"
                  value={formState.title}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  placeholder="Kick-off meeting"
                />
              </div>
              <div className="grid gap-1">
                <label
                  className="text-sm font-semibold text-gray-800"
                  htmlFor="modal-description"
                >
                  Description
                </label>
                <textarea
                  id="modal-description"
                  value={formState.description}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  rows={3}
                  placeholder="Context, goals, links..."
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    className="text-sm font-semibold text-gray-800"
                    htmlFor="modal-start"
                  >
                    Start date
                  </label>
                  <input
                    id="modal-start"
                    type="date"
                    value={formState.startDate}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        startDate: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </div>
                <div className="grid gap-1">
                  <label
                    className="text-sm font-semibold text-gray-800"
                    htmlFor="modal-end"
                  >
                    End date
                  </label>
                  <input
                    id="modal-end"
                    type="date"
                    value={formState.endDate}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        endDate: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </div>
              </div>
              <div className="grid gap-1">
                <label
                  className="text-sm font-semibold text-gray-800"
                  htmlFor="modal-image"
                >
                  Reference image (optional)
                </label>
                <input
                  id="modal-image"
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      image: event.target.files?.[0] ?? null,
                    }))
                  }
                  className="text-sm"
                />
                <p className="text-xs text-gray-500">
                  Attach mockups, briefs, or supporting screenshots if you have
                  them.
                </p>
              </div>
              {formError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </p>
              )}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => (
                    setShowCreateModal(false),
                    setFormState(initialRootForm),
                    setFormError(null)
                  )}
                  className="rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-500/90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmitting ? "Creating..." : "Create todo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
