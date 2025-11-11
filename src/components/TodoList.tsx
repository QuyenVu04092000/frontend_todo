import TodoItem from "./TodoItem";
import type { Todo } from "../services/api";
import type { TodoFormValues } from "./TodoItem";

export interface TodoListProps {
  todos: Todo[];
  onCreateSubTodo: (parentId: number, values: TodoFormValues) => Promise<void>;
  onUpdateTodo: (id: number, values: TodoFormValues) => Promise<void>;
  onDeleteTodo: (id: number) => Promise<void>;
  onUpdateStatus: (todo: Todo, status: Todo["status"]) => Promise<void>;
}

export default function TodoList({
  todos,
  onCreateSubTodo,
  onUpdateTodo,
  onDeleteTodo,
  onUpdateStatus,
}: TodoListProps) {
  if (!todos.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        No todos yet. Create your first todo to get started.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {todos.map((todo) => (
        <TodoItem
          key={todo.id}
          todo={todo}
          onCreateSubTodo={onCreateSubTodo}
          onUpdateTodo={onUpdateTodo}
          onDeleteTodo={onDeleteTodo}
          onUpdateStatus={onUpdateStatus}
        />
      ))}
    </div>
  );
}
