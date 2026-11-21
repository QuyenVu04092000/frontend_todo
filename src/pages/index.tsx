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
  MouseSensor,
  defaultDropAnimation,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import { useRouter } from "next/router";

import type { ApiError, Todo, TodoChanges } from "../services/api";
import {
  createTodo,
  fetchTodos,
  updateTodoStatus,
  updateTodoStatusesBatch,
  getAuthToken,
  API_URL,
  saveTodo,
  deleteTodo,
} from "../services/api";
import type { TodoFormValues } from "../components/TodoItem";
import KanbanColumn from "../components/KanbanColumn";
import DraggableTodoCard from "../components/DraggableTodoCard";
import { STATUS_META } from "../components/status";
import {
  AlertIcon,
  BoardIcon,
  ChevronIcon,
  DownloadIcon,
  LogoMark,
  LogoutIcon,
  PlusIcon,
  RepeatIcon,
  SearchIcon,
  XIcon,
} from "../components/icons";
import TodoDetailsModal from "../components/TodoDetailsModal";
import RoutinesView from "../components/RoutinesView";
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
  /** Checklist steps added before the todo is created. */
  steps: string[];
}

const initialRootForm: RootFormState = {
  title: "",
  description: "",
  startDate: "",
  endDate: "",
  image: null,
  steps: [],
};

const LOCAL_CACHE_KEY = "todo_cached_todos_v1";
const VIEW_STORAGE_KEY = "todo_view_v1";

type AppView = "board" | "routines";

const VIEWS: Array<{ id: AppView; label: string }> = [
  { id: "board", label: "Board" },
  { id: "routines", label: "Routines" },
];

const STATUS_COLUMNS: Array<{
  id: Todo["status"];
  title: string;
  shortTitle: string;
}> = [
  { id: "TODO", title: "Todo", shortTitle: "Todo" },
  { id: "IN_PROGRESS", title: "In Progress", shortTitle: "Doing" },
  { id: "DONE", title: "Done", shortTitle: "Done" },
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

const hasTodoInTree = (list: Todo[], targetId: number): boolean =>
  list.some(
    (todo) =>
      todo.id === targetId ||
      (todo.subtodos ? hasTodoInTree(todo.subtodos, targetId) : false),
  );

// Swap a temporary (optimistic) todo for the saved one, keeping its position.
const replaceTodoInTree = (
  list: Todo[],
  targetId: number,
  replacement: Todo,
): Todo[] =>
  list.map((todo) => {
    if (todo.id === targetId) return replacement;
    if (todo.subtodos?.length) {
      return {
        ...todo,
        subtodos: replaceTodoInTree(todo.subtodos, targetId, replacement),
      };
    }
    return todo;
  });

const addSubTodoToParent = (
  list: Todo[],
  parentId: number,
  subTodo: Todo,
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
  status: Todo["status"],
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
            : sub,
        ),
      };
    }

    return todo;
  });

const STATUS_QUEUE_STORAGE_KEY = "todo_status_queue_v1";
// How long to wait after the last status change before syncing the batch.
const STATUS_SYNC_DELAY_MS = 800;

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
        : (input.parentId ?? null),
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
              : (event.actorUserId ?? null),
          createdAt:
            typeof event.createdAt === "string"
              ? event.createdAt
              : new Date(event.createdAt).toISOString(),
        }))
      : [],
  };

  return normalized;
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
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [newCreateStep, setNewCreateStep] = useState("");
  const [activeTab, setActiveTab] = useState<Todo["status"]>("TODO");
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<AppView>("board");
  const [routinesRefreshKey, setRoutinesRefreshKey] = useState(0);
  const [routineCreateSignal, setRoutineCreateSignal] = useState(0);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "board" || stored === "routines") setView(stored);
    } catch {
      // storage unavailable; keep default view
    }
  }, []);

  const changeView = useCallback((next: AppView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    window.scrollTo({ top: 0 });
  }, []);

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
        "overscroll-behavior",
      ),
      bodyOverflow: body.style.overflow,
      bodyTouchAction: body.style.getPropertyValue("touch-action"),
      bodyOverscrollBehavior: body.style.getPropertyValue(
        "overscroll-behavior",
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
        previous.htmlOverscrollBehavior,
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
        previous.bodyOverscrollBehavior,
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
    [persistTodos],
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
            operation.payload.parentId ?? undefined,
          );
          await createTodo(formData);
        } else if (operation.type === "updateStatus") {
          await updateTodoStatus(
            operation.payload.id,
            operation.payload.status,
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
        "App installed! You can launch it from your home screen.",
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
          "Install started. Check your device to finish adding the app.",
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
    // Mouse only: on touch/mobile, cards change status via buttons instead.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
  );

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    todosRef.current = cloneTodos(todos);
  }, [todos]);

  const dropAnimation = useMemo<DropAnimation>(
    () => ({
      ...defaultDropAnimation,
      duration: 250,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    }),
    [],
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
      JSON.stringify(serialized),
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
                  normalizeTodo(todo),
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
            case "routines":
              setRoutinesRefreshKey((value) => value + 1);
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

    // Text still in the step input counts as a step too.
    const stepTitles = [...formState.steps, newCreateStep]
      .map((step) => step.trim())
      .filter(Boolean);

    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    if (isOffline && stepTitles.length > 0) {
      setFormError("Cần có kết nối mạng để tạo checklist.");
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
    // Steps show up right away as pending (negative ids) until saved.
    const optimisticSteps: Todo[] = stepTitles.map((title, index) => ({
      id: tempId - index - 1,
      title,
      description: null,
      status: "TODO",
      parentId: tempId,
      createdAt: timestamp,
      updatedAt: timestamp,
      subtodos: [],
      timeline: [],
    }));
    optimisticTodo.subtodos = optimisticSteps;

    updateTodosState((prev) => [optimisticTodo, ...prev]);

    const formData = buildFormData(values);

    try {
      const created = await createTodo(formData);
      const normalized = normalizeTodo(created);
      updateTodosState((prev) => {
        const trimmed = removeTodoFromTree(prev, tempId);
        return [
          {
            ...normalized,
            subtodos: optimisticSteps.map((step) => ({
              ...step,
              parentId: normalized.id,
            })),
          },
          ...trimmed,
        ];
      });
      setFormState(initialRootForm);
      setNewCreateStep("");
      setFormError(null);
      setShowCreateModal(false);
      setShowMoreOptions(false);
      setIsSubmitting(false);

      // Create the steps one by one so they keep the order they were typed in.
      let failed = 0;
      for (const step of optimisticSteps) {
        try {
          const savedStep = await createTodo(
            buildFormData({ title: step.title, status: "TODO" }, normalized.id),
          );
          const saved = normalizeTodo(savedStep);
          updateTodosState((prev) => {
            if (hasTodoInTree(prev, step.id)) {
              return replaceTodoInTree(prev, step.id, saved);
            }
            // An SSE update may have replaced the parent (dropping pending
            // steps); attach the saved step unless it is already there.
            return hasTodoInTree(prev, saved.id)
              ? prev
              : addSubTodoToParent(prev, normalized.id, saved);
          });
        } catch {
          failed += 1;
          updateTodosState((prev) => removeTodoFromTree(prev, step.id));
        }
      }
      if (failed > 0) {
        setError(
          `Đã tạo todo nhưng không thêm được ${failed} bước checklist. Mở todo để thêm lại.`,
        );
      }
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
          err instanceof Error ? err.message : "Failed to create todo",
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
        addSubTodoToParent(prev, parent.id, optimisticSubTodo),
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
            err instanceof Error ? err.message : "Failed to create subtodo",
          );
        }
      }
    },
    [loadTodos, updateTodosState],
  );

  const applyLocalStatusChange = useCallback(
    (targetId: number, status: Todo["status"]) => {
      updateTodosState((prev) => applyStatusToList(prev, targetId, status));
    },
    [updateTodosState],
  );

  const enqueueStatusUpdate = useCallback(
    (todoId: number, status: Todo["status"], snapshot: Todo[]) => {
      const existing = statusQueueRef.current.find(
        (item) => item.todoId === todoId,
      );
      const snapshotToStore = existing ? existing.snapshot : snapshot;
      statusQueueRef.current = statusQueueRef.current.filter(
        (item) => item.todoId !== todoId,
      );
      statusQueueRef.current.push({
        todoId,
        status,
        snapshot: snapshotToStore,
      });
      persistStatusQueue();
    },
    [persistStatusQueue],
  );

  const flushStatusQueueOnce = useCallback(
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
        // Only drop what was actually sent: a change made while this request
        // was in flight stays queued for the next flush.
        statusQueueRef.current = statusQueueRef.current.filter(
          (item) =>
            !payload.some(
              (sent) => sent.id === item.todoId && sent.status === item.status,
            ),
        );
        persistStatusQueue();
        // Keep the statuses the server just accepted. An SSE event built
        // before the write may have arrived first with the old status.
        const stillQueued = new Set(
          statusQueueRef.current.map((item) => item.todoId),
        );
        updateTodosState((prev) =>
          payload
            .filter((item) => !stillQueued.has(item.id))
            .reduce(
              (acc, item) => applyStatusToList(acc, item.id, item.status),
              prev,
            ),
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
                : "Failed to sync pending status updates",
            );
          }
        }
        return false;
      }
    },
    [logout, persistStatusQueue, router, updateTodosState],
  );

  // pagehide + visibilitychange (and online) can fire together; share one
  // in-flight request instead of sending the same batch twice.
  const flushInFlightRef = useRef<Promise<boolean> | null>(null);

  const flushPendingStatusQueue = useCallback(
    ({ keepalive = false }: { keepalive?: boolean } = {}) => {
      if (flushInFlightRef.current) return flushInFlightRef.current;
      const run = flushStatusQueueOnce({ keepalive }).finally(() => {
        flushInFlightRef.current = null;
      });
      flushInFlightRef.current = run;
      return run;
    },
    [flushStatusQueueOnce],
  );

  // Status changes are batched: each change (re)starts a short timer, and when
  // it fires everything queued so far goes out in one request. Leaving the page
  // (pagehide) and coming back online still flush immediately.
  const statusSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleStatusSync = useCallback(() => {
    if (statusSyncTimerRef.current) {
      clearTimeout(statusSyncTimerRef.current);
    }
    statusSyncTimerRef.current = setTimeout(async () => {
      statusSyncTimerRef.current = null;
      // A request already in flight doesn't include changes made after it
      // started, so wait for it, then send whatever is still queued.
      await flushInFlightRef.current?.catch(() => false);
      await flushPendingStatusQueue();
    }, STATUS_SYNC_DELAY_MS);
  }, [flushPendingStatusQueue]);

  useEffect(
    () => () => {
      if (statusSyncTimerRef.current) {
        clearTimeout(statusSyncTimerRef.current);
      }
    },
    [],
  );

  const handleUpdateStatus = useCallback(
    async (todo: Todo, status: Todo["status"]) => {
      if (todo.status === status) return;

      if (todo.id < 0) {
        setError(
          "Please wait for this todo to sync before updating its status.",
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
      } else {
        scheduleStatusSync();
      }
    },
    [applyLocalStatusChange, enqueueStatusUpdate, scheduleStatusSync],
  );

  const handleDeleteTodo = useCallback(
    async (target: Todo) => {
      const snapshot = cloneTodos(todosRef.current);
      statusQueueRef.current = statusQueueRef.current.filter(
        (item) => item.todoId !== target.id,
      );
      persistStatusQueue();
      updateTodosState((prev) => removeTodoFromTree(prev, target.id));
      try {
        await deleteTodo(target.id);
        setError(null);
        setSelectedTodoId((current) =>
          current === target.id ? null : current,
        );
      } catch (err) {
        updateTodosState(() => snapshot);
        const message =
          err instanceof Error ? err.message : "Failed to delete todo";
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [deleteTodo, persistStatusQueue, updateTodosState],
  );

  const handleDeleteSubTodo = useCallback(
    async (subTodo: Todo) => {
      const snapshot = cloneTodos(todosRef.current);
      statusQueueRef.current = statusQueueRef.current.filter(
        (item) => item.todoId !== subTodo.id,
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
    [deleteTodo, persistStatusQueue, updateTodosState],
  );

  // Single "Save" for the todo detail form: one PATCH with every changed field.
  // Not optimistic and not queued offline: the modal keeps its draft on error.
  const handleSaveTodo = useCallback(
    async (target: Todo, changes: TodoChanges): Promise<Todo> => {
      const updated = await saveTodo(target.id, changes);
      const normalized = normalizeTodo(updated);
      updateTodosState((prev) => upsertTodoInTree(prev, normalized));
      return normalized;
    },
    [updateTodosState],
  );

  const handleRenameSubTodo = useCallback(
    async (subTodo: Todo, title: string) => {
      await handleSaveTodo(subTodo, { title });
    },
    [handleSaveTodo],
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

  const handleToggleSubTodo = useCallback(
    async (subTodo: Todo, completed: boolean) => {
      const targetStatus: Todo["status"] = completed ? "DONE" : "TODO";
      await handleUpdateStatus(subTodo, targetStatus);
    },
    [handleUpdateStatus],
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
    [],
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
    [handleUpdateStatus, releaseScrollLock],
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
        ? (todos.find((todo) => todo.id === selectedTodoId) ?? null)
        : null,
    [todos, selectedTodoId],
  );

  const visibleTodos = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groupedTodos;
    const matches = (todo: Todo) =>
      todo.title.toLowerCase().includes(query) ||
      (todo.description ?? "").toLowerCase().includes(query) ||
      (todo.subtodos ?? []).some((sub) =>
        sub.title.toLowerCase().includes(query),
      );
    return {
      TODO: groupedTodos.TODO.filter(matches),
      IN_PROGRESS: groupedTodos.IN_PROGRESS.filter(matches),
      DONE: groupedTodos.DONE.filter(matches),
    };
  }, [groupedTodos, searchQuery]);

  const stats = useMemo(() => {
    const total = todos.length;
    const done = groupedTodos.DONE.length;
    return {
      total,
      done,
      inProgress: groupedTodos.IN_PROGRESS.length,
      percent: total ? Math.round((done / total) * 100) : 0,
    };
  }, [groupedTodos, todos.length]);

  const isAnyModalOpen = showCreateModal || selectedTodo != null;

  // Prevent the board from scrolling behind open modals (important on iOS).
  useEffect(() => {
    if (typeof document === "undefined" || !isAnyModalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isAnyModalOpen]);

  const closeCreateModal = useCallback(() => {
    setShowCreateModal(false);
    setShowMoreOptions(false);
    setNewCreateStep("");
    setFormState(initialRootForm);
    setFormError(null);
  }, []);

  useEffect(() => {
    if (!showCreateModal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCreateModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeCreateModal, showCreateModal]);

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 text-sm text-slate-500">
        <LogoMark className="h-10 w-10 animate-pulse" />
        Loading your workspace...
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const displayName = user?.name || user?.email || "there";
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const renderSkeleton = () =>
    Array.from({ length: 2 }).map((_, index) => (
      <div
        key={index}
        className="h-28 animate-pulse rounded-xl border border-slate-200/60 bg-white/70"
      />
    ));

  return (
    <div className="min-h-screen bg-slate-50 pb-40 md:pb-10">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 md:h-16 md:px-6">
          <LogoMark className="h-8 w-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900 md:text-base">
              {view === "board" ? "Todo Board" : "Routines"}
            </p>
            <p className="truncate text-xs text-slate-500">
              Hello, {displayName}
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Views"
            className="hidden items-center gap-1 rounded-full bg-slate-100 p-1 md:flex"
          >
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={view === item.id}
                onClick={() => changeView(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                  view === item.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {item.id === "board" ? (
                  <BoardIcon width={15} height={15} />
                ) : (
                  <RepeatIcon width={15} height={15} />
                )}
                {item.label}
              </button>
            ))}
          </div>

          <div
            className={`relative hidden w-64 lg:w-72 ${
              view === "board" ? "md:block" : ""
            }`}
          >
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search todos…"
              className="field rounded-full py-2 pl-10"
            />
          </div>

          {isInstallAvailable && (
            <button
              type="button"
              onClick={handleInstallPwa}
              className="btn-secondary px-3 py-2"
              title="Install app"
            >
              <DownloadIcon width={16} height={16} />
              <span className="hidden sm:inline">Install</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className={`btn-primary hidden ${
              view === "board" ? "md:inline-flex" : ""
            }`}
          >
            <PlusIcon width={16} height={16} />
            New todo
          </button>
          <div className="flex items-center gap-1">
            <span
              className="hidden h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 sm:inline-flex"
              title={user?.email}
            >
              {initials || "U"}
            </span>
            <button
              type="button"
              onClick={() => logout()}
              className="icon-btn"
              aria-label="Log out"
              title="Log out"
            >
              <LogoutIcon />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-5 md:px-6 md:pt-8">
        {view === "routines" ? (
          <RoutinesView
            refreshKey={routinesRefreshKey}
            createSignal={routineCreateSignal}
          />
        ) : (
          <>
            {/* Overview */}
            <section className="mb-4 grid gap-4 md:mb-6 md:grid-cols-4">
              <div className="panel p-4 md:p-5">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium text-slate-500">Progress</p>
                  <p className="text-2xl font-bold tabular-nums text-slate-900">
                    {stats.percent}%
                  </p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-400 to-emerald-500 transition-all duration-500"
                    style={{ width: `${stats.percent}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {stats.done} of {stats.total} todos completed
                </p>
              </div>
              {STATUS_COLUMNS.map((column) => (
                <div key={column.id} className="panel hidden p-5 md:block">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${STATUS_META[column.id].dot}`}
                    />
                    <p className="truncate text-sm font-medium text-slate-500">
                      {column.title}
                    </p>
                  </div>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                    {groupedTodos[column.id].length}
                  </p>
                </div>
              ))}
            </section>

            {installMessage && (
              <p className="mb-4 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">
                {installMessage}
              </p>
            )}

            {error && (
              <div
                role="alert"
                className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
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

            {/* Mobile: search + status tabs */}
            <div className="sticky top-14 z-20 -mx-4 mb-3 space-y-3 bg-slate-50/90 px-4 pb-3 pt-1 backdrop-blur md:hidden">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search todos…"
                  className="field rounded-full pl-10"
                />
              </div>
              <div
                role="tablist"
                className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200/70 p-1"
              >
                {STATUS_COLUMNS.map((column) => {
                  const isActive = activeTab === column.id;
                  return (
                    <button
                      key={column.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveTab(column.id)}
                      className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] font-semibold transition ${
                        isActive
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${STATUS_META[column.id].dot}`}
                      />
                      <span className="truncate">{column.shortTitle}</span>
                      <span className="tabular-nums text-slate-400">
                        {visibleTodos[column.id].length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragCancel={handleDragCancel}
              onDragEnd={handleDragEnd}
            >
              <div className="grid gap-4 md:grid-cols-3">
                {STATUS_COLUMNS.map((column) => {
                  const items = visibleTodos[column.id];
                  return (
                    <KanbanColumn
                      key={column.id}
                      id={column.id}
                      title={column.title}
                      count={items.length}
                      className={
                        activeTab === column.id ? "" : "hidden md:flex"
                      }
                    >
                      {isLoading && todos.length === 0 && renderSkeleton()}

                      {items.map((todo) => (
                        <DraggableTodoCard
                          key={todo.id}
                          todo={todo}
                          onUpdateStatus={handleUpdateStatus}
                          onViewDetails={(item) => setSelectedTodoId(item.id)}
                          onToggleSubTodo={handleToggleSubTodo}
                          onDeleteTodo={handleDeleteTodo}
                          onDeleteSubTodo={handleDeleteSubTodo}
                          dragEnabled={!isMobile}
                        />
                      ))}

                      {!isLoading && items.length === 0 && (
                        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300/80 px-4 py-10 text-center">
                          <p className="text-sm font-medium text-slate-600">
                            {searchQuery
                              ? "No matching todos"
                              : column.id === "DONE"
                                ? "Nothing finished yet"
                                : "No todos here"}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {searchQuery
                              ? "Try a different keyword."
                              : isMobile
                                ? "Change a todo's status to move it here."
                                : "Drag a card here or change its status."}
                          </p>
                        </div>
                      )}

                      {column.id === "TODO" && (
                        <button
                          type="button"
                          onClick={() => setShowCreateModal(true)}
                          className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-white hover:text-brand-500 hover:shadow-card"
                        >
                          <PlusIcon width={16} height={16} />
                          Add todo
                        </button>
                      )}
                    </KanbanColumn>
                  );
                })}
              </div>
            </DndContext>
          </>
        )}
      </main>

      {/* Mobile floating action button */}
      <button
        type="button"
        onClick={() =>
          view === "board"
            ? setShowCreateModal(true)
            : setRoutineCreateSignal((value) => value + 1)
        }
        style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}
        className="fixed right-5 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/40 transition active:scale-95 md:hidden"
        aria-label={view === "board" ? "Create todo" : "Create routine"}
      >
        <PlusIcon width={24} height={24} strokeWidth={2.5} />
      </button>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Views"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/90 backdrop-blur-lg md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid h-16 grid-cols-2">
          {VIEWS.map((item) => {
            const isActive = view === item.id;
            const Icon = item.id === "board" ? BoardIcon : RepeatIcon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => changeView(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 text-xs font-semibold transition ${
                  isActive ? "text-brand-500" : "text-slate-400"
                }`}
              >
                <Icon
                  width={22}
                  height={22}
                  strokeWidth={isActive ? 2.25 : 2}
                />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      {selectedTodo && (
        <TodoDetailsModal
          todo={selectedTodo}
          onClose={() => setSelectedTodoId(null)}
          onSave={handleSaveTodo}
          onCreateSubTodo={handleCreateSubTodo}
          onToggleSubTodo={handleToggleSubTodo}
          onRenameSubTodo={handleRenameSubTodo}
          onDeleteTodo={handleDeleteTodo}
          onDeleteSubTodo={handleDeleteSubTodo}
        />
      )}

      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeCreateModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-todo-title"
            className="flex max-h-[92vh] w-full animate-sheet-up flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
            <header className="flex items-center justify-between px-5 pb-3 pt-3 sm:px-6 sm:pt-5">
              <h2
                id="create-todo-title"
                className="text-lg font-semibold text-slate-900"
              >
                New todo
              </h2>
              <button
                type="button"
                onClick={closeCreateModal}
                className="icon-btn"
                aria-label="Close"
              >
                <XIcon />
              </button>
            </header>
            <form
              onSubmit={handleCreateTodo}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4 sm:px-6">
                <div className="grid gap-1.5">
                  <label className="field-label" htmlFor="modal-title">
                    Title
                  </label>
                  <input
                    id="modal-title"
                    type="text"
                    autoFocus
                    value={formState.title}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    className="field"
                    placeholder="Kick-off meeting"
                  />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="field-label">Checklist</span>
                    {formState.steps.length > 0 && (
                      <span className="text-xs font-medium tabular-nums text-slate-500">
                        {formState.steps.length} bước
                      </span>
                    )}
                  </div>
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                    {formState.steps.map((step, index) => (
                      <li
                        key={`${index}-${step}`}
                        className="flex items-center gap-3 bg-white px-3 py-1.5"
                      >
                        <span className="h-4 w-4 shrink-0 rounded border border-slate-300" />
                        <span className="min-w-0 flex-1 break-words py-1 text-sm text-slate-800">
                          {step}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setFormState((prev) => ({
                              ...prev,
                              steps: prev.steps.filter((_, i) => i !== index),
                            }))
                          }
                          className="icon-btn h-8 w-8 shrink-0 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Bỏ bước ${step}`}
                        >
                          <XIcon width={15} height={15} />
                        </button>
                      </li>
                    ))}
                    <li className="flex items-center gap-2 bg-white px-3">
                      <PlusIcon
                        width={18}
                        height={18}
                        className="shrink-0 text-slate-400"
                      />
                      <input
                        type="text"
                        value={newCreateStep}
                        onChange={(event) =>
                          setNewCreateStep(event.target.value)
                        }
                        onKeyDown={(event) => {
                          // Enter adds a step instead of submitting the form.
                          if (
                            event.key !== "Enter" ||
                            event.nativeEvent.isComposing
                          )
                            return;
                          event.preventDefault();
                          const step = newCreateStep.trim();
                          if (!step) return;
                          setFormState((prev) => ({
                            ...prev,
                            steps: [...prev.steps, step],
                          }));
                          setNewCreateStep("");
                        }}
                        placeholder="Thêm bước… (Enter để thêm)"
                        aria-label="Thêm bước checklist"
                        className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none sm:text-sm"
                      />
                    </li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMoreOptions((open) => !open)}
                  aria-expanded={showMoreOptions}
                  aria-controls="create-more-options"
                  className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
                >
                  <ChevronIcon
                    width={16}
                    height={16}
                    className={`transition-transform ${
                      showMoreOptions ? "rotate-90" : ""
                    }`}
                  />
                  More options
                  <span className="font-normal text-slate-400">
                    (notes, dates, image)
                  </span>
                </button>
                {showMoreOptions && (
                  <div id="create-more-options" className="space-y-4">
                    <div className="grid gap-1.5">
                      <label
                        className="field-label"
                        htmlFor="modal-description"
                      >
                        Notes
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
                        className="field resize-none"
                        rows={2}
                        placeholder="Thêm ghi chú…"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid min-w-0 gap-1.5">
                        <label className="field-label" htmlFor="modal-start">
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
                          className="field min-h-[44px]"
                        />
                      </div>
                      <div className="grid min-w-0 gap-1.5">
                        <label className="field-label" htmlFor="modal-end">
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
                          className="field min-h-[44px]"
                        />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <span className="field-label">Reference image</span>
                      <label
                        htmlFor="modal-image"
                        className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 transition hover:border-brand-400 hover:bg-brand-50/40"
                      >
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm">
                          <DownloadIcon className="rotate-180" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-700">
                            {formState.image
                              ? formState.image.name
                              : "Choose an image (optional)"}
                          </span>
                          <span className="block text-xs text-slate-400">
                            Mockups, briefs, or screenshots
                          </span>
                        </span>
                        <input
                          id="modal-image"
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(event) =>
                            setFormState((prev) => ({
                              ...prev,
                              image: event.target.files?.[0] ?? null,
                            }))
                          }
                        />
                      </label>
                    </div>
                  </div>
                )}
                {formError && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </p>
                )}
              </div>
              <div className="pb-safe flex items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-5 pt-4 sm:justify-end sm:px-6 sm:pb-4">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="btn-secondary flex-1 sm:flex-none"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary flex-1 sm:flex-none"
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
