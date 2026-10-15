import type { Request } from 'express';
import { authHeaders } from './auth.js';

type StatementResponse = {
  statement_id: string;
  status: {
    state: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'CLOSED';
    error?: { message?: string };
  };
  result?: {
    data_array?: unknown[][];
  };
};

export function workspaceHost(): string {
  const raw = (process.env.DATABRICKS_HOST ?? '').replace(/\/+$/, '');
  if (!raw) throw new Error('DATABRICKS_HOST is not configured');
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

export function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export async function executeStatement(
  req: Request,
  statement: string,
  timeoutMs = 60_000,
): Promise<unknown[][]> {
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) throw new Error('DATABRICKS_WAREHOUSE_ID is not configured');

  const headers = await authHeaders(req);
  headers.set('Content-Type', 'application/json');
  const host = workspaceHost();
  const response = await fetch(`${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      warehouse_id: warehouseId,
      statement,
      wait_timeout: '30s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    }),
  });
  if (!response.ok) {
    throw new Error(`Statement Execution API returned ${response.status}: ${await response.text()}`);
  }

  let body = (await response.json()) as StatementResponse;
  const deadline = Date.now() + timeoutMs;
  while (body.status.state === 'PENDING' || body.status.state === 'RUNNING') {
    if (Date.now() >= deadline) throw new Error('Databricks SQL query timed out');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const poll = await fetch(
      `${host}/api/2.0/sql/statements/${encodeURIComponent(body.statement_id)}`,
      { headers },
    );
    if (!poll.ok) {
      throw new Error(`Statement status returned ${poll.status}: ${await poll.text()}`);
    }
    body = (await poll.json()) as StatementResponse;
  }

  if (body.status.state !== 'SUCCEEDED') {
    throw new Error(body.status.error?.message ?? `Databricks SQL query ${body.status.state}`);
  }
  return body.result?.data_array ?? [];
}
