export function toArray<T>(value: T | T[]) : T[] { 
  return Array.isArray(value) ? value : [value]; 
}

export function isDefined<T>(value: T | undefined | null) : value is T {
  return value != undefined && value != null;
}