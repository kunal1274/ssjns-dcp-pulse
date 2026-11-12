import { Prisma } from '@prisma/client';

/** Decimal(18,2) amount as a string: up to 16 integer digits and 2 decimals. */
export const MONEY_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

export const money = (v: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(v);
export const ZERO = new Prisma.Decimal(0);
export const sum = (values: (Prisma.Decimal | null | undefined)[]) =>
  values.reduce<Prisma.Decimal>((acc, v) => (v ? acc.add(v) : acc), ZERO);
export const fmt = (v: Prisma.Decimal | null | undefined) => (v ?? ZERO).toFixed(2);
