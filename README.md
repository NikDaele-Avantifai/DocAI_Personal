# DocAI

> Intelligent Documentation Management for Confluence

DocAI is an AI-powered browser extension and web dashboard that autonomously
analyzes, structures, and maintains your Confluence documentation — with a
human approval layer for every proposed change.

---

## Monorepo Structure

```
docai/
├── apps/
│   ├── extension/        # Plasmo browser extension (React + TypeScript)
│   └── dashboard/        # Web dashboard (React + Vite)
├── packages/
│   └── shared-types/     # Shared TypeScript types (used by both apps)
├── backend/              # FastAPI backend (Python)
│   ├── app/
│   │   ├── api/routes/   # HTTP route handlers
│   │   ├── core/         # Config, settings
│   │   ├── services/     # Business logic (Confluence, etc.)
│   │   ├── agents/       # LangGraph AI agents
│   │   ├── models/       # SQLAlchemy DB models
│   │   └── db/           # Database connection & migrations
│   └── tests/
└── .github/workflows/    # CI/CD (GitHub Actions)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Browser Extension | [Plasmo](https://docs.plasmo.com/) + React |
| Dashboard | React + Vite + React Query |
| Backend | FastAPI (Python 3.12) |
| AI Orchestration | LangGraph |
| Database | PostgreSQL on Azure |
| Auth | Azure Entra ID (MSAL) |
| Hosting | Azure |
| CI/CD | GitHub Actions |

---

## Getting Started

### Prerequisites

- Node.js >= 20
- Python >= 3.12
- npm >= 10

### 1. Clone & install

```bash
git clone https://github.com/your-org/docai.git
cd docai
npm install
```

### 2. Set up the backend

```bash
cd backend
cp .env.example .env
# Fill in your values in .env

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Run everything

Open three terminals:

```bash
# Terminal 1 — Backend API (http://localhost:8000)
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2 — Dashboard (http://localhost:3000)
npm run dev:dashboard

# Terminal 3 — Extension (loads into Chrome via chrome://extensions)
npm run dev:extension
```

### 4. Load the extension in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select `apps/extension/.plasmo/chrome-mv3-dev`

---

## API Docs

When the backend is running in development, visit:
- Swagger UI: http://localhost:8000/docs

---

## Running Tests

```bash
# Backend
cd backend
pytest tests/ -v

# Frontend typecheck
npm run typecheck
```

---

## Environment Variables

See `backend/.env.example` for all required variables.

---

## Contributing

1. Branch from `develop`
2. Name branches: `feature/`, `fix/`, `chore/`
3. Open a PR against `develop` — CI must pass before merge
4. `main` is production-only, merged from `develop` on release
