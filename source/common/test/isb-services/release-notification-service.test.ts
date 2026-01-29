// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

import {
  ReleaseNotificationError,
  ReleaseNotificationPayload,
  ReleaseNotificationService,
} from "@amzn/innovation-sandbox-commons/isb-services/release-notification-service.js";

/**
 * Unit Tests for ReleaseNotificationService
 *
 * Tests cover:
 * - Message formatting with all fields
 * - Subject formatting
 * - SNS publish call
 *
 * **Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.7**
 */
describe("ReleaseNotificationService", () => {
  const snsMock = mockClient(SNSClient);
  const testTopicArn = "arn:aws:sns:us-east-1:123456789012:test-topic";

  const createTestPayload = (overrides?: Partial<ReleaseNotificationPayload>): ReleaseNotificationPayload => ({
    repoOwner: "test-owner",
    repoName: "test-repo",
    tagName: "v1.2.0",
    releaseName: "Release 1.2.0",
    publishedAt: "2024-01-15T10:30:00Z",
    releaseUrl: "https://github.com/test-owner/test-repo/releases/tag/v1.2.0",
    releaseNotes: "Bug fixes and improvements",
    repoUrl: "https://github.com/test-owner/test-repo",
    ...overrides,
  });

  beforeEach(() => {
    snsMock.reset();
  });

  afterEach(() => {
    snsMock.reset();
  });

  describe("formatSubject", () => {
    it("should format subject with repository name and version tag", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();
      const subject = service.formatSubject(payload);

      expect(subject).toBe("New Release: test-owner/test-repo v1.2.0");
    });

    it("should include owner, repo name, and tag in subject", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload({
        repoOwner: "aws-solutions",
        repoName: "innovation-sandbox",
        tagName: "v2.5.0",
      });
      const subject = service.formatSubject(payload);

      expect(subject).toContain("aws-solutions");
      expect(subject).toContain("innovation-sandbox");
      expect(subject).toContain("v2.5.0");
    });
  });

  describe("formatMessage", () => {
    it("should include repository name in message", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();
      const message = service.formatMessage(payload);

      expect(message).toContain("test-owner/test-repo");
    });

    it("should include tag name (version) in message", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();
      const message = service.formatMessage(payload);

      expect(message).toContain("v1.2.0");
      expect(message).toContain("Version: v1.2.0");
    });

    it("should include release name in message", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();
      const message = service.formatMessage(payload);

      expect(message).toContain("Release: Release 1.2.0");
    });

    it("should use tag name as fallback when release name is empty", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload({ releaseName: "" });
      const message = service.formatMessage(payload);

      expect(message).toContain("Release: v1.2.0");
    });

    it("should include published date in message", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();
      const message = service.formatMessage(payload);

      expect(message).toContain("Published: 2024-01-15T10:30:00Z");
    });

    it("should include release notes in message", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();
      const message = service.formatMessage(payload);

      expect(message).toContain("Release Notes:");
      expect(message).toContain("Bug fixes and improvements");
    });

    it("should show placeholder when release notes are empty", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload({ releaseNotes: "" });
      const message = service.formatMessage(payload);

      expect(message).toContain("(No release notes provided)");
    });

    it("should include release URL in message", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();
      const message = service.formatMessage(payload);

      expect(message).toContain("View Release: https://github.com/test-owner/test-repo/releases/tag/v1.2.0");
    });

    it("should include repository URL in message", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();
      const message = service.formatMessage(payload);

      expect(message).toContain("Repository: https://github.com/test-owner/test-repo");
    });

    it("should format message with all required fields", () => {
      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();
      const message = service.formatMessage(payload);

      // Verify all required fields are present (Requirements 4.3, 4.4, 4.5, 4.6)
      expect(message).toContain("test-owner");
      expect(message).toContain("test-repo");
      expect(message).toContain("v1.2.0");
      expect(message).toContain("Release 1.2.0");
      expect(message).toContain("2024-01-15T10:30:00Z");
      expect(message).toContain("Bug fixes and improvements");
      expect(message).toContain("https://github.com/test-owner/test-repo/releases/tag/v1.2.0");
      expect(message).toContain("https://github.com/test-owner/test-repo");
    });
  });

  describe("publishReleaseNotification", () => {
    it("should successfully publish notification to SNS", async () => {
      let capturedInput: any;

      snsMock.on(PublishCommand).callsFake((input) => {
        capturedInput = input;
        return { MessageId: "test-message-id" };
      });

      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();
      await service.publishReleaseNotification(payload);

      expect(capturedInput).toMatchObject({
        TopicArn: testTopicArn,
        Subject: "New Release: test-owner/test-repo v1.2.0",
      });
      expect(capturedInput.Message).toContain("test-owner/test-repo");
      expect(capturedInput.Message).toContain("v1.2.0");
    });

    it("should throw ReleaseNotificationError on topic not found", async () => {
      const notFoundError = new Error("Topic not found");
      notFoundError.name = "NotFoundException";

      snsMock.on(PublishCommand).rejects(notFoundError);

      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();

      await expect(service.publishReleaseNotification(payload)).rejects.toThrow(ReleaseNotificationError);
      await expect(service.publishReleaseNotification(payload)).rejects.toMatchObject({
        retryable: false,
      });
    });

    it("should throw ReleaseNotificationError on access denied", async () => {
      const authError = new Error("Access denied");
      authError.name = "AuthorizationErrorException";

      snsMock.on(PublishCommand).rejects(authError);

      const service = new ReleaseNotificationService({
        snsClient: new SNSClient({}),
        topicArn: testTopicArn,
      });

      const payload = createTestPayload();

      await expect(service.publishReleaseNotification(payload)).rejects.toThrow(ReleaseNotificationError);
      await expect(service.publishReleaseNotification(payload)).rejects.toMatchObject({
        retryable: false,
      });
    });
  });
});
