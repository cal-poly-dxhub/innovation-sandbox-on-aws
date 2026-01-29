// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GitHubRelease,
  GitHubReleaseSchema,
  GitHubService,
} from "@amzn/innovation-sandbox-commons/isb-services/github-service.js";

/**
 * Property-Based Tests for GitHub Release Parsing
 *
 * **Property 1: GitHub Release Parsing Extracts All Required Fields**
 * For any valid GitHub API release response, parsing the response SHALL extract
 * the tag name, release name (or empty string if null), published date, release URL,
 * and body (or empty string if null) without data loss or corruption.
 *
 * **Validates: Requirements 2.3**
 */
describe("GitHubService Property Tests", () => {
  // Arbitrary for generating valid ISO date strings
  const validDateArbitrary = fc
    .integer({ min: 0, max: 4102444800000 }) // 1970-01-01 to 2100-01-01 in milliseconds
    .map((ms) => new Date(ms).toISOString());

  // Arbitrary for generating valid GitHub release objects
  const githubReleaseArbitrary = fc.record({
    tag_name: fc.string({ minLength: 1 }),
    name: fc.option(fc.string(), { nil: null }),
    published_at: validDateArbitrary,
    html_url: fc
      .webUrl({ validSchemes: ["https"] })
      .map((url) => url.replace(/\/$/, "")),
    body: fc.option(fc.string(), { nil: null }),
  });

  describe("Property 1: GitHub Release Parsing Extracts All Required Fields", () => {
    it("should extract all required fields from any valid GitHub release response", () => {
      const service = new GitHubService({
        owner: "test-owner",
        repo: "test-repo",
      });

      fc.assert(
        fc.property(githubReleaseArbitrary, (release) => {
          // First validate the release matches the schema
          const parseResult = GitHubReleaseSchema.safeParse(release);
          expect(parseResult.success).toBe(true);

          if (!parseResult.success) return;

          const parsedRelease = parseResult.data as GitHubRelease;

          // Convert to ReleaseInfo using the service method
          const releaseInfo = service.toReleaseInfo(parsedRelease);

          // Verify all required fields are extracted correctly
          // Tag name should be preserved exactly
          expect(releaseInfo.tagName).toBe(release.tag_name);

          // Release name should be the original value or empty string if null
          expect(releaseInfo.releaseName).toBe(release.name ?? "");

          // Published date should be preserved exactly
          expect(releaseInfo.publishedAt).toBe(release.published_at);

          // HTML URL should be preserved exactly
          expect(releaseInfo.htmlUrl).toBe(release.html_url);

          // Body should be the original value or empty string if null
          expect(releaseInfo.body).toBe(release.body ?? "");

          // Repo URL should be constructed correctly
          expect(releaseInfo.repoUrl).toBe(
            "https://github.com/test-owner/test-repo",
          );
        }),
        { numRuns: 100 },
      );
    });

    it("should handle null name field by converting to empty string", () => {
      const service = new GitHubService({
        owner: "test-owner",
        repo: "test-repo",
      });

      fc.assert(
        fc.property(
          fc.record({
            tag_name: fc.string({ minLength: 1 }),
            name: fc.constant(null),
            published_at: validDateArbitrary,
            html_url: fc
              .webUrl({ validSchemes: ["https"] })
              .map((url) => url.replace(/\/$/, "")),
            body: fc.option(fc.string(), { nil: null }),
          }),
          (release) => {
            const parseResult = GitHubReleaseSchema.safeParse(release);
            expect(parseResult.success).toBe(true);

            if (!parseResult.success) return;

            const releaseInfo = service.toReleaseInfo(
              parseResult.data as GitHubRelease,
            );

            // Null name should become empty string
            expect(releaseInfo.releaseName).toBe("");
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should handle null body field by converting to empty string", () => {
      const service = new GitHubService({
        owner: "test-owner",
        repo: "test-repo",
      });

      fc.assert(
        fc.property(
          fc.record({
            tag_name: fc.string({ minLength: 1 }),
            name: fc.option(fc.string(), { nil: null }),
            published_at: validDateArbitrary,
            html_url: fc
              .webUrl({ validSchemes: ["https"] })
              .map((url) => url.replace(/\/$/, "")),
            body: fc.constant(null),
          }),
          (release) => {
            const parseResult = GitHubReleaseSchema.safeParse(release);
            expect(parseResult.success).toBe(true);

            if (!parseResult.success) return;

            const releaseInfo = service.toReleaseInfo(
              parseResult.data as GitHubRelease,
            );

            // Null body should become empty string
            expect(releaseInfo.body).toBe("");
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should preserve non-null string values without modification", () => {
      const service = new GitHubService({
        owner: "test-owner",
        repo: "test-repo",
      });

      fc.assert(
        fc.property(
          fc.record({
            tag_name: fc.string({ minLength: 1 }),
            name: fc.string({ minLength: 1 }),
            published_at: validDateArbitrary,
            html_url: fc
              .webUrl({ validSchemes: ["https"] })
              .map((url) => url.replace(/\/$/, "")),
            body: fc.string({ minLength: 1 }),
          }),
          (release) => {
            const parseResult = GitHubReleaseSchema.safeParse(release);
            expect(parseResult.success).toBe(true);

            if (!parseResult.success) return;

            const releaseInfo = service.toReleaseInfo(
              parseResult.data as GitHubRelease,
            );

            // All non-null values should be preserved exactly
            expect(releaseInfo.tagName).toBe(release.tag_name);
            expect(releaseInfo.releaseName).toBe(release.name);
            expect(releaseInfo.publishedAt).toBe(release.published_at);
            expect(releaseInfo.htmlUrl).toBe(release.html_url);
            expect(releaseInfo.body).toBe(release.body);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
