// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { ReleaseCheckerEnvironmentSchema } from "@amzn/innovation-sandbox-commons/lambda/environments/release-checker-environment.js";
import { generateSchemaData } from "@amzn/innovation-sandbox-commons/test/generate-schema-data.js";
import { mockContext } from "@amzn/innovation-sandbox-commons/test/lambdas/fixtures.js";
import { bulkStubEnv } from "@amzn/innovation-sandbox-commons/test/lambdas/utils.js";
import { SNSClient } from "@aws-sdk/client-sns";
import { SSMClient } from "@aws-sdk/client-ssm";
import type { ScheduledEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the IsbServices module
vi.mock("@amzn/innovation-sandbox-commons/isb-services/index.js", () => ({
  IsbServices: {
    gitHubService: vi.fn(),
    versionStoreService: vi.fn(),
    releaseNotificationService: vi.fn(),
  },
}));

import { IsbServices } from "@amzn/innovation-sandbox-commons/isb-services/index.js";
import type { ReleaseInfo } from "@amzn/innovation-sandbox-commons/isb-services/github-service.js";

const testEnv = generateSchemaData(ReleaseCheckerEnvironmentSchema, {
  GITHUB_OWNER: "test-owner",
  GITHUB_REPO: "test-repo",
  SSM_PARAMETER_NAME: "/isb/test/release-notifier/last-known-version",
  SNS_TOPIC_ARN: "arn:aws:sns:us-east-1:123456789012:test-topic",
  ISB_NAMESPACE: "test-namespace",
});

const ssmMock = mockClient(SSMClient);
const snsMock = mockClient(SNSClient);

let handler: (typeof import("@amzn/innovation-sandbox-release-checker/release-checker-handler.js"))["handler"];

// Mock services
const mockGitHubService = {
  getLatestRelease: vi.fn(),
};

const mockVersionStoreService = {
  getLastKnownVersion: vi.fn(),
  updateVersion: vi.fn(),
};

const mockReleaseNotificationService = {
  publishReleaseNotification: vi.fn(),
};

// Mock VersionStoreService static method
vi.mock("@amzn/innovation-sandbox-commons/isb-services/version-store-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@amzn/innovation-sandbox-commons/isb-services/version-store-service.js")>();
  return {
    ...actual,
    VersionStoreService: {
      ...actual.VersionStoreService,
      isNewVersion: (stored: string | null, fetched: string) => {
        if (stored === null) return false;
        return stored !== fetched;
      },
    },
  };
});

beforeEach(async () => {
  vi.resetModules();
  bulkStubEnv(testEnv);
  ssmMock.reset();
  snsMock.reset();
  vi.resetAllMocks();

  // Setup mock service factories
  vi.mocked(IsbServices.gitHubService).mockReturnValue(mockGitHubService as any);
  vi.mocked(IsbServices.versionStoreService).mockReturnValue(mockVersionStoreService as any);
  vi.mocked(IsbServices.releaseNotificationService).mockReturnValue(mockReleaseNotificationService as any);

  // Import handler after mocks are set up
  const module = await import("@amzn/innovation-sandbox-release-checker/release-checker-handler.js");
  handler = module.handler;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const createScheduledEvent = (): ScheduledEvent => ({
  version: "0",
  id: "test-event-id",
  "detail-type": "Scheduled Event",
  source: "aws.events",
  account: "123456789012",
  time: "2024-01-15T10:00:00Z",
  region: "us-east-1",
  resources: ["arn:aws:events:us-east-1:123456789012:rule/test-rule"],
  detail: {},
});

const createMockRelease = (overrides?: Partial<ReleaseInfo>): ReleaseInfo => ({
  tagName: "v1.2.0",
  releaseName: "Release 1.2.0",
  publishedAt: "2024-01-15T10:00:00Z",
  htmlUrl: "https://github.com/test-owner/test-repo/releases/tag/v1.2.0",
  body: "Release notes for v1.2.0",
  repoUrl: "https://github.com/test-owner/test-repo",
  ...overrides,
});

describe("Release Checker Handler", () => {
  describe("Environment Validation", () => {
    it("should throw error when environment variables are misconfigured", async () => {
      vi.unstubAllEnvs();

      const event = createScheduledEvent();

      await expect(handler(event, mockContext(testEnv))).rejects.toThrowError();
      
      try {
        await handler(event, mockContext(testEnv));
        expect.fail("Expected handler to throw");
      } catch (error) {
        expect((error as Error).name).toBe("EnvironmentValidatorError");
      }
    });
  });

  describe("New Release Detection and Notification", () => {
    /**
     * Validates: Requirements 2.1, 3.2, 3.3, 4.1
     * - 2.1: Lambda fetches latest release from configured GitHub repository
     * - 3.2: Compare fetched release tag with stored tag
     * - 3.3: When fetched release tag differs from stored tag, consider it a new release
     * - 4.1: When new release detected, publish message to SNS Topic
     */
    it("should detect new release and send notification when version differs", async () => {
      const mockRelease = createMockRelease({ tagName: "v2.0.0" });
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);
      mockVersionStoreService.getLastKnownVersion.mockResolvedValue("v1.0.0");
      mockVersionStoreService.updateVersion.mockResolvedValue(undefined);
      mockReleaseNotificationService.publishReleaseNotification.mockResolvedValue(undefined);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext(testEnv));

      // Verify GitHub service was called
      expect(mockGitHubService.getLatestRelease).toHaveBeenCalledTimes(1);

      // Verify version was retrieved from store
      expect(mockVersionStoreService.getLastKnownVersion).toHaveBeenCalledTimes(1);

      // Verify notification was published
      expect(mockReleaseNotificationService.publishReleaseNotification).toHaveBeenCalledTimes(1);
      expect(mockReleaseNotificationService.publishReleaseNotification).toHaveBeenCalledWith({
        repoOwner: testEnv.GITHUB_OWNER,
        repoName: testEnv.GITHUB_REPO,
        tagName: mockRelease.tagName,
        releaseName: mockRelease.releaseName,
        publishedAt: mockRelease.publishedAt,
        releaseUrl: mockRelease.htmlUrl,
        releaseNotes: mockRelease.body,
        repoUrl: mockRelease.repoUrl,
      });

      // Verify version was updated in store
      expect(mockVersionStoreService.updateVersion).toHaveBeenCalledTimes(1);
      expect(mockVersionStoreService.updateVersion).toHaveBeenCalledWith("v2.0.0");

      // Verify return message
      expect(result).toBe("New release detected: v1.0.0 -> v2.0.0");
    });

    it("should handle release with empty release name", async () => {
      const mockRelease = createMockRelease({
        tagName: "v2.0.0",
        releaseName: "",
      });
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);
      mockVersionStoreService.getLastKnownVersion.mockResolvedValue("v1.0.0");
      mockVersionStoreService.updateVersion.mockResolvedValue(undefined);
      mockReleaseNotificationService.publishReleaseNotification.mockResolvedValue(undefined);

      const event = createScheduledEvent();
      await handler(event, mockContext(testEnv));

      expect(mockReleaseNotificationService.publishReleaseNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          releaseName: "",
        }),
      );
    });

    it("should handle release with empty body", async () => {
      const mockRelease = createMockRelease({
        tagName: "v2.0.0",
        body: "",
      });
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);
      mockVersionStoreService.getLastKnownVersion.mockResolvedValue("v1.0.0");
      mockVersionStoreService.updateVersion.mockResolvedValue(undefined);
      mockReleaseNotificationService.publishReleaseNotification.mockResolvedValue(undefined);

      const event = createScheduledEvent();
      await handler(event, mockContext(testEnv));

      expect(mockReleaseNotificationService.publishReleaseNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          releaseNotes: "",
        }),
      );
    });
  });

  describe("No Notification When Version Unchanged", () => {
    /**
     * Validates: Requirements 3.2, 3.3
     * - 3.2: Compare fetched release tag with stored tag
     * - 3.3: When fetched release tag differs from stored tag, consider it a new release
     *        (inverse: when same, no new release)
     */
    it("should not send notification when version is unchanged", async () => {
      const mockRelease = createMockRelease({ tagName: "v1.0.0" });
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);
      mockVersionStoreService.getLastKnownVersion.mockResolvedValue("v1.0.0");

      const event = createScheduledEvent();
      const result = await handler(event, mockContext(testEnv));

      // Verify GitHub service was called
      expect(mockGitHubService.getLatestRelease).toHaveBeenCalledTimes(1);

      // Verify version was retrieved from store
      expect(mockVersionStoreService.getLastKnownVersion).toHaveBeenCalledTimes(1);

      // Verify NO notification was published
      expect(mockReleaseNotificationService.publishReleaseNotification).not.toHaveBeenCalled();

      // Verify version was NOT updated (no change needed)
      expect(mockVersionStoreService.updateVersion).not.toHaveBeenCalled();

      // Verify return message
      expect(result).toBe("No new release: current version is v1.0.0");
    });

    it("should handle case-sensitive version comparison", async () => {
      // Versions should be compared exactly as strings
      const mockRelease = createMockRelease({ tagName: "V1.0.0" });
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);
      mockVersionStoreService.getLastKnownVersion.mockResolvedValue("v1.0.0");
      mockVersionStoreService.updateVersion.mockResolvedValue(undefined);
      mockReleaseNotificationService.publishReleaseNotification.mockResolvedValue(undefined);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext(testEnv));

      // Different case should be treated as new release
      expect(mockReleaseNotificationService.publishReleaseNotification).toHaveBeenCalledTimes(1);
      expect(result).toBe("New release detected: v1.0.0 -> V1.0.0");
    });
  });

  describe("First Run Behavior", () => {
    /**
     * Validates: Requirements 3.5 (implied by 3.2, 3.3)
     * - When SSM parameter does not exist, treat as initial state
     * - Store current version without sending notification
     */
    it("should store version without notification on first run", async () => {
      const mockRelease = createMockRelease({ tagName: "v1.0.0" });
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);
      mockVersionStoreService.getLastKnownVersion.mockResolvedValue(null);
      mockVersionStoreService.updateVersion.mockResolvedValue(undefined);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext(testEnv));

      // Verify GitHub service was called
      expect(mockGitHubService.getLatestRelease).toHaveBeenCalledTimes(1);

      // Verify version was retrieved from store (returned null)
      expect(mockVersionStoreService.getLastKnownVersion).toHaveBeenCalledTimes(1);

      // Verify NO notification was published (first run)
      expect(mockReleaseNotificationService.publishReleaseNotification).not.toHaveBeenCalled();

      // Verify version WAS stored (initial state)
      expect(mockVersionStoreService.updateVersion).toHaveBeenCalledTimes(1);
      expect(mockVersionStoreService.updateVersion).toHaveBeenCalledWith("v1.0.0");

      // Verify return message
      expect(result).toBe("First run: stored initial version v1.0.0");
    });
  });

  describe("No Releases Found", () => {
    /**
     * Validates: Requirements 2.5
     * - If GitHub API returns no releases, log and exit gracefully
     */
    it("should handle repository with no releases gracefully", async () => {
      mockGitHubService.getLatestRelease.mockResolvedValue(null);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext(testEnv));

      // Verify GitHub service was called
      expect(mockGitHubService.getLatestRelease).toHaveBeenCalledTimes(1);

      // Verify no further operations were performed
      expect(mockVersionStoreService.getLastKnownVersion).not.toHaveBeenCalled();
      expect(mockVersionStoreService.updateVersion).not.toHaveBeenCalled();
      expect(mockReleaseNotificationService.publishReleaseNotification).not.toHaveBeenCalled();

      // Verify return message
      expect(result).toBe("No releases found for repository");
    });
  });

  describe("Error Handling", () => {
    /**
     * Validates: Requirements 2.4, 7.4
     * - Handle errors gracefully and log with full context
     */
    it("should propagate GitHub API errors", async () => {
      const error = new Error("GitHub API rate limited");
      mockGitHubService.getLatestRelease.mockRejectedValue(error);

      const event = createScheduledEvent();

      await expect(handler(event, mockContext(testEnv))).rejects.toThrow(
        "GitHub API rate limited",
      );

      // Verify no further operations were attempted
      expect(mockVersionStoreService.getLastKnownVersion).not.toHaveBeenCalled();
    });

    it("should propagate SSM errors when getting version", async () => {
      const mockRelease = createMockRelease();
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);

      const error = new Error("Access denied to SSM parameter");
      mockVersionStoreService.getLastKnownVersion.mockRejectedValue(error);

      const event = createScheduledEvent();

      await expect(handler(event, mockContext(testEnv))).rejects.toThrow(
        "Access denied to SSM parameter",
      );

      // Verify notification was not attempted
      expect(mockReleaseNotificationService.publishReleaseNotification).not.toHaveBeenCalled();
    });

    it("should propagate SNS errors when publishing notification", async () => {
      const mockRelease = createMockRelease({ tagName: "v2.0.0" });
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);
      mockVersionStoreService.getLastKnownVersion.mockResolvedValue("v1.0.0");

      const error = new Error("SNS topic not found");
      mockReleaseNotificationService.publishReleaseNotification.mockRejectedValue(error);

      const event = createScheduledEvent();

      await expect(handler(event, mockContext(testEnv))).rejects.toThrow(
        "SNS topic not found",
      );

      // Verify version was NOT updated (error occurred before)
      expect(mockVersionStoreService.updateVersion).not.toHaveBeenCalled();
    });

    it("should propagate SSM errors when updating version", async () => {
      const mockRelease = createMockRelease({ tagName: "v2.0.0" });
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);
      mockVersionStoreService.getLastKnownVersion.mockResolvedValue("v1.0.0");
      mockReleaseNotificationService.publishReleaseNotification.mockResolvedValue(undefined);

      const error = new Error("SSM service unavailable");
      mockVersionStoreService.updateVersion.mockRejectedValue(error);

      const event = createScheduledEvent();

      await expect(handler(event, mockContext(testEnv))).rejects.toThrow(
        "SSM service unavailable",
      );
    });

    it("should propagate SSM errors when storing initial version on first run", async () => {
      const mockRelease = createMockRelease({ tagName: "v1.0.0" });
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);
      mockVersionStoreService.getLastKnownVersion.mockResolvedValue(null);

      const error = new Error("SSM access denied");
      mockVersionStoreService.updateVersion.mockRejectedValue(error);

      const event = createScheduledEvent();

      await expect(handler(event, mockContext(testEnv))).rejects.toThrow(
        "SSM access denied",
      );

      // Verify no notification was attempted (first run)
      expect(mockReleaseNotificationService.publishReleaseNotification).not.toHaveBeenCalled();
    });
  });

  describe("Service Initialization", () => {
    it("should initialize services with correct configuration", async () => {
      const mockRelease = createMockRelease();
      mockGitHubService.getLatestRelease.mockResolvedValue(mockRelease);
      mockVersionStoreService.getLastKnownVersion.mockResolvedValue(mockRelease.tagName);

      const event = createScheduledEvent();
      await handler(event, mockContext(testEnv));

      // Verify GitHubService was initialized with correct params
      expect(IsbServices.gitHubService).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: testEnv.GITHUB_OWNER,
          repo: testEnv.GITHUB_REPO,
        }),
      );

      // Verify VersionStoreService was initialized with correct params
      expect(IsbServices.versionStoreService).toHaveBeenCalledWith(
        expect.objectContaining({
          parameterName: testEnv.SSM_PARAMETER_NAME,
        }),
      );

      // Verify ReleaseNotificationService was initialized with correct params
      expect(IsbServices.releaseNotificationService).toHaveBeenCalledWith(
        expect.objectContaining({
          topicArn: testEnv.SNS_TOPIC_ARN,
        }),
      );
    });
  });
});
