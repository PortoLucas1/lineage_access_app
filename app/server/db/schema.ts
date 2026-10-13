import {
  text,
  timestamp,
  date,
  uuid,
  integer,
  numeric,
  jsonb,
  pgSchema,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Lakebase schema, under `app.*` — Northpeak Lineage & Access Console.
 *
 * Three groups:
 *   1. Chat state      (conversations, messages, feedback) — REUSED AS-IS.
 *   2. Delta mirror    (assets, lineage_edges, access_grants) — the OLTP
 *                      copies of the lakehouse `gold_*` tables that
 *                      db/sync.ts pulls at boot.
 *   3. Write-surface   `access_grants.status` / `reviewedBy` / `auditTrail`
 *                      are reserved for grant-review writes.
 */
export const appSchema = pgSchema('app');

// ============================================================================
// Chat state
// ============================================================================

export const conversations = appSchema.table(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userEmail: text('user_email').notNull(),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['default', 'demo_dock'] })
      .notNull()
      .default('default'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversations_user_idx').on(t.userEmail, t.updatedAt),
    index('conversations_kind_idx').on(t.userEmail, t.kind),
  ],
);

export const messages = appSchema.table(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    position: integer('position').notNull(),
    traceId: text('trace_id'),
    thinking: jsonb('thinking').$type<ThinkingEntry[]>().notNull().default([]),
    error: text('error'),
    canceled: boolean('canceled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_convo_pos_uq').on(t.conversationId, t.position),
  ],
);

export const feedback = appSchema.table(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    value: text('value', { enum: ['up', 'down'] }).notNull(),
    rationale: text('rationale'),
    traceId: text('trace_id'),
    mlflowAssessmentId: text('mlflow_assessment_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('feedback_message_idx').on(t.messageId)],
);

// ============================================================================
// Delta mirror — governance graph (gold_assets / gold_lineage_edges /
// gold_access_grants)
// ============================================================================

// One row per governed asset (table / MV / view / Databricks dashboard /
// Tableau dashboard / notebook / agent). Mirror of gold_assets.
export const assets = appSchema.table(
  'assets',
  {
    id: text('id').primaryKey(), // asset_id (ASSET-NNNN)
    assetName: text('asset_name').notNull(),
    assetType: text('asset_type').notNull(),
    platform: text('platform'),
    catalog: text('catalog'),
    schema: text('schema'),
    domain: text('domain'),
    criticality: text('criticality'),
    hasPii: boolean('has_pii').notNull().default(false),
    ownerEmail: text('owner_email'),
    createdDate: date('created_date'),
    lastRefreshed: date('last_refreshed'),
    downstreamCount: integer('downstream_count').notNull().default(0),
    blastRadiusUsd: numeric('blast_radius_usd'),
    principalsWithAccess: integer('principals_with_access').notNull().default(0),
    hasOverBroadGrant: boolean('has_over_broad_grant').notNull().default(false),
    annualValueUsd: numeric('annual_value_usd'),
  },
  (t) => [
    index('assets_type_idx').on(t.assetType),
    index('assets_downstream_idx').on(t.downstreamCount),
    index('assets_pii_idx').on(t.hasPii),
  ],
);

// One row per lineage edge (source → target). Mirror of gold_lineage_edges.
export const lineageEdges = appSchema.table(
  'lineage_edges',
  {
    id: text('id').primaryKey(), // edge_id
    sourceAssetId: text('source_asset_id').notNull(),
    sourceAssetName: text('source_asset_name'),
    sourceAssetType: text('source_asset_type'),
    sourceHasPii: boolean('source_has_pii').notNull().default(false),
    targetAssetId: text('target_asset_id').notNull(),
    targetAssetName: text('target_asset_name'),
    targetAssetType: text('target_asset_type'),
    targetCriticality: text('target_criticality'),
    edgeType: text('edge_type'),
    createdDate: date('created_date'),
    isNewFromMv: boolean('is_new_from_mv').notNull().default(false),
  },
  (t) => [
    index('lineage_source_idx').on(t.sourceAssetId),
    index('lineage_target_idx').on(t.targetAssetId),
  ],
);

// One row per access grant. Mirror of gold_access_grants PLUS the write
// surface (status / reviewedBy / auditTrail).
export const accessGrants = appSchema.table(
  'access_grants',
  {
    id: text('id').primaryKey(), // grant_id
    assetId: text('asset_id').notNull(),
    assetName: text('asset_name'),
    assetType: text('asset_type'),
    assetHasPii: boolean('asset_has_pii').notNull().default(false),
    assetCriticality: text('asset_criticality'),
    principal: text('principal').notNull(),
    principalType: text('principal_type'),
    displayName: text('display_name'),
    department: text('department'),
    privilege: text('privilege'),
    memberCount: integer('member_count').notNull().default(1),
    effectivePrincipals: integer('effective_principals').notNull().default(1),
    isOverBroad: boolean('is_over_broad').notNull().default(false),
    grantedBy: text('granted_by'),
    grantedDate: date('granted_date'),

    // Grant review status — 'active' unless marked for review.
    status: text('status', { enum: ['active', 'flagged_for_review'] })
      .notNull()
      .default('active'),
    reviewedBy: text('reviewed_by'),
    // Append-only audit trail. Each entry: { at, by, action, notes?, tool? }
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('grants_asset_idx').on(t.assetId),
    index('grants_overbroad_idx').on(t.isOverBroad),
    index('grants_status_idx').on(t.status),
  ],
);

// One row per governed object's column/field. Mirror of gold_columns.
// Includes tables, views, dashboards, notebooks, and agents.
export const assetColumns = appSchema.table(
  'asset_columns',
  {
    id: text('id').primaryKey(), // `${assetId}:${columnName}`
    assetId: text('asset_id').notNull(),
    columnName: text('column_name').notNull(),
    dataType: text('data_type'),
    isPii: boolean('is_pii').notNull().default(false),
    ordinal: integer('ordinal').notNull().default(0),
  },
  (t) => [index('asset_columns_asset_idx').on(t.assetId)],
);

// One row per column→column lineage edge (source col → target col + transform).
// Mirror of gold_column_lineage.
export const columnLineage = appSchema.table(
  'column_lineage',
  {
    id: text('id').primaryKey(), // col_edge_id
    sourceAssetId: text('source_asset_id').notNull(),
    sourceColumn: text('source_column').notNull(),
    targetAssetId: text('target_asset_id').notNull(),
    targetColumn: text('target_column').notNull(),
    transform: text('transform'),
  },
  (t) => [
    index('column_lineage_target_idx').on(t.targetAssetId),
    index('column_lineage_source_idx').on(t.sourceAssetId),
  ],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type AuditEntry = {
  at: string;
  by: string;
  action: 'flagged_for_review' | 'reviewed' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
