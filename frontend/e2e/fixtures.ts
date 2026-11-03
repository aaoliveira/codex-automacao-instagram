import { randomInt } from 'node:crypto';
import { expect, test as base } from '@playwright/test';

export { expect };
export type { Page } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, provide) => {
    const clientAddress = `198.51.${randomInt(0, 256)}.${randomInt(1, 255)}`;
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': clientAddress });
    await provide(page);
  },
});
