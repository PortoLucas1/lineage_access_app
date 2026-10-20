/**
 * Server boot — the ONE place where all backend pieces get wired together.
 *
 * Template responsibilities, in order:
 *   1. Read `config/app.json` (the use-case knobs — agent endpoint, warehouse,
 *      dashboard, Delta sync tables, branding, scripted demo chain).
 *   2. Create the AppKit app with the 3 plugins we rely on:
 *        - server()     → Express, OBO auth forwarding, serve-the-client
 *        - lakebase()   → Postgres pool backed by Databricks Lakebase
 *        - analytics()  → SQL-warehouse-backed typed queries (AnalyticsView)
 *   3. Run Drizzle migrations against Lakebase (safe-to-re-run on boot).
 *   4. One-shot sync of Delta tables into the Lakebase mirror (`syncFromDelta`)
 *      so the app has an OLTP-friendly local copy of the read-only lakehouse.
 *   5. Get-or-create the MLflow experiment that will hold agent traces, then
 *      `mlflow.init(...)` so `@openai/agents` runs are recorded automatically.
 *   6. Register the Express routes (config, chat, domain CRUD, admin).
 *
 * ─────────────────────────────────────────────────────────────────────
 * REPURPOSING THIS TEMPLATE
 * ─────────────────────────────────────────────────────────────────────
 * The structural wiring (boot order, plugin set, route registration) is
 * use-case agnostic — leave it alone. Customization happens here:
 *
 *   • `config/app.json`              — branding, agent endpoint name OR
 *                                       Genie space ID, MLflow experiment
 *                                       path, dashboard id, Delta source
 *                                       tables, scripted demo prompts.
 *   • `db/schema.ts`                 — Lakebase OLTP tables (the writable
 *                                       mirror the agent + UI both use).
 *   • `db/sync.ts`                   — one-shot copy from Delta → Lakebase
 *                                       at boot. Update the table list.
 *   • `db/queries/returns.ts`        — domain queries; rename + rewrite.
 *   • `agent/refundops.ts`           — the agent itself. Rename the file
 *                                       to match your domain, update the
 *                                       import below, and rewrite tools +
 *                                       instructions.
 *   • `routes/returns.ts`            — REST endpoints for the queue. Add
 *                                       new routes for your domain.
 *
 * Cross-file: `client/src/shared/types.ts` is the single source of truth
 * for the domain types and is the FIRST thing to update when swapping
 * the data model.
 */
// Normalize DATABRICKS_HOST: in Databricks Apps, the runtime sometimes
// injects a bare hostname (`e2-demo-west.cloud.databricks.com`) overriding
// the .env value, which breaks every `new URL()` call downstream
// (MLflow bootstrap, OpenAI agent endpoint, Genie/MAS routing). Force a
// scheme + strip a trailing slash exactly once, at module load.
if (process.env.DATABRICKS_HOST) {
  let h = process.env.DATABRICKS_HOST.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(h)) h = 'https://' + h;
  process.env.DATABRICKS_HOST = h;
}

import { installLogger } from './lib/logger.js';
installLogger();

import {
  createApp,
  server,
  lakebase,
  analytics,
} from '@databricks/appkit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse as parseJsonc, type ParseError, printParseErrorCode } from 'jsonc-parser';
import { z } from 'zod';

import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { syncFromDelta } from './db/sync.js';
import { runDbInit } from './db/init.js';

import { registerConfigRoutes } from './routes/config.js';
import { registerLineageRoutes } from './routes/lineage.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerChartRoutes } from './routes/charts.js';
import { registerDevLogRoutes } from './routes/dev-log.js';
import { registerUnityCatalogRoutes } from './routes/unity-catalog.js';
import { registerPermissionRoutes } from './routes/permissions.js';
import { registerTerraformRoutes } from './routes/terraform.js';

// ============================================================================
// Config
// ============================================================================

type AppConfig = {
  /** MAS serving-endpoint name. Set this OR `genieSpaceId` (one of the
   * two) — the agent registers `ask_mas` if this is set, `ask_genie`
   * otherwise. See server/agent/tools/{mas,genie}.ts. */
  masEndpointName?: string;
  /** Genie space ID (32-char hex). Set this OR `masEndpointName`.
   * The two are mutually-exclusive in the default template — if your
   * demo really needs both, edit makeTools() to register both factories. */
  genieSpaceId?: string;
  /** Pinned MLflow experiment id, used by AppHeader's "Experiment" link.
   * Optional — most demos rely on `agentMlflowExperimentPath` below to
   * auto-create a per-app experiment instead of pinning a legacy one. */
  mlflowExperimentId?: string;
  /** Workspace path where the agent's traces will be recorded. Auto-
   * created at server boot if it doesn't exist; the resulting experiment
   * id is published as `agentMlflowExperimentId` on /api/config and is
   * what the chat "View trace" deep-link points at.
   *
   * IMPORTANT: leave this set in `config/app.json`. If empty, traces have
   * nowhere to land and the chat shows "Trace pending…" forever — which
   * is also why the previous version of this template had a real value
   * baked in. The path should be unique per app (we use the app name)
   * so multiple demos in the same workspace don't share an experiment.
   *
   * Format: `/Users/<email>/<app-name>-agent-traces`
   * Example: `/Users/me@databricks.com/lineage-access-agent-traces`
   *
   * The path is created via the MLflow REST API (POST /api/2.0/mlflow/
   * experiments/create); the running app's principal must have CAN_EDIT
   * on the parent folder. In Databricks Apps the service principal owns
   * its own /Users/<sp> folder, so the standard pattern works in prod
   * too. See `lib/mlflow.ts` for the bootstrap. */
  agentMlflowExperimentPath?: string;
  agentModel?: string;
  dashboardId: string;
  /** Workspace resource ids/paths surfaced by /api/resources. Leave any
   * field empty to mark the corresponding tile inert (no deep-link).
   * The server composes URLs from these + DATABRICKS_HOST. */
  pipelineId?: string;
  warehouseId?: string;
  kaEndpointName?: string;
  lakebaseProjectId?: string;
  /** Full URL of THIS app (different host than the workspace), as
   * returned by `databricks apps get`. Stored verbatim, not composed. */
  appUrl?: string;
  /** Three-part UC model name `catalog.schema.model`. */
  mlModelName?: string;
  /** Volume path `/Volumes/<catalog>/<schema>/<volume>`. */
  pdfVolumePath?: string;
  branding: { appName: string };
  ucExplorer?: {
    defaultCatalog: string;
    defaultSchema: string;
  };
  terraformBaseline?: {
    modulePath: string;
    catalog: string;
    schema: string;
    manifest: string;
  };
  assistantScript?: Array<{
    label: string;
    prompt: string;
    triggerAfter?: string[];
  }>;
  data?: {
    catalog: string;
    schema: string;
    tables: {
      assets: string;
      lineageEdges: string;
      accessGrants: string;
      lineageEvents?: string;
    };
  };
};

// ─────────────────────────────────────────────────────────────────────────
// Validate config/app.json at boot — fail fast with one clear message
// instead of letting a typo surface as a 500 deep in the agent loop or
// a literal `<your-email>` reaching MLflow.
//
// Schema mirrors the `AppConfig` type above; `_*_help` keys in the JSON
// are documentation and pass through unread. Unknown extra keys are
// allowed (`.passthrough()`-equivalent — we only assert the required shape).
// ─────────────────────────────────────────────────────────────────────────

const tablesSchema = z.object({
  assets: z.string().min(1),
  lineageEdges: z.string().min(1),
  accessGrants: z.string().min(1),
  // Analytics-only (queried live via the SQL warehouse, not mirrored).
  lineageEvents: z.string().optional(),
});

const appConfigSchema = z
  .object({
    masEndpointName: z.string().optional(),
    genieSpaceId: z.string().optional(),
    mlflowExperimentId: z.string().optional(),
    agentMlflowExperimentPath: z.string().optional(),
    agentModel: z.string().optional(),
    dashboardId: z.string(),
    pipelineId: z.string().optional(),
    warehouseId: z.string().optional(),
    kaEndpointName: z.string().optional(),
    lakebaseProjectId: z.string().optional(),
    appUrl: z.string().optional(),
    mlModelName: z.string().optional(),
    pdfVolumePath: z.string().optional(),
    branding: z.object({ appName: z.string().min(1) }),
    ucExplorer: z
      .object({
        defaultCatalog: z.string(),
        defaultSchema: z.string(),
      })
      .optional(),
    terraformBaseline: z
      .object({
        modulePath: z.string(),
        catalog: z.string(),
        schema: z.string(),
        manifest: z.string(),
      })
      .optional(),
    assistantScript: z
      .array(
        z.object({
          label: z.string().optional(),
          prompt: z.string().min(1),
          triggerAfter: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    data: z
      .object({
        // NOT `.min(1)`: in local-dev / preview mode DEMO_CATALOG/DEMO_SCHEMA
        // may be unset, so the `${DEMO_CATALOG}` placeholders resolve to "".
        // We must BOOT (degraded) rather than crash — the Delta→Lakebase sync
        // already no-ops when DATABRICKS_WAREHOUSE_ID is unset (db/sync.ts),
        // which is the same condition, so empty catalog/schema never reaches
        // a query. Deployed mode always has all three set together.
        catalog: z.string(),
        schema: z.string(),
        tables: tablesSchema,
      })
      .optional(),
  });
  // Strict by default — unknown keys are a config typo, not a feature. The
  // file is JSONC (parsed via jsonc-parser) so help text lives in real
  // `//` comments rather than `_*_help` JSON keys.

const CONFIG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../config/app.json',
);

function loadAppConfig(): AppConfig {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    throw new Error(
      `[config] Could not read ${CONFIG_PATH}: ${(e as Error).message}`,
    );
  }

  // Pre-process `${VAR}` / `${VAR:default}` placeholders against process.env
  // so the same config file works across DAB deployments. Unknown vars with
  // no default resolve to "" (the zod schema accepts empty strings for the
  // optional fields). This runs BEFORE the JSONC parse so substituted text
  // is part of the parsed document.
  raw = raw.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::([^}]*))?\}/g, (_, name, dflt) => {
    const v = process.env[name];
    return v !== undefined && v !== '' ? v : (dflt ?? '');
  });

  // Parse with jsonc-parser so config/app.json supports `//` and `/* */`
  // comments + trailing commas. We still write a `.json` file (no extension
  // change, no DAB / IDE churn) — only the parser is more permissive.
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const list = errors
      .map(
        (e) =>
          `  • offset ${e.offset}+${e.length}: ${printParseErrorCode(e.error)}`,
      )
      .join('\n');
    throw new Error(
      `[config] ${CONFIG_PATH} is not valid JSONC:\n${list}`,
    );
  }

  const result = appConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `[config] ${CONFIG_PATH} failed validation:\n${issues}`,
    );
  }

  // Surface unfilled placeholders like "/Users/<your-email>/..." that
  // would otherwise cause a confusing MLflow 404 / dashboard 403 later.
  // Two tiers:
  //   - WARN for optional fields with a graceful empty-path fallback
  //     (mlflow paths are opt-in; missing → "Trace pending…" but the app
  //      still boots and serves the demo).
  //   - ERROR for fields the rest of the boot depends on (the dashboard
  //     iframe + data sync — empty <placeholder> means the agent didn't
  //     substitute and the app will half-work in confusing ways).
  const hasPlaceholder = (v: unknown): v is string =>
    typeof v === 'string' && /<[^>]+>/.test(v);

  const warnPlaceholders: Array<[string, string | undefined]> = [
    ['agentMlflowExperimentPath', result.data.agentMlflowExperimentPath],
    ['mlflowExperimentId', result.data.mlflowExperimentId],
  ];
  for (const [k, v] of warnPlaceholders) {
    if (hasPlaceholder(v)) {
      console.warn(
        `[config] ${k} contains an unfilled <placeholder>: ${v} — feature will be skipped at boot.`,
      );
    }
  }

  const errorPlaceholders: Array<[string, string | undefined]> = [
    ['dashboardId', result.data.dashboardId],
    ['branding.appName', result.data.branding?.appName],
    ['data.catalog', result.data.data?.catalog],
    ['data.schema', result.data.data?.schema],
  ];
  const unfilled = errorPlaceholders.filter(([, v]) => hasPlaceholder(v));
  if (unfilled.length > 0) {
    const list = unfilled
      .map(([k, v]) => `  • ${k} = ${v} (contains a <placeholder>)`)
      .join('\n');
    throw new Error(
      `[config] ${CONFIG_PATH} has unfilled placeholders — replace them with real values:\n${list}`,
    );
  }

  const cfg = result.data as AppConfig;
  const demoCatalog = process.env.DEMO_CATALOG ?? '';
  const demoSchema = process.env.DEMO_SCHEMA ?? '';
  cfg.ucExplorer = {
    defaultCatalog: cfg.ucExplorer?.defaultCatalog || demoCatalog,
    defaultSchema: cfg.ucExplorer?.defaultSchema || demoSchema,
  };
  cfg.terraformBaseline = {
    modulePath: cfg.terraformBaseline?.modulePath || process.env.TERRAFORM_MODULE_PATH || 'terraform',
    catalog:
      cfg.terraformBaseline?.catalog
      || process.env.TERRAFORM_CATALOG
      || cfg.ucExplorer.defaultCatalog,
    schema:
      cfg.terraformBaseline?.schema
      || process.env.TERRAFORM_SCHEMA
      || cfg.ucExplorer.defaultSchema,
    manifest: cfg.terraformBaseline?.manifest || 'terraform/declared-grants.json',
  };
  return cfg;
}

const appConfig = loadAppConfig();

// ============================================================================
// Error logging — compact by default so bulk-insert failures (DrizzleQueryError
// with thousands of params) don't flood the terminal.
// ============================================================================

function logErrorCompact(prefix: string, err: unknown): void {
  const e = err as {
    name?: string;
    message?: string;
    stack?: string;
    cause?: { code?: string; detail?: string; constraint?: string; table?: string };
    query?: string;
  };
  // Drizzle stuffs the full query + every parameter value into err.message,
  // which can be 100k+ chars on bulk inserts — truncate everything hard.
  const parts = [truncate(e.message ?? String(err), 300)];
  if (e.cause?.code) parts.push(`pg=${e.cause.code}`);
  if (e.cause?.constraint) parts.push(`constraint=${e.cause.constraint}`);
  if (e.cause?.detail) parts.push(`detail=${truncate(e.cause.detail, 200)}`);
  if (e.query) parts.push(`query=${truncate(e.query, 200)}`);

  // Print the header + stack frames in a SINGLE console.error call so the
  // logger emits one timestamp/level prefix with indented continuation lines.
  // Strip the leading "Name: message" lines from e.stack (Node duplicates the
  // message at the top) — we already printed the message above.
  const header = `${prefix} ${parts.join(' | ')}`;
  const frames = e.stack
    ? e.stack
        .split('\n')
        .filter((l) => l.trimStart().startsWith('at '))
        .slice(0, 12)
        .map((l) => truncate(l.trimStart(), 300))
        .join('\n')
    : '';
  console.error(frames ? `${header}\n${frames}` : header);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}… (+${s.length - n} chars)` : s;
}

process.on('unhandledRejection', (reason) => {
  logErrorCompact('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  logErrorCompact('[uncaughtException]', err);
});

// ============================================================================
// Boot
// ============================================================================

const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;

// ============================================================================
// Migration gate — block DB-dependent routes until migrations finish.
//
// Server starts accepting traffic immediately so the UI's shell can render,
// but any /api/* route that touches the DB waits on `migrationsReady`. If
// migrations finish in time → request proceeds normally. If they exceed the
// timeout → 503 + Retry-After so the browser retries (not a 500 the user
// has to chase).
//
// If migrations actually FAIL, `migrationsReady` rejects and the gate
// returns 503 with the real error message — which is a real bug worth
// surfacing, the LLM customizing the template can see it and act on it.
//
// NOTE: these are declared BEFORE createApp because onPluginsReady (which
// registers routes + kicks off background init) runs DURING createApp, so
// the closures it creates must see these bindings already initialized.
// ============================================================================

// Routes that don't touch the DB and should NOT block on migrations.
// Lets the AppHeader render user identity + warehouse status during boot
// instead of spinning a 503 until the gate clears.
const STARTUP_SAFE_PATHS = new Set([
  '/api/config',
  '/api/me',
  '/api/warehouse',
]);
const STARTUP_SAFE_PREFIXES = ['/api/log/', '/api/uc/'];

let migrationsDone = false;
let migrationsFailure: Error | null = null;
// Resolved once migrations + sync complete; rejected on failure.
// Re-assigned in the background-init block below; declared here so the
// middleware can close over it.
let migrationsReady: Promise<void> = new Promise(() => {
  // No-op until the background-init block replaces this.
});

// Drizzle handle — assigned in onPluginsReady once the lakebase pool exists,
// read by both the route registrations and the background-init block.
let db: ReturnType<typeof createDb>;

// No `const appkit =` — everything we need from the app is used inside
// onPluginsReady (via its typed `appkit` param); the server auto-starts and
// we never reference the returned map at the top level.
await createApp({
  plugins: [
    // Server auto-starts after onPluginsReady (AppKit 0.41+). The route
    // registration MUST run in onPluginsReady so it lands before the server
    // begins listening.
    server(),
    // The lakebase pool reads PGHOST/PGDATABASE/PGPORT/PGSSLMODE +
    // LAKEBASE_* from env; no config needed here. (Pre-0.41 this passed
    // branch/database to resolve resource bindings — those args were removed.)
    lakebase(),
    analytics({}),
  ],
  // Runs after plugins are set up but BEFORE the server listens — the place
  // to register custom routes (was `extend()` + manual `start()` pre-0.41).
  // The server auto-starts when this returns; background init is launched
  // here as fire-and-forget (the /api gate awaits `migrationsReady`).
  onPluginsReady(appkit) {
    db = createDb(appkit.lakebase.pool);
    // Routes registered here (before the server listens). Inlined rather than
    // hoisted to a helper so `appkit` keeps its precise PluginMap<T> type —
    // a standalone param typed as the generic createApp return collapses
    // appkit.server/.analytics to `never`.
    appkit.server.extend((app) => {
  // Gate DB-dependent routes until migrations are ready. Lives BEFORE
  // route registration so it applies to every /api/* handler.
  app.use('/api', async (req, res, next) => {
    if (migrationsDone) return next();
    if (STARTUP_SAFE_PATHS.has(req.path)) return next();
    if (STARTUP_SAFE_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    if (migrationsFailure) {
      // Real bug — the LLM running the template needs to see this in the
      // browser, not just the terminal. Don't try to recover here.
      res.status(503).json({
        error: `Database initialization failed: ${migrationsFailure.message}`,
      });
      return;
    }
    try {
      await Promise.race([
        migrationsReady,
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('startup-timeout')), 5000),
        ),
      ]);
      next();
    } catch (e) {
      const isTimeout =
        e instanceof Error && e.message === 'startup-timeout';
      res.set('Retry-After', '2').status(503).json({
        error: isTimeout
          ? 'Database is still initializing — please retry in a moment.'
          : `Database initialization failed: ${(e as Error).message}`,
      });
    }
  });

  registerConfigRoutes(app, {
    appConfig,
    getAgentExperimentId: () => null,
  });
  if (!appConfig.genieSpaceId) {
    console.warn(
      '[boot] config.genieSpaceId is empty — Genie-backed features will not be available. Set GENIE_SPACE_ID in .env (or the DAB) once the Genie space exists.',
    );
  }
  registerLineageRoutes(app, { db });
  registerUnityCatalogRoutes(app);
  registerPermissionRoutes(app);
  registerTerraformRoutes(app);
  registerActivityRoutes(app, { db });
  registerAdminRoutes(app, { db, data: appConfig.data });

  // Analytics charts — custom route that substitutes catalog/schema into the
  // SQL (the AppKit analytics plugin can't template identifiers). Served at
  // /api/charts/<key>; AnalyticsView feeds the rows to charts via `data`.
  if (appConfig.data) {
    registerChartRoutes(app, {
      query: (sql, params) => appkit.analytics.query(sql, params),
      catalog: appConfig.data.catalog,
      schema: appConfig.data.schema,
      queriesDir: resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../config/queries',
      ),
    });
  }

  if (process.env.DEV_CLIENT_ERROR_LOG === '1') {
    registerDevLogRoutes(app, logErrorCompact);
    console.log('[boot] DEV_CLIENT_ERROR_LOG=1 → /api/log/client-error enabled');
  }

  // Global error handler — Express 5 forwards unhandled async rejections
  // here automatically, so routes don't need individual try/catch blocks.
  // Logs a compact summary; huge params/queries (e.g. DrizzleQueryError with
  // 12k-param bulk inserts) would otherwise flood the terminal and crash it.
  app.use(
    (
      err: Error,
      req: import('express').Request,
      res: import('express').Response,
      _next: import('express').NextFunction,
    ) => {
      logErrorCompact(`[500] ${req.method} ${req.path}`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    },
  );
    }); // end appkit.server.extend

    startBackgroundInit();
  }, // end onPluginsReady
});
console.log(`[boot +${ms()}] Server listening — background init in progress…`);

// ============================================================================
// Background init — migrations, sync, MLflow. Launched (fire-and-forget) from
// onPluginsReady; the server is already listening by the time these run, and
// DB-dependent /api routes block on `migrationsReady` via the gate above.
// ============================================================================

function startBackgroundInit() {
migrationsReady = (async () => {
  try {
    const { syncError } = await runDbInit(db, appConfig.data, {
      runMigrations,
      syncFromDelta,
      onSyncError: (err) =>
        logErrorCompact(
          '[boot] Delta→Lakebase sync failed — serving with an empty/partial mirror:',
          err,
        ),
    });
    console.log(
      syncError
        ? `[boot +${ms()}] Migrations up to date; Delta sync DEGRADED (see error above) — app serving`
        : `[boot +${ms()}] Migrations up to date; Delta sync done`,
    );
    migrationsDone = true;
  } catch (e) {
    migrationsFailure = e instanceof Error ? e : new Error(String(e));
    logErrorCompact('[boot] DB migrations failed:', e);
    throw migrationsFailure;
  }
})();
migrationsReady.catch(() => {});
}
