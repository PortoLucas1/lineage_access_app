/**
 * The Lineage & Access assistant.
 *
 * Built on `@openai/agents` pointed at Databricks' Responses API. This is a
 * Simple (Genie-only) demo: the agent's data tool is `ask_genie`, NOT MAS.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setTracingDisabled,
} from '@openai/agents';
import type { Tool } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { getPipelineExposure } from '../db/queries/index.js';
import { askGenieTool } from './tools/genie.js';
export type { ToolProgressEvent } from './tools/types.js';

export type ModelErrorDetail = {
  status: number;
  url: string;
  bodyText: string;
  code?: string;
  message?: string;
};

export type AgentContext = {
  db: AppDb;
  userEmail: string;
  req: Request;
  /** Genie space ID the `ask_genie` tool queries. Set in config/app.json as
   * `genieSpaceId` (from GENIE_SPACE_ID env). This is a Genie-only demo. */
  genieSpaceId: string;
  databricksHost: string;
  model: string;
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  modelError?: { current: ModelErrorDetail | null };
};

// Story seed asset — the new materialized view whose fan-out spiked.
const SEED_ASSET_ID = 'ASSET-0003'; // mv_exec_revenue_daily

function makeTools(ctx: AgentContext) {
  const findPipelineExposure = tool({
    name: 'find_pipeline_exposure',
    description:
      "Trace a seed asset's revenue pipeline in Lakebase. For the seed (default 'mv_exec_revenue_daily' / ASSET-0003), returns its downstream dashboards, notebook, and agent plus access grants on the seed and its upstream PII sources.",
    parameters: z.object({
      seed_asset_id: z
        .string()
        .nullable()
        .describe(
          "Asset id to trace, e.g. 'ASSET-0003' (mv_exec_revenue_daily). Pass null to default to the story seed.",
        ),
    }),
    execute: async ({ seed_asset_id }) =>
      mlflow.withSpan(
        async () => getPipelineExposure(ctx.db, seed_asset_id || SEED_ASSET_ID),
        {
          name: 'find_pipeline_exposure',
          spanType: mlflow.SpanType.TOOL,
          inputs: { seed_asset_id: seed_asset_id || SEED_ASSET_ID },
        },
      ),
  });

  const tools: Tool[] = [findPipelineExposure];
  if (ctx.genieSpaceId) {
    tools.push(askGenieTool(ctx, ctx.genieSpaceId));
  }
  return tools;
}

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  const headers = await authHeaders(ctx.req);
  const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const client = new OpenAI({
    apiKey: bearer,
    baseURL: `${ctx.databricksHost}/serving-endpoints`,
    maxRetries: 4,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Connection', 'close');
      let body = init?.body;
      if (typeof body === 'string' && body.startsWith('{')) {
        try {
          const parsed = JSON.parse(body) as {
            input?: Array<Record<string, unknown>>;
            messages?: Array<Record<string, unknown>>;
          };
          if (Array.isArray(parsed.input)) {
            for (const item of parsed.input) {
              const id = item.id;
              if (typeof id === 'string' && id.length > 64) {
                delete item.id;
              }
            }
          }
          if (Array.isArray(parsed.messages)) {
            for (const m of parsed.messages) {
              const content = (m as { content?: unknown }).content;
              if (Array.isArray(content)) {
                for (const part of content as Array<Record<string, unknown>>) {
                  if (part && typeof part === 'object') {
                    delete part.annotations;
                  }
                }
              }
            }
          }
          body = JSON.stringify(parsed);
        } catch {
          /* not JSON — pass through */
        }
      }
      const url =
        typeof input === 'string'
          ? input
          : (input as URL | Request).toString?.() ?? String(input);
      console.debug(
        `[openai-shim] → ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 2000) : '(non-string)'}`,
      );
      const tShim = Date.now();
      let resp: Response;
      try {
        resp = await fetch(input as Parameters<typeof fetch>[0], {
          ...init,
          headers,
          body,
          keepalive: false,
        });
      } catch (e) {
        console.error('[openai-shim] fetch threw', { url, error: e });
        throw e;
      }
      console.debug(
        `[openai-shim] ← ${resp.status} ${resp.statusText} from ${url} in ${Date.now() - tShim}ms (content-type: ${resp.headers.get('content-type') ?? '?'})`,
      );
      if (!resp.ok) {
        try {
          const text = await resp.clone().text();
          let code: string | undefined;
          let message: string | undefined;
          try {
            const parsed = JSON.parse(text) as { error_code?: string; message?: string };
            code = parsed.error_code;
            message = parsed.message;
          } catch {
            /* body wasn't JSON — keep raw text */
          }
          if (ctx.modelError) {
            ctx.modelError.current = {
              status: resp.status,
              url,
              bodyText: text,
              code,
              message,
            };
          }
          console.error(
            `[openai-shim] ${resp.status} from ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 4000) : '(non-string)'}\n  response_body: ${text.slice(0, 4000)}`,
          );
        } catch (e) {
          console.error('[openai-shim] failed to clone error response', e);
        }
      }
      return resp;
    },
  });
  setDefaultOpenAIClient(client);
  setTracingDisabled(true);
}

export function buildAgent(ctx: AgentContext): Agent {
  return new Agent({
    name: 'LineageOps',
    model: ctx.model,
    modelSettings: {
      reasoning: { effort: 'low', summary: 'auto' },
      store: false,
    },
    instructions: `
You are the governance assistant for the Lineage & Access Console. You help
users see the LINEAGE of any Unity Catalog asset, WHO can access it, and the
downstream BI consumers (Databricks dashboards, Tableau overlays, notebooks,
and jobs). Be decisive, concise, and lead with the most relevant finding.

════════════════════════════════════════════════════════════
TOOLS
════════════════════════════════════════════════════════════

ask_genie(question) — natural-language questions over the governance data
  (lineage + grants) via the AI/BI Genie space. Use for WHAT-FEEDS / WHO-CAN-
  ACCESS / investigative questions. Prefer ONE focused question.

find_pipeline_exposure(seed_asset_id) — traces a seed asset's pipeline in
  Lakebase: downstream consumers plus access grants on the seed and its
  upstream sources. Pass null only when a default seed is configured.

════════════════════════════════════════════════════════════
OPERATING MODE
════════════════════════════════════════════════════════════

If the user asks "what feeds X", "who can access Y", "what breaks if Z
changes" → call ask_genie ONCE with a focused question, then synthesize.
To trace a pipeline, call find_pipeline_exposure with the selected asset.

════════════════════════════════════════════════════════════
TONE
════════════════════════════════════════════════════════════
Lead with the answer. No preamble. Numbers come from tool calls, not memory.
Never claim a tool ran that didn't.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };
