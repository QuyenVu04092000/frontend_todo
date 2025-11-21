# TodoList Frontend (Next.js PWA)

A responsive PWA frontend for the nested Todo List backend. Built with Next.js, TypeScript, and TailwindCSS, it supports timeline visualisation, nested subtodos, and image uploads.

## Features

- ✅ Fetch, create, update, and delete todos & subtodos
- ✅ Nested hierarchy with automatic timeline calculation
- ✅ Image upload support for todos & subtodos
- ✅ Kanban board with three-state workflow (TODO / IN_PROGRESS / DONE)
- ✅ Drag-and-drop columns powered by @dnd-kit with progress indicators
- ✅ TailwindCSS UI optimised for mobile & desktop
- ✅ Progressive Web App (PWA) – installable & offline-ready

## Getting Started

### Prerequisites

- Node.js 18+
- Backend API running (default: `http://localhost:3000`)

### Installation

```bash
npm install
cp .env.example .env # update NEXT_PUBLIC_API_URL if needed
```

### Development

```bash
npm run dev
```

Visit `http://localhost:3000` in the browser. The service worker is disabled in development for easier debugging.
Drag-and-drop is enabled in the browser—grab a card to move it between columns.

### Production Build

```bash
npm run build
npm run start
```

### Linting

```bash
npm run lint
```

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL for the backend API | `http://localhost:3000` |

## PWA Support

- Manifest located at `public/manifest.json`
- Icons in `public/todo-192.png` and `public/todo-512.png`
- Service worker generated via [`next-pwa`](https://github.com/shadowwalker/next-pwa). It registers automatically in production builds.

To test PWA behaviour locally:

1. Run `npm run build && npm run start`
2. Open the app in Chrome and use **Lighthouse** or **Application → Manifest** to verify installability

## Project Structure

```
todolist-frontend/
├─ public/
│  ├─ todo-192.png
│  ├─ todo-512.png
│  └─ manifest.json
├─ src/
│  ├─ pages/
│  │  ├─ _app.tsx
│  │  ├─ _document.tsx
│  │  └─ index.tsx
│  ├─ components/
│  │  ├─ TodoItem.tsx
│  │  ├─ TodoList.tsx
│  │  └─ SubTodoItem.tsx
│  ├─ services/
│  │  └─ api.ts
│  ├─ utils/
│  │  └─ timeline.ts
│  └─ styles/
│     └─ globals.css
├─ tailwind.config.js
├─ postcss.config.js
├─ next.config.js
├─ tsconfig.json
├─ package.json
├─ .env.example
└─ README.md
```

## API Expectations

The frontend expects the backend API to expose endpoints:

- `GET /api/todos` – returns `{ success: true, data: Todo[] }`
- `POST /api/todos` – accepts `FormData`
- `PUT /api/todos/:id` – accepts `FormData`
- `DELETE /api/todos/:id`
- `PATCH /api/todos/:id/status` – accepts `{ status: "TODO" | "IN_PROGRESS" | "DONE" }`

Each `Todo` should include a `subtodos` array and a `status` field for nested rendering and progress tracking.

## Deployment

- Configure `NEXT_PUBLIC_API_URL` to point to your deployed backend
- Build with `npm run build`
- Serve `next start` behind a production web server or deploy via Vercel

## License

MIT
