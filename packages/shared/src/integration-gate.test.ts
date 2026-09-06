import { describe, expect, it } from 'vitest';
import { integrationTestsRequired, requireIntegrationDependency } from './integration-gate';

describe('requireIntegrationDependency', () => {
  it('reports a present dependency in every environment', () => {
    expect(requireIntegrationDependency('ffmpeg', true, {})).toBe(true);
    expect(requireIntegrationDependency('ffmpeg', true, { REQUIRE_INTEGRATION_TESTS: '1' })).toBe(
      true,
    );
  });

  it('lets a suite skip a missing dependency outside the gate', () => {
    expect(requireIntegrationDependency('ffmpeg', false, {})).toBe(false);
    expect(requireIntegrationDependency('ffmpeg', false, { REQUIRE_INTEGRATION_TESTS: '0' })).toBe(
      false,
    );
  });

  it('refuses to skip under the CI gate', () => {
    // The whole point of F15: a CI run whose FFmpeg install or `uv sync` failed
    // must fail, not report a green suite that executed none of these cases.
    expect(() =>
      requireIntegrationDependency('ffmpeg', false, { REQUIRE_INTEGRATION_TESTS: '1' }),
    ).toThrow(/ffmpeg is required when REQUIRE_INTEGRATION_TESTS=1/);
  });

  it('reads the gate flag', () => {
    expect(integrationTestsRequired({ REQUIRE_INTEGRATION_TESTS: '1' })).toBe(true);
    expect(integrationTestsRequired({})).toBe(false);
  });
});
