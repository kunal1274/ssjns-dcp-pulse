import { sanitize, text, toCsv } from './export';

describe('report export', () => {
  it('neutralises formula-like text but leaves numbers alone', () => {
    for (const v of ['=1+1', '+cmd', '-2+3', '@SUM(A1)', '\tx', '|calc'])
      expect(sanitize(v)).toBe(`'${v}`);
    for (const v of ['-500.00', '100', 'DEMO-001', 'Road']) expect(sanitize(v)).toBe(v);
  });

  it('shows N/A for an empty percentage and quotes CSV cells', () => {
    expect(text({ key: 'p', label: 'P', type: 'percent' }, null)).toBe('N/A');
    expect(text({ key: 'm', label: 'M', type: 'money' }, null)).toBe('');
    const csv = toCsv({
      title: 'T',
      meta: [['Report', 'T']],
      columns: [{ key: 'a', label: 'A', type: 'text' }],
      rows: [{ a: 'x, "y"' }, { a: '=evil()' }],
    }).toString('utf8');
    expect(csv).toContain('"x, ""y"""');
    expect(csv).toContain("'=evil()");
  });
});
