/**
 * Input validation utilities for API routes.
 * Provides validation functions for common input types.
 */

/**
 * UUID validation regex (RFC 4122)
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format
 */
export function isValidUUID(value: string): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Validate UUID and throw if invalid
 */
export function requireValidUUID(value: string, fieldName = 'id'): void {
  if (!isValidUUID(value)) {
    throw new Error(`Invalid ${fieldName}: must be a valid UUID`);
  }
}

/**
 * Dice notation limits
 */
const MAX_DICE_COUNT = 100;
const MAX_DICE_SIDES = 1000;
const MIN_DICE_COUNT = 1;
const MIN_DICE_SIDES = 1;

/**
 * Parse and validate dice notation (e.g., "1d20", "2d6+3", "1d20+5")
 * Returns parsed values or null if invalid
 */
export function parseDiceNotation(notation: string): { count: number; sides: number; modifier: number } | null {
  if (typeof notation !== 'string') return null;

  const match = notation.trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) return null;

  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  // Validate bounds
  if (!Number.isFinite(count) || count < MIN_DICE_COUNT || count > MAX_DICE_COUNT) {
    return null;
  }
  if (!Number.isFinite(sides) || sides < MIN_DICE_SIDES || sides > MAX_DICE_SIDES) {
    return null;
  }
  if (!Number.isFinite(modifier)) {
    return null;
  }

  return { count, sides, modifier };
}

/**
 * Validate dice notation and throw if invalid
 */
export function validateDiceNotation(notation: string): void {
  const parsed = parseDiceNotation(notation);
  if (!parsed) {
    throw new Error(
      `Invalid dice notation: "${notation}". Must be in format "XdY" or "XdY±Z" where X is 1-${MAX_DICE_COUNT} and Y is 1-${MAX_DICE_SIDES}`,
    );
  }
}

/**
 * Validate array length
 */
export function validateArrayLength<T>(array: T[], maxLength: number, fieldName = 'array'): void {
  if (!Array.isArray(array)) {
    throw new Error(`${fieldName} must be an array`);
  }
  if (array.length > maxLength) {
    throw new Error(`${fieldName} must have at most ${maxLength} items`);
  }
}

/**
 * Validate string length
 */
export function validateStringLength(value: string, maxLength: number, fieldName = 'string'): void {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be at most ${maxLength} characters`);
  }
}

/**
 * Validate that a value is a non-empty string
 */
export function requireNonEmptyString(value: unknown, fieldName = 'field'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

