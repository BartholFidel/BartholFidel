# BartholFidel

**BartholFidel** is a professional behavioral anomaly detection and threat prevention platform ([bartholfidel.com](https://bartholfidel.com)). It ingests entity telemetry, establishes statistical baselines, scores anomalies, and escalates correlated signals into actionable incidents.

This repository is the Week 1 project foundation: infrastructure, database schema, API health check, and operational dashboard.

## Monorepo structure

```
bartholfidel/
├── apps/
│   ├── api/          Express + TypeScript backend
│   └── web/          Next.js 14 + TypeScript frontend
├── packages/
│   └── shared/       Shared TypeScript types
├── docker-compose.yml
├── .env.example
└── README.md
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Docker](https://www.docker.com/) and Docker Compose
- npm (included with Node.js)

## Quick start

### 1. Start infrastructure (PostgreSQL, Redis, Neo4j)

```bash
docker-compose up -d
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` if you changed default credentials.

### 3. Install dependencies

```bash
npm install
```

### 4. Run database migrations

```bash
npm run migrate
```

### 5. Start API and web (development)

```bash
npm run dev
```

| Service | URL |
|---------|-----|
| Web dashboard | http://localhost:3000/dashboard |
| API health | http://localhost:4000/api/health |

## What each service does

### Docker Compose services

| Service | Ports | Purpose |
|---------|-------|---------|
| **PostgreSQL** | 5432 | Primary relational store for entities, events, baselines, anomaly scores, incidents, and related tables |
| **Redis** | 6379 | Low-latency cache and queue backing for real-time processing (connected at API startup in Week 1) |
| **Neo4j** | 7474 (HTTP), 7687 (Bolt) | Graph database for entity relationship analysis (provisioned in Week 1; application wiring follows in later weeks) |

### Application packages

| Package | Description |
|---------|-------------|
| **apps/api** | Express API with strict TypeScript. Connects to PostgreSQL and Redis on startup. Exposes `GET /api/health`. |
| **apps/web** | Next.js 14 frontend with Tailwind CSS (dark security-product theme). Dashboard at `/dashboard` reflects API health. |
| **packages/shared** | Shared TypeScript types (e.g. health check response) used by API and web. |

## Database schema

Migrations live in `apps/api/migrations/`. Week 1 creates:

- `entities`
- `raw_events`
- `entity_metrics_history`
- `entity_baselines`
- `anomaly_scores`
- `incidents`
- `alert_feedback`
- `suppression_rules`
- `entity_relationships`

Verify tables after migrating:

```bash
docker exec -it bartholfidel-postgres psql -U bartholfidel -d bartholfidel -c "\dt"
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API (port 4000) and web (port 3000) concurrently |
| `npm run build` | Build shared, API, and web packages |
| `npm run migrate` | Apply pending SQL migrations to PostgreSQL |

## Week 1 success criteria

- `docker-compose up` starts PostgreSQL, Redis, and Neo4j
- `npm run dev` starts both API and web
- `GET /api/health` returns `{ success: true, platform: "BartholFidel", status: "online", timestamp: "..." }`
- `/dashboard` shows **BartholFidel** with **System Online** when the API is healthy
- All database tables exist and are queryable after `npm run migrate`

## License

Proprietary by BartholFidel. All rights reserved.
