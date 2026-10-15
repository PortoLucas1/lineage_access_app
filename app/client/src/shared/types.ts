/**
 * Types that cross the client/server boundary. Keep in sync with
 * server/db/queries/lineage.ts.
 *
 * Domain: Northpeak Lineage & Access Console — the governance graph
 * (assets + lineage edges + access grants).
 */

export type GrantStatus = 'active' | 'flagged_for_review';

export type AssetRow = {
  id: string;
  assetName: string;
  assetType: string;
  platform: string | null;
  catalog: string | null;
  schema: string | null;
  domain: string | null;
  criticality: string | null;
  hasPii: boolean;
  ownerEmail: string | null;
  createdDate: string | null;
  lastRefreshed: string | null;
  downstreamCount: number;
  principalsWithAccess: number;
  hasOverBroadGrant: boolean;
};

export type EdgeRow = {
  id: string;
  sourceAssetId: string;
  sourceAssetName: string | null;
  sourceAssetType: string | null;
  sourceHasPii: boolean;
  targetAssetId: string;
  targetAssetName: string | null;
  targetAssetType: string | null;
  targetCriticality: string | null;
  edgeType: string | null;
  createdDate: string | null;
  isNewFromMv: boolean;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'flagged_for_review' | 'reviewed' | 'note';
  notes?: string;
  tool?: string;
};

export type GrantRow = {
  id: string;
  assetId: string;
  assetName: string | null;
  assetType: string | null;
  assetHasPii: boolean;
  assetCriticality: string | null;
  principal: string;
  principalType: string | null;
  displayName: string | null;
  department: string | null;
  privilege: string | null;
  memberCount: number;
  effectivePrincipals: number;
  isOverBroad: boolean;
  grantedBy: string | null;
  grantedDate: string | null;
  status: GrantStatus;
  reviewedBy: string | null;
  auditTrail: AuditEntry[];
  comparisonStatus?: 'in_sync' | 'declared_only' | 'effective_only';
  inheritedFromName?: string | null;
  inheritedFromType?: string | null;
  declaredScope?: string | null;
};

export type LineageNeighborhood = {
  seed: AssetRow | null;
  assets: AssetRow[];
  edges: EdgeRow[];
};

export type LineageKpis = {
  governedAssets: number;
  newEdges30d: number;
  piiPrincipals: number;
};

export type ColumnRow = {
  assetId: string;
  columnName: string;
  dataType: string | null;
  isPii: boolean;
  ordinal: number;
};

export type ColumnEdgeRow = {
  id: string;
  sourceAssetId: string;
  sourceColumn: string;
  targetAssetId: string;
  targetColumn: string;
  transform: string | null;
};

export type ColumnLineage = {
  assetId: string;
  columns: ColumnRow[];
  edges: ColumnEdgeRow[];
  neighborColumns: ColumnRow[];
};

export type IdentityKind = 'group' | 'user' | 'service_principal';

export type DirectoryIdentity = {
  id: string;
  kind: IdentityKind;
  displayName: string;
  handle: string;
};

export type DirectoryPage = {
  identities: DirectoryIdentity[];
  total: number;
  startIndex: number;
  count: number;
};

export type IdentityCapabilities = {
  canReadGroupMembers: boolean;
};

export type AccessLevel = 'full_control' | 'write' | 'read' | 'discover';
export type AssetCategory = 'catalog' | 'schema' | 'table' | 'volume' | 'function';

export type PrivilegeGrant = {
  privilege: string;
  inheritedFromType: string | null;
  inheritedFromName: string | null;
  conveyedBy: string;
};

export type MappedAsset = {
  category: AssetCategory;
  securableType: string;
  fullName: string;
  name: string;
  tableType: string | null;
  privileges: PrivilegeGrant[];
  accessLevel: AccessLevel;
};

export type PermissionMap = {
  catalog: string;
  principal: string;
  truncated: boolean;
  errors: string[];
  categories: Record<AssetCategory, MappedAsset[]>;
};

export type ActivityEvent = {
  grant_id: string;
  asset_name: string | null;
  principal: string;
  at: string;
  by: string;
  action: string;
  notes: string | null;
  tool: string | null;
};
