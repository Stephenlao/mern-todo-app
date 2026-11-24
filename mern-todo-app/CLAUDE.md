# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

This is the sample source for a DevOps course final project (Cybersoft). The app itself is a 3-tier Todo list: **React frontend → Express backend → MongoDB**. The assignment is about deploying it, not about adding features. The rollout must go in this order:

1. **Localhost** (done)
2. **Docker Desktop** (done): Dockerfile per service + `docker-compose.yml`; see "Stage 2" below
3. **VPS** ← next (GitHub Actions + Jenkins pipeline, Terraform to create the VPS, Ansible to install and deploy, Prometheus + Grafana to monitor hardware and DB status)

The assignment specifically says to check two files: **`backend/.env`** (database connection) and **`frontend/src/Axios/axios.js`** (how the frontend reaches the backend). Most deployment breakage comes from these two files. When changing them, prefer settings that will still work in the later Docker and VPS stages, such as values read from env vars, over new hardcoded hosts.

## Codebase layout

Two independent npm packages and no root `package.json`:
- `backend/` — Express 4 + Mongoose 6 REST API, **ES modules** (`"type": "module"`, so local imports need the `.js` extension).
- `frontend/` — Create React App (react-scripts 5), React 18, react-router v6, MUI + Tailwind (CRA picks up `tailwind.config.js` automatically).

## Stage 1: running on localhost

| Service  | Address                                  | How to run |
|----------|------------------------------------------|------------|
| MongoDB  | `mongodb://localhost:27017` (db `todo`)  | Docker container (no `mongod` installed on this machine) |
| Backend  | `http://localhost:8000`, API under `/api` | `node server.js` |
| Frontend | `http://localhost:3000`                  | `npm start` |

### Config files

`backend/.env` (gitignored; template in `backend/.env.example`):
```
MONGO_URI=mongodb://localhost:27017/todo
PORT=8000
JWT_SECRET=<any random string>
GMAIL_USERNAME=<gmail address>
GMAIL_PASSWORD=<gmail app password>
CLIENT_URL=http://localhost:3000   # optional, used in the reset-password email link
```

`frontend/.env` (optional; template in `frontend/.env.example`):
```
REACT_APP_API_URL=http://localhost:8000/api
```
`frontend/src/Axios/axios.js` reads `REACT_APP_API_URL` and falls back to `http://localhost:8000/api`. CRA bakes `REACT_APP_*` values in at build time, so after changing it you must restart `npm start` or rebuild. In Docker this means passing it as a build arg, not a runtime env var.

How the two files depend on each other:
- `PORT` in `backend/.env` must match the port in `REACT_APP_API_URL` (or the fallback). If `PORT` is unset the server falls back to **8001**, and every API call then fails.
- The browser calls the backend directly (no CRA `proxy`), so `localhost` in the API URL means the user's machine. The same thing will matter in Docker and on the VPS, where the URL must be one the browser can reach, not a container hostname.
- CORS is fully open (`app.use(cors())`), so calls from :3000 to :8000 need no extra config.
- Gmail is only used by the add-task notification and the forgot-password email. Bad credentials just log an error and the task is still saved. Gmail requires an App Password, not the account password.

### Known localhost problems in the code
- `mongoose.connect` only logs connection errors. The server still prints `Listening on localhost:8000` when MongoDB is down, and requests then hang or time out. Make sure `DB Connected` appears in the log.
- Node here is v24. `bcrypt@5` is a native module, so if `npm install` fails while building it, try Node 18/20 LTS (Docker images should pin one of those).

## Commands

Start in this order: MongoDB → backend → frontend.

```
# MongoDB (Docker Desktop must be running)
docker run -d --name todo-mongo -p 27017:27017 -v todo-mongo-data:/data/db mongo:6
docker start todo-mongo            # on later runs

# Backend (no npm start script and no tests are defined)
cd backend
npm install
node server.js                     # expect "Listening on localhost:8000" and "DB Connected"

# Frontend
cd frontend
npm install
npm start                          # dev server on :3000
npm run build                      # production build into build/
npx serve -s build -l 3000         # serve the build (-s gives the SPA fallback that client routes need)
npm test                           # Jest watch mode (no test files exist yet)
npm test -- --watchAll=false src/path/to/File.test.js   # run a single test once
```
Linting is CRA's built-in ESLint (`react-app` config), shown during `npm start`/`build`.

Quick checks:
```
curl -X POST http://localhost:8000/api/user/register -H "Content-Type: application/json" -d "{\"name\":\"a\",\"email\":\"a@a.com\",\"password\":\"123\"}"
docker exec -it todo-mongo mongosh todo --eval "db.users.find()"
```

## Stage 2: Docker (docker-compose)

```
docker compose up -d --build --wait    # build images and start mongo → backend → frontend
docker compose ps                      # all three should be (healthy)
docker compose logs -f backend
docker compose down                    # stop; data is kept in volume mongo-data
docker compose down -v                 # stop AND delete the database volume
```
Open http://localhost:3000. Stop any stage-1 `node server.js` / `npm start` first, because they use the same ports 3000/8000.

How the containers fit together (`docker-compose.yml`):
- `mongo` (`mongo:6`): data lives in named volume `mongo-data`. It **publishes no port**, so only containers on the compose network can reach it (hostname `mongo`). It has a `mongosh ping` healthcheck.
- `backend` (`backend/Dockerfile`, `node:20-slim`, not alpine so the prebuilt `bcrypt` binary works): uses `backend/.env` through `env_file`, but `environment:` overrides `MONGO_URI=mongodb://mongo:27017/todo`, `PORT`, and `CLIENT_URL`. It waits for `mongo` to be healthy, because `server.js` never retries a failed DB connection. Its healthcheck calls `GET /api/health`, which returns 200 only when Mongoose is connected. Port 8000 is published only for debugging.
- `frontend` (`frontend/Dockerfile`, multi-stage): `node:20-alpine` runs `npm run build` with build arg `REACT_APP_API_URL=/api`, and `nginx:1.27-alpine` serves `build/`. `frontend/nginx.conf` proxies `/api/` to `http://backend:8000` and sends unknown paths to `index.html` (React Router). Because the browser and the API share one origin (`:3000`), CORS is not involved and the same image works behind any domain on the VPS.
- Changing `REACT_APP_API_URL` or any frontend code requires `docker compose build frontend`. Restarting the container is not enough.
- `.dockerignore` files keep `node_modules` and `.env` out of the images. Secrets reach the backend only at runtime through `env_file`.

## Architecture

**API** (`backend/server.js` mounts three routers under `/api`):
- `/api/user`: `login`, `register`, `getuser` (requires auth). Login and register return `{ user, token }`. The JWT payload is `{ id }` and expires after 3 days.
- `/api/task`: `addTask` (POST), `getTask` (GET), `removeTask` (GET, reads `id` from the body). All three are behind `requireAuth`.
- `/api/forgotPassword`: `forgotPassword` stores a random `resetToken` on the user and emails the link `${CLIENT_URL}/resetPassword?token=...`. `resetPassword` takes `{ token, password }`.

`middleware/requireAuth.js` expects `Authorization: Bearer <jwt>` and sets `req.user = { id }`. Tasks are linked to users by a string `userId` field (not a ref). `scheduler/scheduler.js` is empty. `GET /api/health` returns `{status:"ok"}` (200) or `db_disconnected` (503). It is used by the Docker healthcheck and is available for monitoring.

**Frontend state** lives in `App.js` via `useReducer` + Context, with no Redux:
- `TokenContext` → `{ userToken, tokenDispatch, user, userDispatch }`. The token is saved in `localStorage["authToken"]` (JSON-encoded) and read on load.
- `TaskContext` → `{ tasks, dispatch }` from `reducer/taskReducer.js` (`SET_TASK`, `ADD_TASK`, `REMOVE_TASK`, `MARK_DONE`). The reducer throws on unknown actions.
- When the token changes, `App.js` fetches `/user/getUser` and `/task/getTask`.

`REMOVE_TASK` and `MARK_DONE` work on the array **index** and only change local state. `Task.jsx` never calls the backend, and there is no API for updating `completed`, so deleting a task or marking it done is lost on reload. This is how the sample app behaves, not a deployment bug.

Routing: `Header` is the outer layout route. `/` renders `Layout` (with the `AllTask` / `active` / `completed` children) if a token existed when the page loaded, otherwise `Login`. Auth pages: `/login`, `/register`, `/forgotPassword`, `/resetPassword?token=...`.
