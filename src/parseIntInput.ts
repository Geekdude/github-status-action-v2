export default function parseIntInput(value: string, fallback: number, min: number, max: number): number {
  if (!/^-?\d+$/.test(value)) {
    return fallback;
  }

  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : fallback;
}
