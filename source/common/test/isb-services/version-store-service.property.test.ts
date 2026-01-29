// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";

import { VersionStoreService } from "@amzn/innovation-sandbox-commons/isb-services/version-store-service.js";

/**
 * Property-Based Tests for Version Comparison and State Management
 *
 * **Property 2: Version Comparison Correctly Identifies Differences**
 * For any two version strings (stored version and fetched version), the comparison
 * logic SHALL return true if and only if the strings are different, and false if
 * they are identical.
 *
 * **Validates: Requirements 3.2, 3.3**
 *
 * **Property 3: Version State Round-Trip Consistency**
 * For any valid version string, storing it in SSM Parameter Store and then reading
 * it back SHALL return the exact same string.
 *
 * **Validates: Requirements 3.1, 3.4**
 */
describe("VersionStoreService Property Tests", () => {
  // Arbitrary for generating version-like strings (e.g., v1.2.3, 2.0.0, release-1.0)
  const versionStringArbitrary = fc.oneof(
    // Semantic version format: v1.2.3 or 1.2.3
    fc.tuple(
      fc.option(fc.constant("v"), { nil: undefined }),
      fc.nat({ max: 100 }),
      fc.nat({ max: 100 }),
      fc.nat({ max: 100 }),
    ).map(([prefix, major, minor, patch]) => 
      `${prefix ?? ""}${major}.${minor}.${patch}`
    ),
    // Release tag format: release-1.0
    fc.tuple(
      fc.constantFrom("release-", "v", "version-", ""),
      fc.nat({ max: 100 }),
      fc.option(fc.nat({ max: 100 }), { nil: undefined }),
    ).map(([prefix, major, minor]) => 
      minor !== undefined ? `${prefix}${major}.${minor}` : `${prefix}${major}`
    ),
    // Arbitrary non-empty strings (for edge cases)
    fc.string({ minLength: 1, maxLength: 50 }),
  );

  describe("Property 2: Version Comparison Correctly Identifies Differences", () => {
    it("should return true when stored and fetched versions are different", () => {
      fc.assert(
        fc.property(
          versionStringArbitrary,
          versionStringArbitrary,
          (storedVersion, fetchedVersion) => {
            // Only test when versions are actually different
            fc.pre(storedVersion !== fetchedVersion);

            const result = VersionStoreService.isNewVersion(storedVersion, fetchedVersion);

            // When versions differ, isNewVersion should return true
            expect(result).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should return false when stored and fetched versions are identical", () => {
      fc.assert(
        fc.property(
          versionStringArbitrary,
          (version) => {
            const result = VersionStoreService.isNewVersion(version, version);

            // When versions are identical, isNewVersion should return false
            expect(result).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should return false when stored version is null (first run scenario)", () => {
      fc.assert(
        fc.property(
          versionStringArbitrary,
          (fetchedVersion) => {
            const result = VersionStoreService.isNewVersion(null, fetchedVersion);

            // When stored version is null (first run), should return false
            // This is because first run should not trigger a notification
            expect(result).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should be symmetric in difference detection (order matters for null, but not for non-null)", () => {
      fc.assert(
        fc.property(
          versionStringArbitrary,
          versionStringArbitrary,
          (versionA, versionB) => {
            // For non-null versions, the comparison should be symmetric
            // i.e., if A != B, then isNewVersion(A, B) === isNewVersion(B, A)
            const resultAB = VersionStoreService.isNewVersion(versionA, versionB);
            const resultBA = VersionStoreService.isNewVersion(versionB, versionA);

            // Both should agree on whether versions are different
            expect(resultAB).toBe(resultBA);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should correctly identify version changes for semantic versions", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 100 }),
          fc.nat({ max: 100 }),
          fc.nat({ max: 100 }),
          fc.nat({ max: 100 }),
          fc.nat({ max: 100 }),
          fc.nat({ max: 100 }),
          (major1, minor1, patch1, major2, minor2, patch2) => {
            const version1 = `v${major1}.${minor1}.${patch1}`;
            const version2 = `v${major2}.${minor2}.${patch2}`;

            const result = VersionStoreService.isNewVersion(version1, version2);

            // Result should be true if any component differs
            const expectedDifferent = 
              major1 !== major2 || minor1 !== minor2 || patch1 !== patch2;
            
            expect(result).toBe(expectedDifferent);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should treat version comparison as case-sensitive", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          (baseVersion) => {
            // Skip if version has no letters (case sensitivity doesn't apply)
            fc.pre(/[a-zA-Z]/.test(baseVersion));

            const upperVersion = baseVersion.toUpperCase();
            const lowerVersion = baseVersion.toLowerCase();

            // Skip if upper and lower are the same (no letters to change)
            fc.pre(upperVersion !== lowerVersion);

            const result = VersionStoreService.isNewVersion(upperVersion, lowerVersion);

            // Case-sensitive comparison should detect difference
            expect(result).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 3: Version State Round-Trip Consistency
   *
   * For any valid version string, storing it in SSM Parameter Store and then
   * reading it back SHALL return the exact same string.
   *
   * **Validates: Requirements 3.1, 3.4**
   */
  describe("Property 3: Version State Round-Trip Consistency", () => {
    const ssmMock = mockClient(SSMClient);

    beforeEach(() => {
      ssmMock.reset();
    });

    afterEach(() => {
      ssmMock.reset();
    });

    it("should return the exact same version string after store and retrieve round-trip", () => {
      fc.assert(
        fc.asyncProperty(
          versionStringArbitrary,
          async (version) => {
            // Simulate SSM storage: store the version and return it on get
            let storedValue: string | undefined;

            ssmMock.on(PutParameterCommand).callsFake((input) => {
              storedValue = input.Value;
              return {};
            });

            ssmMock.on(GetParameterCommand).callsFake(() => {
              return {
                Parameter: {
                  Value: storedValue,
                },
              };
            });

            const parameterName = "/test/version";
            const service = new VersionStoreService({
              ssmClient: new SSMClient({}),
              parameterName,
            });

            // Store the version
            await service.updateVersion(version);

            // Retrieve the version
            const retrievedVersion = await service.getLastKnownVersion();

            // The retrieved version should be exactly the same as what was stored
            expect(retrievedVersion).toBe(version);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should preserve version strings with special characters through round-trip", () => {
      fc.assert(
        fc.asyncProperty(
          fc.oneof(
            // Version with special characters (alphanumeric + common special chars)
            fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
            // Version with dashes, underscores, and dots (common in version strings)
            fc.stringMatching(/^[a-zA-Z0-9._-]{1,50}$/).filter((s) => s.length > 0),
          ),
          async (version) => {
            let storedValue: string | undefined;

            ssmMock.on(PutParameterCommand).callsFake((input) => {
              storedValue = input.Value;
              return {};
            });

            ssmMock.on(GetParameterCommand).callsFake(() => {
              return {
                Parameter: {
                  Value: storedValue,
                },
              };
            });

            const service = new VersionStoreService({
              ssmClient: new SSMClient({}),
              parameterName: "/test/version",
            });

            await service.updateVersion(version);
            const retrievedVersion = await service.getLastKnownVersion();

            // Round-trip should preserve the exact string
            expect(retrievedVersion).toBe(version);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should preserve semantic version formats through round-trip", () => {
      fc.assert(
        fc.asyncProperty(
          fc.tuple(
            fc.option(fc.constant("v"), { nil: undefined }),
            fc.nat({ max: 999 }),
            fc.nat({ max: 999 }),
            fc.nat({ max: 999 }),
            fc.option(
              fc.tuple(
                fc.constantFrom("-alpha", "-beta", "-rc", "-SNAPSHOT", ""),
                fc.option(fc.nat({ max: 99 }), { nil: undefined }),
              ),
              { nil: undefined },
            ),
          ).map(([prefix, major, minor, patch, prerelease]) => {
            let version = `${prefix ?? ""}${major}.${minor}.${patch}`;
            if (prerelease) {
              const [tag, num] = prerelease;
              version += tag;
              if (num !== undefined) {
                version += `.${num}`;
              }
            }
            return version;
          }),
          async (version) => {
            let storedValue: string | undefined;

            ssmMock.on(PutParameterCommand).callsFake((input) => {
              storedValue = input.Value;
              return {};
            });

            ssmMock.on(GetParameterCommand).callsFake(() => {
              return {
                Parameter: {
                  Value: storedValue,
                },
              };
            });

            const service = new VersionStoreService({
              ssmClient: new SSMClient({}),
              parameterName: "/test/version",
            });

            await service.updateVersion(version);
            const retrievedVersion = await service.getLastKnownVersion();

            // Semantic versions should be preserved exactly
            expect(retrievedVersion).toBe(version);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
