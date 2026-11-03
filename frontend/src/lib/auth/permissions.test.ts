import { describe, expect, it } from 'vitest';
import { canManageTeam, roleLabel } from './permissions';

describe('permission helpers', () => {
  it('shows team controls only to owners and admins', () => {
    expect(canManageTeam('OWNER')).toBe(true);
    expect(canManageTeam('ADMIN')).toBe(true);
    expect(canManageTeam('MEMBER')).toBe(false);
  });

  it('provides readable role labels', () => {
    expect(roleLabel('OWNER')).toBe('Owner');
    expect(roleLabel('ADMIN')).toBe('Admin');
    expect(roleLabel('MEMBER')).toBe('Member');
  });
});
