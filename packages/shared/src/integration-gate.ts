/**
 * The gate that decides whether an integration suite may skip itself.
 *
 * Suites that need something outside the repo — FFmpeg on `PATH`, a
 * provisioned Python virtualenv — used to skip whenever it was missing, in
 * every environment. `REQUIRE_INTEGRATION_TESTS=1` only covered the database,
 * so a CI run whose `uv sync` or FFmpeg install had failed still reported a
 * green suite that had executed none of those cases (F15).
 */

/** Whether this run demands the integration suites actually execute. */
export function integrationTestsRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REQUIRE_INTEGRATION_TESTS === '1';
}

/**
 * Reports whether a suite's external dependency is present, and refuses to let
 * it silently skip under the CI gate: with `REQUIRE_INTEGRATION_TESTS=1` a
 * missing dependency throws, failing the file instead of quietly passing.
 */
export function requireIntegrationDependency(
  name: string,
  available: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (available) return true;
  if (integrationTestsRequired(env)) {
    throw new Error(
      `${name} is required when REQUIRE_INTEGRATION_TESTS=1; this suite must not be skipped in CI`,
    );
  }
  return false;
}
