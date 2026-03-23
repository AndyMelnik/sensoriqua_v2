# Sensoriqua frontend

React + TypeScript + Vite frontend for [Sensoriqua](../README.md). Connects to the backend API for groupings, objects, sensors, configured sensors, and the dashboard.

## Setup

From the repo root, see the main [README quick start](../README.md#quick-start-local). In short:

```bash
npm install
npm run dev
```

Runs the dev server (default [http://localhost:5173](http://localhost:5173)) with API proxy to the backend at `http://127.0.0.1:8000`.

## Scripts

- **`npm run dev`** – Start dev server with HMR
- **`npm run build`** – TypeScript check and production build (output in `dist/`)
- **`npm run lint`** – Run ESLint
- **`npm run preview`** – Preview production build locally

## Environment

- **`VITE_API_URL`** (optional) – Backend base URL. If unset, the app uses relative `/api` and relies on the dev proxy or same-origin backend.
