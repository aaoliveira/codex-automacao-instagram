import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('hashes passwords and verifies the original value without storing plaintext', async () => {
    const hash = await passwords.hash('correct-horse-battery-staple');
    expect(hash).not.toContain('correct-horse-battery-staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(passwords.verify(hash, 'correct-horse-battery-staple')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'wrong-password')).resolves.toBe(false);
  });
});
