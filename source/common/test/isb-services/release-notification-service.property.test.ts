// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ReleaseNotificationPayload,
  ReleaseNotificationService,
} from "@amzn/innovation-sandbox-commons/isb-services/release-notification-service.js";
import { SNSClient } from "@aws-sdk/client-sns";

/**
 * Property-Based Tests for Notification Message Formatting
 *
 * **Property 4: Notification Message Contains All Required Fields**
 * For any valid release notification payload (containing repo owner, repo name,
 * tag name, release name, published date, release URL, release notes, and repo URL),
 * the formatted email message SHALL contain all of these fields, and the email
 * subject SHALL contain the repository name and version tag.
 *
 * **Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.7**
 */
describe("ReleaseNotificationService Property Tests", () => {
  // Arbitrary for generating valid ISO date strings
  const validDateArbitrary = fc
    .integer({ min: 0, max: 4102444800000 }) // 1970-01-01 to 2100-01-01 in milliseconds
    .map((ms) => new Date(ms).toISOString());

  // Arbitrary for generating valid URLs
  const validUrlArbitrary = fc
    .webUrl({ validSchemes: ["https"] })
    .map((url) => url.replace(/\/$/, ""));

  // Arbitrary for generating non-empty strings without newlines (for single-line fields)
  const nonEmptyStringArbitrary = fc
    .string({ minLength: 1, maxLength: 100 })
    .filter((s) => s.trim().length > 0 && !s.includes("\n"));

  // Arbitrary for generating release notes (can be multi-line or empty)
  const releaseNotesArbitrary = fc.oneof(
    fc.constant(""),
    fc.string({ minLength: 1, maxLength: 500 }),
  );

  // Arbitrary for generating valid release notification payloads
  const releaseNotificationPayloadArbitrary: fc.Arbitrary<ReleaseNotificationPayload> = fc.record({
    repoOwner: nonEmptyStringArbitrary,
    repoName: nonEmptyStringArbitrary,
    tagName: nonEmptyStringArbitrary,
    releaseName: fc.string({ maxLength: 100 }),
    publishedAt: validDateArbitrary,
    releaseUrl: validUrlArbitrary,
    releaseNotes: releaseNotesArbitrary,
    repoUrl: validUrlArbitrary,
  });

  // Create a service instance for testing (SNS client won't be used for formatting tests)
  const createService = () =>
    new ReleaseNotificationService({
      snsClient: new SNSClient({}),
      topicArn: "arn:aws:sns:us-east-1:123456789012:test-topic",
    });

  describe("Property 4: Notification Message Contains All Required Fields", () => {
    it("should include repository name in the formatted message", () => {
      const service = createService();

      fc.assert(
        fc.property(releaseNotificationPayloadArbitrary, (payload) => {
          const message = service.formatMessage(payload);

          // Message should contain the repo owner and repo name
          expect(message).toContain(payload.repoOwner);
          expect(message).toContain(payload.repoName);
        }),
        { numRuns: 100 },
      );
    });

    it("should include tag name (version) in the formatted message", () => {
      const service = createService();

      fc.assert(
        fc.property(releaseNotificationPayloadArbitrary, (payload) => {
          const message = service.formatMessage(payload);

          // Message should contain the tag name
          expect(message).toContain(payload.tagName);
        }),
        { numRuns: 100 },
      );
    });

    it("should include release name or tag name as fallback in the formatted message", () => {
      const service = createService();

      fc.assert(
        fc.property(releaseNotificationPayloadArbitrary, (payload) => {
          const message = service.formatMessage(payload);

          // Message should contain either the release name or tag name as fallback
          const expectedReleaseName = payload.releaseName || payload.tagName;
          expect(message).toContain(expectedReleaseName);
        }),
        { numRuns: 100 },
      );
    });

    it("should include published date in the formatted message", () => {
      const service = createService();

      fc.assert(
        fc.property(releaseNotificationPayloadArbitrary, (payload) => {
          const message = service.formatMessage(payload);

          // Message should contain the published date
          expect(message).toContain(payload.publishedAt);
        }),
        { numRuns: 100 },
      );
    });

    it("should include release notes or placeholder in the formatted message", () => {
      const service = createService();

      fc.assert(
        fc.property(releaseNotificationPayloadArbitrary, (payload) => {
          const message = service.formatMessage(payload);

          // Message should contain either the release notes or a placeholder
          if (payload.releaseNotes) {
            expect(message).toContain(payload.releaseNotes);
          } else {
            expect(message).toContain("(No release notes provided)");
          }
        }),
        { numRuns: 100 },
      );
    });

    it("should include release URL in the formatted message", () => {
      const service = createService();

      fc.assert(
        fc.property(releaseNotificationPayloadArbitrary, (payload) => {
          const message = service.formatMessage(payload);

          // Message should contain the release URL
          expect(message).toContain(payload.releaseUrl);
        }),
        { numRuns: 100 },
      );
    });

    it("should include repository URL in the formatted message", () => {
      const service = createService();

      fc.assert(
        fc.property(releaseNotificationPayloadArbitrary, (payload) => {
          const message = service.formatMessage(payload);

          // Message should contain the repository URL
          expect(message).toContain(payload.repoUrl);
        }),
        { numRuns: 100 },
      );
    });

    it("should include repository name and version tag in the subject", () => {
      const service = createService();

      fc.assert(
        fc.property(releaseNotificationPayloadArbitrary, (payload) => {
          const subject = service.formatSubject(payload);

          // Subject should contain the repo owner, repo name, and tag name
          expect(subject).toContain(payload.repoOwner);
          expect(subject).toContain(payload.repoName);
          expect(subject).toContain(payload.tagName);
        }),
        { numRuns: 100 },
      );
    });

    it("should format subject with correct structure", () => {
      const service = createService();

      fc.assert(
        fc.property(releaseNotificationPayloadArbitrary, (payload) => {
          const subject = service.formatSubject(payload);

          // Subject should follow the format: "New Release: {owner}/{repo} {tagName}"
          const expectedSubject = `New Release: ${payload.repoOwner}/${payload.repoName} ${payload.tagName}`;
          expect(subject).toBe(expectedSubject);
        }),
        { numRuns: 100 },
      );
    });

    it("should contain all required fields in a single formatted message", () => {
      const service = createService();

      fc.assert(
        fc.property(releaseNotificationPayloadArbitrary, (payload) => {
          const message = service.formatMessage(payload);
          const subject = service.formatSubject(payload);

          // Verify all required fields are present in message
          // Requirements 4.3: repo name, tag, release name, published date
          expect(message).toContain(payload.repoOwner);
          expect(message).toContain(payload.repoName);
          expect(message).toContain(payload.tagName);
          expect(message).toContain(payload.publishedAt);

          // Requirements 4.4: release notes
          if (payload.releaseNotes) {
            expect(message).toContain(payload.releaseNotes);
          } else {
            expect(message).toContain("(No release notes provided)");
          }

          // Requirements 4.5: direct link to GitHub release page
          expect(message).toContain(payload.releaseUrl);

          // Requirements 4.6: link to repository homepage
          expect(message).toContain(payload.repoUrl);

          // Requirements 4.7: subject contains repo name and version tag
          expect(subject).toContain(payload.repoOwner);
          expect(subject).toContain(payload.repoName);
          expect(subject).toContain(payload.tagName);
        }),
        { numRuns: 100 },
      );
    });
  });
});
