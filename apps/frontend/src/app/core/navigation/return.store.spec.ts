import { NEW_DEVICE, ReturnStore, sortRows } from './return.store';

describe('ReturnStore', () => {
  it('remembers per device and moves a new-device target to its saved id', () => {
    const s = new ReturnStore();
    s.remember('d1', '/devices?q=fridge', 'Devices');
    expect(s.for('d1')?.url).toBe('/devices?q=fridge');
    expect(s.for('d2')).toBeNull();
    s.remember(NEW_DEVICE, '/devices?source=manual', 'Devices');
    s.adopt(NEW_DEVICE, 'd9');
    expect(s.for(NEW_DEVICE)).toBeNull();
    expect(s.for('d9')?.url).toBe('/devices?source=manual');
  });
});

describe('sortRows', () => {
  const rows = [
    { n: 'Show-Office', a: 'Office' },
    { n: 'apple tv', a: null },
    { n: 'Dot 10', a: 'Kitchen' },
    { n: 'Dot 9', a: 'Attic' },
  ];
  const g = { name: (r: (typeof rows)[number]) => r.n, area: (r: (typeof rows)[number]) => r.a };

  it('sorts case-insensitively with natural numbers', () => {
    expect(sortRows(rows, 'name', 'asc', g).map((r) => r.n)).toEqual(['apple tv', 'Dot 9', 'Dot 10', 'Show-Office']);
  });
  it('keeps blanks last in both directions', () => {
    expect(sortRows(rows, 'area', 'asc', g).map((r) => r.a)).toEqual(['Attic', 'Kitchen', 'Office', null]);
    expect(sortRows(rows, 'area', 'desc', g).map((r) => r.a)).toEqual(['Office', 'Kitchen', 'Attic', null]);
  });
  it('leaves order alone for an unknown key', () => {
    expect(sortRows(rows, 'nope', 'asc', g)).toBe(rows);
  });
});
