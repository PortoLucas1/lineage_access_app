import { describe, expect, it } from 'vitest';
import { principalsToQuery } from './permission-map.js';

describe('principalsToQuery', () => {
  it('keeps only the selected group, ignoring account-users conveyors', () => {
    expect(principalsToQuery('FinOps-team', 'group', ['account users', 'FinOps-team'])).toEqual([
      'FinOps-team',
    ]);
  });

  it('includes conveying groups for a user', () => {
    expect(principalsToQuery('lucas.porto@databricks.com', 'user', ['account users'])).toEqual([
      'lucas.porto@databricks.com',
      'account users',
    ]);
  });
});
