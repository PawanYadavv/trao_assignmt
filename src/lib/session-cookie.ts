/**
 * The session cookie name, in its own module with no Node built-in imports.
 *
 * `proxy.ts` runs on the Edge runtime, so anything it imports must be
 * Edge-safe. Importing this from `lib/auth.ts` would drag `node:crypto` in and
 * fail the build.
 */
export const SESSION_COOKIE = "prepwise_session";
