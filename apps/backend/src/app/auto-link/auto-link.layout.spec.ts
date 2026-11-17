import { AutoLinkService } from './auto-link.service';

describe('AutoLinkService.saveLayout', () => {
  it('keeps devices and their per-type branches, drops anything for missing devices', async () => {
    const prisma = {
      device: { findMany: jest.fn(async () => [{ id: 'router' }, { id: 'tv' }]) },
      networkLayout: {
        upsert: jest.fn(async () => ({ updatedAt: new Date('2026-11-17T00:00:00Z') })),
      },
    };
    const svc = Object.create(AutoLinkService.prototype) as AutoLinkService;
    (svc as unknown as { prisma: unknown }).prisma = prisma;
    const out = await svc.saveLayout('hierarchy', {
      router: { x: 1, y: 1 },
      tv: { x: 2, y: 2 },
      'branch:router:wifi': { x: 3, y: 3 },
      'branch:gone:wifi': { x: 4, y: 4 },
      gone: { x: 5, y: 5 },
    });
    expect(Object.keys(out.positions).sort()).toEqual(['branch:router:wifi', 'router', 'tv']);
  });
});
