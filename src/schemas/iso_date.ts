import { z, type ZodType } from 'zod';

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

interface IsoDateParts {
  year: number;
  month: number;
  day: number;
}

function parseIsoDateParts(value: string): IsoDateParts | null {
  const match = ISO_DATE_REGEX.exec(value);
  if (!match) return null;
  const [, yearPart, monthPart, dayPart] = match;
  return {
    year: Number(yearPart),
    month: Number(monthPart),
    day: Number(dayPart),
  };
}

function isMatchingUtcDate({ year, month, day }: IsoDateParts): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  const actual = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  ];
  const expected = [year, month, day];
  return expected.every((value, index) => value === actual[index]);
}

function isValidIsoDate(value: string): boolean {
  const parts = parseIsoDateParts(value);
  if (!parts) return false;
  return isMatchingUtcDate(parts);
}

export const IsoDateSchema: ZodType<string> = z
  .string()
  .refine((value) => isValidIsoDate(value), {
    error: 'Invalid date (YYYY-MM-DD)',
  });

export const IsoDateTimeSchema: ZodType<string> = z.iso.datetime({
  offset: true,
});
