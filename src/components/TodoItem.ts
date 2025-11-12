import type { Todo } from "../services/api";

export type TodoFormValues = {
  title: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  image?: File | null;
  status?: Todo["status"];
  clearStartDate?: boolean;
  clearEndDate?: boolean;
};

export {};



