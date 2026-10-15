export type AccessLevel = 'full_control' | 'write' | 'read' | 'discover';
export type AssetCategory = 'catalog' | 'schema' | 'table' | 'volume' | 'function';

const FULL_CONTROL = new Set(['ALL_PRIVILEGES', 'MANAGE']);
const WRITE = new Set([
  'MODIFY',
  'CREATE_TABLE',
  'CREATE_SCHEMA',
  'CREATE_VOLUME',
  'CREATE_FUNCTION',
  'CREATE_MATERIALIZED_VIEW',
  'WRITE_VOLUME',
  'APPLY_TAG',
  'REFRESH',
]);
const READ = new Set(['SELECT', 'READ_VOLUME', 'EXECUTE', 'READ_METADATA']);

export function accessLevel(privileges: string[]): AccessLevel {
  const normalized = privileges.map((privilege) => privilege.toUpperCase());
  if (normalized.some((privilege) => FULL_CONTROL.has(privilege))) return 'full_control';
  if (normalized.some((privilege) => WRITE.has(privilege))) return 'write';
  if (normalized.some((privilege) => READ.has(privilege))) return 'read';
  return 'discover';
}

export function accessLevelLabel(level: AccessLevel): string {
  switch (level) {
    case 'full_control':
      return 'Full control';
    case 'write':
      return 'Write';
    case 'read':
      return 'Read / execute';
    case 'discover':
      return 'Discover / use';
  }
}

const APPLIES: Record<AssetCategory, Set<string>> = {
  catalog: new Set([
    'ALL_PRIVILEGES',
    'MANAGE',
    'USE_CATALOG',
    'BROWSE',
    'CREATE_SCHEMA',
    'APPLY_TAG',
    'READ_METADATA',
  ]),
  schema: new Set([
    'ALL_PRIVILEGES',
    'MANAGE',
    'USE_SCHEMA',
    'CREATE_TABLE',
    'CREATE_VOLUME',
    'CREATE_FUNCTION',
    'CREATE_MATERIALIZED_VIEW',
    'APPLY_TAG',
    'READ_METADATA',
    'BROWSE',
  ]),
  table: new Set([
    'ALL_PRIVILEGES',
    'MANAGE',
    'SELECT',
    'MODIFY',
    'APPLY_TAG',
    'READ_METADATA',
    'REFRESH',
  ]),
  volume: new Set([
    'ALL_PRIVILEGES',
    'MANAGE',
    'READ_VOLUME',
    'WRITE_VOLUME',
    'APPLY_TAG',
    'READ_METADATA',
  ]),
  function: new Set(['ALL_PRIVILEGES', 'MANAGE', 'EXECUTE', 'READ_METADATA']),
};

export function privilegeAppliesTo(privilege: string, category: AssetCategory): boolean {
  return APPLIES[category].has(privilege.toUpperCase());
}

export function grantKey(
  privilege: string,
  conveyedBy: string,
  inheritedFromType: string | null,
  inheritedFromName: string | null,
): string {
  return `${privilege}\u0000${conveyedBy}\u0000${inheritedFromType ?? ''}\u0000${inheritedFromName ?? ''}`;
}
