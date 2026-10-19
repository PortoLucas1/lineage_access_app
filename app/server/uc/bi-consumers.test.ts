import { describe, expect, it } from 'vitest';
import { tableMatches } from './bi-consumers.js';

describe('tableMatches', () => {
  it('matches a full three-level name', () => {
    expect(tableMatches('main.ops.rides', 'main.ops.rides')).toBe(true);
  });

  it('matches a leaf-name wildcard used for tenant-agnostic overlays', () => {
    expect(tableMatches('acme_catalog.bike.rides', '*.rides')).toBe(true);
    expect(tableMatches('acme_catalog.bike.stations', '*.rides')).toBe(false);
  });
});
