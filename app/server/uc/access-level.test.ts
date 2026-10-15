import { describe, expect, it } from 'vitest';
import { accessLevel, accessLevelLabel, privilegeAppliesTo } from './access-level.js';

describe('accessLevel', () => {
  it('treats MANAGE and ALL_PRIVILEGES as full control', () => {
    expect(accessLevel(['SELECT', 'MANAGE'])).toBe('full_control');
    expect(accessLevel(['ALL_PRIVILEGES'])).toBe('full_control');
  });

  it('treats MODIFY as write even when SELECT is also present', () => {
    expect(accessLevel(['SELECT', 'MODIFY'])).toBe('write');
  });

  it('treats SELECT and EXECUTE as read / execute', () => {
    expect(accessLevel(['SELECT'])).toBe('read');
    expect(accessLevel(['EXECUTE'])).toBe('read');
    expect(accessLevelLabel('read')).toBe('Read / execute');
  });

  it('treats USE_ and BROWSE as discover / use', () => {
    expect(accessLevel(['USE_CATALOG', 'BROWSE'])).toBe('discover');
  });
});

describe('privilegeAppliesTo', () => {
  it('does not put SELECT on catalogs or USE_CATALOG on tables', () => {
    expect(privilegeAppliesTo('SELECT', 'table')).toBe(true);
    expect(privilegeAppliesTo('SELECT', 'catalog')).toBe(false);
    expect(privilegeAppliesTo('USE_CATALOG', 'table')).toBe(false);
    expect(privilegeAppliesTo('USE_CATALOG', 'catalog')).toBe(true);
  });
});
