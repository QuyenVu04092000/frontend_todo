import type { Todo } from "../services/api";

export type SerializedTodoPayload = {
  title: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: Todo["status"];
};

export type OfflineOperation =
  | {
      type: "createTodo";
      payload: {
        values: SerializedTodoPayload;
        parentId?: number | null;
      };
    }
  | {
      type: "updateStatus";
      payload: {
        id: number;
        status: Todo["status"];
      };
    };

const QUEUE_KEY = "todo_offline_queue_v1";

const readQueue = (): OfflineOperation[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineOperation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Failed to read offline queue", error);
    return [];
  }
};

const writeQueue = (queue: OfflineOperation[]) => {
  if (typeof window === "undefined") return;
  if (!queue.length) {
    window.localStorage.removeItem(QUEUE_KEY);
    return;
  }
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
};

export const enqueueOperation = (operation: OfflineOperation) => {
  const queue = readQueue();
  queue.push(operation);
  writeQueue(queue);
};

export const consumeQueue = (): OfflineOperation[] => {
  const queue = readQueue();
  writeQueue([]);
  return queue;
};

export const pushBackQueue = (queue: OfflineOperation[]) => {
  writeQueue(queue);
};

export const hasPendingOperations = (): boolean => {
  if (typeof window === "undefined") return false;
  return readQueue().length > 0;
};

