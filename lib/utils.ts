// Improve type safety for className utility
export function cn(...inputs: Array<string | undefined | null | false | 0 | "">): string {
  return inputs.filter(Boolean).join(" ");
}


