import type { Request } from 'express';
import declaredCatalogGrants from '../../config/declared-grants.json';
import type { GrantRow } from '../db/queries/lineage.js';
import { appAuthHeaders } from '../lib/auth.js';
import { workspaceHost } from '../lib/statement-execution.js';

type EffectivePrivilege = {
  privilege: string;
  inherited_from_name?: string;
  inherited_from_type?: string;
};

type EffectivePermissionsResponse = {
  privilege_assignments?: Array<{
    principal: string;
    privileges?: EffectivePrivilege[];
  }>;
};

type ComparisonStatus = NonNullable<GrantRow['comparisonStatus']>;

const TABLE_PRIVILEGES = new Set([
  'ALL_PRIVILEGES',
  'APPLY_TAG',
  'MANAGE',
  'MODIFY',
  'SELECT',
]);

export async function getUcGrantComparison(
  _req: Request,
  assetId: string,
): Promise<GrantRow[]> {
  const catalog = assetId.split('.')[0];
  if (!catalog) throw new Error('Unity Catalog asset id must be catalog.schema.table');

  const headers = await appAuthHeaders();
  const response = await fetch(
    `${workspaceHost()}/api/2.1/unity-catalog/effective-permissions/table/${encodeURIComponent(assetId)}`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) {
    throw new Error(`Effective Permissions API returned ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as EffectivePermissionsResponse;

  const compared = new Map<string, GrantRow>();
  const declared = declaredCatalogGrants as Record<string, string[]>;
  for (const [principal, privileges] of Object.entries(declared)) {
    for (const privilege of privileges.filter((item) => TABLE_PRIVILEGES.has(item))) {
      compared.set(
        comparisonKey(principal, privilege),
        grantRow(assetId, principal, privilege, 'declared_only', catalog, 'CATALOG'),
      );
    }
  }

  for (const assignment of body.privilege_assignments ?? []) {
    for (const item of assignment.privileges ?? []) {
      const inheritedName = item.inherited_from_name ?? assetId;
      const inheritedType = item.inherited_from_type ?? 'TABLE';
      const key = comparisonKey(assignment.principal, item.privilege);
      const matchesTerraform =
        inheritedType === 'CATALOG'
        && inheritedName === catalog
        && declared[assignment.principal]?.includes(item.privilege);
      compared.set(
        matchesTerraform
          ? key
          : comparisonKey(
              assignment.principal,
              item.privilege,
              `${inheritedType}:${inheritedName}`,
            ),
        grantRow(
          assetId,
          assignment.principal,
          item.privilege,
          matchesTerraform ? 'in_sync' : 'effective_only',
          inheritedName,
          inheritedType,
        ),
      );
    }
  }

  const order: Record<ComparisonStatus, number> = {
    effective_only: 0,
    declared_only: 1,
    in_sync: 2,
  };
  return [...compared.values()].sort((a, b) =>
    order[a.comparisonStatus!] - order[b.comparisonStatus!]
    || a.principal.localeCompare(b.principal)
    || String(a.privilege).localeCompare(String(b.privilege)),
  );
}

function grantRow(
  assetId: string,
  principal: string,
  privilege: string,
  comparisonStatus: ComparisonStatus,
  inheritedFromName: string,
  inheritedFromType: string,
): GrantRow {
  const nameParts = assetId.split('.');
  return {
    id: `${assetId}:${principal}:${privilege}:${inheritedFromType}:${inheritedFromName}`,
    assetId,
    assetName: nameParts[nameParts.length - 1] ?? assetId,
    assetType: 'table',
    assetHasPii: false,
    assetCriticality: null,
    principal,
    principalType: principalType(principal),
    displayName: null,
    department: null,
    privilege,
    memberCount: 1,
    effectivePrincipals: 1,
    isOverBroad: false,
    grantedBy: null,
    grantedDate: null,
    status: 'active',
    reviewedBy: null,
    auditTrail: [],
    comparisonStatus,
    inheritedFromName,
    inheritedFromType,
    declaredScope: comparisonStatus === 'effective_only'
      ? null
      : `CATALOG ${assetId.split('.')[0]}`,
  };
}

function comparisonKey(principal: string, privilege: string, scope = 'declared'): string {
  return `${principal}\u0000${privilege}\u0000${scope}`;
}

function principalType(principal: string): string {
  if (principal.includes('@')) return 'user';
  if (/^[0-9a-f-]{36}$/i.test(principal)) return 'service_principal';
  return 'group';
}
