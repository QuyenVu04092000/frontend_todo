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
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Todo } from "../services/api";
import { createTodo, fetchTodos, updateTodoStatus } from "../services/api";
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

const STATUS_COLUMNS: Array<{
  id: Todo["status"];
  title: string;
  accentClass: string;
}> = [
  {
    id: "TODO",
    title: "Todo",
    accentClass: "text-gray-500",
  },
  {
    id: "IN_PROGRESS",
    title: "In Progress",
    accentClass: "text-yellow-600",
  },
  {
    id: "DONE",
    title: "Done",
    accentClass: "text-green-600",
  },
];

const LOCAL_CACHE_KEY = "todo_cached_todos_v1";

const normalizeTodo = (input: any): Todo => {
  const normalized: Todo = {
    id: input.id,
    title: input.title,
    description:
      typeof input.description === "string" ? input.description : null,
    imageUrl:
      typeof input.imageUrl === "string" || input.imageUrl === null
        ? input.imageUrl
        : null,
    startDate: typeof input.startDate === "string" ? input.startDate : null,
    endDate: typeof input.endDate === "string" ? input.endDate : null,
    status: (input.status ?? "TODO") as Todo["status"],
    parentId: typeof input.parentId === "number" ? input.parentId : null,
    createdAt:
      typeof input.createdAt === "string"
        ? input.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof input.updatedAt === "string"
        ? input.updatedAt
        : new Date().toISOString(),
    subtodos: undefined,
    pendingSync: false,
  };

  if (Array.isArray(input.subtodos)) {
    normalized.subtodos = input.subtodos.map((sub: any) => normalizeTodo(sub));
  }

  return normalized;
};

export default function HomePage() {
  const [todos, setTodos] = useState<Todo[]>([]);
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
  const bodyOverflowRef = useRef<string | null>(null);
  const bodyTouchActionRef = useRef<string | null>(null);
  const bodyPositionRef = useRef<string | null>(null);
  const bodyTopRef = useRef<string | null>(null);
  const bodyWidthRef = useRef<string | null>(null);
  const scrollYRef = useRef<number>(0);

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

  const applyLocalStatusChange = useCallback(
    (targetId: number, status: Todo["status"], markPending: boolean) => {
      updateTodosState((prev) =>
        prev.map((todo) => {
          if (todo.id === targetId) {
            const subtodos =
              status === "DONE"
                ? todo.subtodos?.map((sub) => ({
                    ...sub,
                    status: "DONE",
                    pendingSync: markPending ? true : sub.pendingSync,
                  }))
                : todo.subtodos;
            return {
              ...todo,
              status,
              pendingSync: markPending ? true : todo.pendingSync,
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
                      pendingSync: markPending ? true : sub.pendingSync,
                    }
                  : sub
              ),
            };
          }

          return todo;
        })
      );
    },
    [updateTodosState]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const lockBodyScroll = useCallback(() => {
    if (typeof document === "undefined") return;
    if (bodyOverflowRef.current === null) {
      scrollYRef.current = window.scrollY || 0;
      bodyOverflowRef.current = document.body.style.overflow;
      bodyTouchActionRef.current = document.body.style.touchAction;
      bodyPositionRef.current = document.body.style.position;
      bodyTopRef.current = document.body.style.top;
      bodyWidthRef.current = document.body.style.width;
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollYRef.current}px`;
      document.body.style.width = "100%";
    }
  }, []);

  const releaseBodyScroll = useCallback(() => {
    if (typeof document === "undefined") return;
    if (bodyOverflowRef.current !== null) {
      document.body.style.overflow = bodyOverflowRef.current || "";
      document.body.style.touchAction = bodyTouchActionRef.current || "";
      document.body.style.position = bodyPositionRef.current || "";
      document.body.style.top = bodyTopRef.current || "";
      document.body.style.width = bodyWidthRef.current || "";
      window.scrollTo(0, scrollYRef.current || 0);
      bodyOverflowRef.current = null;
      bodyTouchActionRef.current = null;
      bodyPositionRef.current = null;
      bodyTopRef.current = null;
      bodyWidthRef.current = null;
    }
  }, []);

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
      releaseBodyScroll();
    };
  }, [releaseBodyScroll]);

  const loadTodos = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchTodos();
      const normalised = data.map((todo) => normalizeTodo(todo));
      setTodos(normalised as unknown as Todo[]);
      persistTodos(normalised as unknown as Todo[]);
      setError(null);
    } catch (err) {
      const cached =
        typeof window !== "undefined"
          ? window.localStorage.getItem(LOCAL_CACHE_KEY)
          : null;
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Todo[];
          setTodos(parsed);
          setError("Offline mode: showing the last synced board.");
        } catch (parseError) {
          setError(err instanceof Error ? err.message : "Failed to load todos");
        }
      } else {
        setError(err instanceof Error ? err.message : "Failed to load todos");
      }
    } finally {
      setIsLoading(false);
    }
  }, [persistTodos]);

  const handleCreateSubTodo = useCallback(
    async (parent: Todo, values: { title: string; description?: string }) => {
      if (parent.pendingSync) {
        setError(
          "Please wait for the parent todo to sync before adding subtodos."
        );
        return;
      }

      const payloadValues: SerializedTodoPayload = {
        title: values.title.trim(),
        description: values.description?.trim()
          ? values.description.trim()
          : null,
        status: "TODO",
      };

      try {
        const formData = buildFormData(payloadValues, parent.id);
        await createTodo(formData);
        await loadTodos();
      } catch (err) {
        const offline =
          typeof navigator !== "undefined" &&
          (!navigator.onLine ||
            (err instanceof TypeError && err.message === "Failed to fetch"));
        if (offline) {
          enqueueOperation({
            type: "createTodo",
            payload: { values: payloadValues, parentId: parent.id },
          });

          const tempId = Date.now() * -1;
          const timestamp = new Date().toISOString();
          const optimisticSubTodo: Todo = {
            id: tempId,
            title: payloadValues.title,
            description: payloadValues.description ?? null,
            status: "TODO",
            parentId: parent.id,
            imageUrl: undefined,
            startDate: undefined,
            endDate: undefined,
            createdAt: timestamp,
            updatedAt: timestamp,
            subtodos: undefined,
            pendingSync: true,
          };

          updateTodosState((prev) =>
            prev.map((todo) =>
              todo.id === parent.id
                ? {
                    ...todo,
                    subtodos: [...(todo.subtodos ?? []), optimisticSubTodo],
                  }
                : todo
            )
          );

          setError("Offline mode: subtodo will sync when you're back online.");
        } else {
          setError(
            err instanceof Error ? err.message : "Failed to create subtodo"
          );
        }
      }
    },
    [loadTodos, updateTodosState]
  );

  useEffect(() => {
    void loadTodos();
  }, [loadTodos]);

  const flushOfflineQueue = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!navigator.onLine) return;
    const operations = consumeQueue();
    if (!operations.length) return;
    let hasProcessed = false;
    const remaining: OfflineOperation[] = [];

    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      try {
        if (operation.type === "createTodo") {
          const formData = new FormData();
          const { values, parentId } = operation.payload;
          formData.append("title", values.title);
          if (values.description) {
            formData.append("description", values.description);
          }
          if (values.startDate) {
            formData.append("startDate", values.startDate);
          }
          if (values.endDate) {
            formData.append("endDate", values.endDate);
          }
          formData.append("status", values.status ?? "TODO");
          if (typeof parentId === "number") {
            formData.append("parentId", String(parentId));
          }
          await createTodo(formData);
        } else if (operation.type === "updateStatus") {
          await updateTodoStatus(
            operation.payload.id,
            operation.payload.status
          );
        }
        hasProcessed = true;
      } catch (error) {
        remaining.push(operation, ...operations.slice(index + 1));
        break;
      }
    }

    pushBackQueue(remaining);
    if (hasProcessed) {
      await loadTodos();
    }
  }, [loadTodos]);

  useEffect(() => {
    void flushOfflineQueue();
    const onlineHandler = () => {
      void flushOfflineQueue();
    };
    window.addEventListener("online", onlineHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
    };
  }, [flushOfflineQueue]);

  const handleCreateTodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.title.trim()) {
      setFormError("Title is required");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
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
      const formData = buildFormData(values);
      await createTodo(formData);
      setFormState(initialRootForm);
      setFormError(null);
      await loadTodos();
      setShowCreateModal(false);
    } catch (err) {
      const offline =
        typeof navigator !== "undefined" &&
        (!navigator.onLine ||
          (err instanceof TypeError && err.message === "Failed to fetch"));
      if (offline) {
        if (formState.image) {
          setFormError("Image uploads require an internet connection.");
          setIsSubmitting(false);
          return;
        }

        const payloadValues: SerializedTodoPayload = {
          title: formState.title.trim(),
          description: formState.description.trim()
            ? formState.description.trim()
            : null,
          startDate: formState.startDate || null,
          endDate: formState.endDate || null,
          status: "TODO",
        };

        enqueueOperation({
          type: "createTodo",
          payload: { values: payloadValues, parentId: null },
        });

        const tempId = Date.now() * -1;
        const timestamp = new Date().toISOString();
        const optimisticTodo: Todo = {
          id: tempId,
          title: payloadValues.title,
          description: payloadValues.description ?? null,
          startDate: payloadValues.startDate ?? undefined,
          endDate: payloadValues.endDate ?? undefined,
          status: "TODO",
          parentId: null,
          imageUrl: undefined,
          createdAt: timestamp,
          updatedAt: timestamp,
          subtodos: [] as Todo[],
          pendingSync: true,
        };

        updateTodosState((prev) => [optimisticTodo, ...prev]);
        setFormState(initialRootForm);
        setFormError(null);
        setShowCreateModal(false);
        setError("Offline mode: todo will sync when you're back online.");
      } else {
        setFormError(
          err instanceof Error ? err.message : "Failed to create todo"
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = useCallback(
    async (todo: Todo, status: Todo["status"]) => {
      if (todo.status === status) return;

      if (todo.pendingSync || todo.id < 0) {
        setError(
          "Please wait for this todo to sync before updating its status."
        );
        return;
      }

      setError(null);
      const offline = typeof navigator !== "undefined" && !navigator.onLine;

      if (offline) {
        applyLocalStatusChange(todo.id, status, true);
        enqueueOperation({
          type: "updateStatus",
          payload: { id: todo.id, status },
        });
        setError("Offline mode: status change queued for sync.");
        return;
      }

      try {
        await updateTodoStatus(todo.id, status);
        await loadTodos();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update todo status";
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [applyLocalStatusChange, loadTodos]
  );

  const handleToggleSubTodo = useCallback(
    async (subTodo: Todo, completed: boolean) => {
      const targetStatus: Todo["status"] = completed ? "DONE" : "TODO";
      await handleUpdateStatus(subTodo, targetStatus);
    },
    [handleUpdateStatus]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      releaseBodyScroll();
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
        // error already handled and displayed via handleUpdateStatus
      }
    },
    [handleUpdateStatus, releaseBodyScroll]
  );

  const handleDragStart = useCallback(() => {
    lockBodyScroll();
  }, [lockBodyScroll]);

  const handleDragCancel = useCallback(() => {
    releaseBodyScroll();
  }, [releaseBodyScroll]);

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
    return "Todo List";
  }, [isLoading, todos.length]);

  const handleViewDetails = useCallback((todo: Todo) => {
    setSelectedTodoId(todo.id);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedTodoId(null);
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
    } catch (err) {
      setInstallMessage("Install prompt failed. Please try again later.");
      setInstallPromptEvent(null);
      setIsInstallAvailable(false);
    }
  }, [installPromptEvent]);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 md:text-4xl">
            {heading}
          </h1>
          <p className="mt-2 text-gray-600">
            Quản lý và note những điều cần làm
          </p>
          {isInstallAvailable && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={handleInstallPwa}
                className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500/90"
              >
                <span role="img" aria-hidden="true">
                  📲
                </span>
                Install this app on your device
              </button>
            </div>
          )}
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
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
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
                    className="flex w-full items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-10 text-sm font-medium text-gray-500 transition hover:border-brand-500 hover:text-brand-500"
                  >
                    + Add new todo
                  </button>
                )}
                {groupedTodos[column.id].map((todo) => (
                  <DraggableTodoCard
                    key={todo.id}
                    todo={todo}
                    onUpdateStatus={handleUpdateStatus}
                    onViewDetails={handleViewDetails}
                    onToggleSubTodo={handleToggleSubTodo}
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
          onClose={handleCloseModal}
          onUpdateStatus={handleUpdateStatus}
          onCreateSubTodo={handleCreateSubTodo}
          onToggleSubTodo={handleToggleSubTodo}
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
                  onClick={() => setShowCreateModal(false)}
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
