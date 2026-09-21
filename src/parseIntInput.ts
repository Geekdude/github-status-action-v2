export default function parseIntInput(value: string, fallback: number, min: number, max: number): number {
  if (!/^-?\d+$/.test(value)) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
