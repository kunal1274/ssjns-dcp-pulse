import { parseCsv } from './csv';
import { csvFundReleaseAdapter } from './csv-fund-release.adapter';

const config = {
  columns: {
    externalId: 'id',
    schemeCode: 'scheme',
    amount: 'amt',
    releaseDate: 'date',
    reference: 'ref',
  },
  maxRows: 3,
};

describe('synthetic fund-release CSV adapter', () => {
  it('parses quoted fields, doubled quotes, CRLF and a BOM', () => {
    expect(parseCsv('\ufeffa,"b,c"\r\n"x ""y""",2\n')).toEqual([
      ['a', 'b,c'],
      ['x "y"', '2'],
    ]);
  });

  it('maps configured columns to canonical releases and validates format only', () => {
    const r = csvFundReleaseAdapter.parse(
      'ID,Scheme,Amt,Date,Ref\nE1,demo-001,"1,000.50",2026-11-01,SANC-1\nE2,DEMO-001,0,2026-13-01,x',
      config,
    );
    expect(r.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        value: {
          externalId: 'E1',
          schemeCode: 'DEMO-001',
          amount: '1000.50',
          releaseDate: '2026-11-01',
          reference: 'SANC-1',
        },
      }),
    ]);
    expect(r.errors.map((e) => e.code)).toEqual([
      'INVALID_AMOUNT',
      'INVALID_DATE',
      'INVALID_REFERENCE',
    ]);
  });

  it('rejects files over the configured row limit and missing columns', () => {
    expect(
      csvFundReleaseAdapter.parse('id,scheme,amt,date,ref\n1\n2\n3\n4', config).errors[0].code,
    ).toBe('TOO_MANY_ROWS');
    expect(csvFundReleaseAdapter.parse('id,scheme', config).errors.map((e) => e.code)).toEqual([
      'MISSING_COLUMN',
      'MISSING_COLUMN',
      'MISSING_COLUMN',
    ]);
  });
});
