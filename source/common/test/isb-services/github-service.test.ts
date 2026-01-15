// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GitHubApiError,
  GitHubService,
} from "@amzn/innovation-sandbox-commons/isb-services/github-service.js";

describe("GitHubService", () => {
  const mockOwner = "test-owner";
  const mockRepo = "test-repo";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getLatestRelease", () => {
    it("should successfully fetch and parse a valid release", async () => {
      const mockRelease = {
        tag_name: "v1.2.0",
        name: "Release 1.2.0",
        published_at: "2024-01-15T10:30:00Z",
        html_url: "https://github.com/test-owner/test-repo/releases/tag/v1.2.0",
        body: "Release notes for v1.2.0",
      };

      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockRelease),
        headers: new Headers(),
      } as Response);

      const service = new GitHubService({ owner: mockOwner, repo: mockRepo });
      const result = await service.getLatestRelease();

      expect(result).toEqual({
        tagName: "v1.2.0",
        releaseName: "Release 1.2.0",
        publishedAt: "2024-01-15T10:30:00Z",
        htmlUrl: "https://github.com/test-owner/test-repo/releases/tag/v1.2.0",
        body: "Release notes for v1.2.0",
        repoUrl: "https://github.com/test-owner/test-repo",
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo/releases/latest",
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Innovation-Sandbox-Release-Notifier",
          }),
        }),
      );
    });

    it("should handle null name and body fields by converting to empty strings", async () => {
      const mockRelease = {
        tag_name: "v1.0.0",
        name: null,
        published_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/test-owner/test-repo/releases/tag/v1.0.0",
        body: null,
      };

      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockRelease),
        headers: new Headers(),
      } as Response);

      const service = new GitHubService({ owner: mockOwner, repo: mockRepo });
      const result = await service.getLatestRelease();

      expect(result).toEqual({
        tagName: "v1.0.0",
        releaseName: "",
        publishedAt: "2024-01-01T00:00:00Z",
        htmlUrl: "https://github.com/test-owner/test-repo/releases/tag/v1.0.0",
        body: "",
        repoUrl: "https://github.com/test-owner/test-repo",
      });
    });

    it("should return null when repository has no releases (404)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Not Found"),
        headers: new Headers(),
      } as Response);

      const service = new GitHubService({ owner: mockOwner, repo: mockRepo });
      const result = await service.getLatestRelease();

      expect(result).toBeNull();
    });

    it("should throw GitHubApiError on 403 rate limit error", async () => {
      const rateLimitResetTime = Math.floor(Date.now() / 1000) + 3600;
      const headers = new Headers();
      headers.set("X-RateLimit-Reset", rateLimitResetTime.toString());

      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        headers,
      } as Response);

      const service = new GitHubService({ owner: mockOwner, repo: mockRepo });

      await expect(service.getLatestRelease()).rejects.toThrow(GitHubApiError);
      await expect(service.getLatestRelease()).rejects.toMatchObject({
        statusCode: 403,
        retryable: false,
      });
    });

    it("should throw GitHubApiError with retryable flag on 5xx server errors", async () => {
      // Mock fetch to return 500 error
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers(),
      } as Response);

      const service = new GitHubService({ owner: mockOwner, repo: mockRepo });

      // The error should be marked as retryable
      try {
        await service.getLatestRelease();
        expect.fail("Expected promise to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubApiError);
        expect((error as GitHubApiError).statusCode).toBe(500);
        expect((error as GitHubApiError).retryable).toBe(true);
      }
    }, 15000);

    it("should throw GitHubApiError on invalid JSON response", async () => {
      const invalidRelease = {
        // Missing required tag_name field
        name: "Invalid Release",
        published_at: "2024-01-01T00:00:00Z",
        html_url: "not-a-valid-url", // Invalid URL format
      };

      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(invalidRelease),
        headers: new Headers(),
      } as Response);

      const service = new GitHubService({ owner: mockOwner, repo: mockRepo });

      await expect(service.getLatestRelease()).rejects.toThrow(GitHubApiError);
    });
  });

  describe("toReleaseInfo", () => {
    it("should convert GitHubRelease to ReleaseInfo correctly", () => {
      const service = new GitHubService({ owner: mockOwner, repo: mockRepo });

      const githubRelease = {
        tag_name: "v2.0.0",
        name: "Version 2.0.0",
        published_at: "2024-06-15T12:00:00Z",
        html_url: "https://github.com/test-owner/test-repo/releases/tag/v2.0.0",
        body: "New features in v2.0.0",
      };

      const result = service.toReleaseInfo(githubRelease);

      expect(result).toEqual({
        tagName: "v2.0.0",
        releaseName: "Version 2.0.0",
        publishedAt: "2024-06-15T12:00:00Z",
        htmlUrl: "https://github.com/test-owner/test-repo/releases/tag/v2.0.0",
        body: "New features in v2.0.0",
        repoUrl: "https://github.com/test-owner/test-repo",
      });
    });

    it("should handle null name by converting to empty string", () => {
      const service = new GitHubService({ owner: mockOwner, repo: mockRepo });

      const githubRelease = {
        tag_name: "v1.0.0",
        name: null,
        published_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/test-owner/test-repo/releases/tag/v1.0.0",
        body: "Some notes",
      };

      const result = service.toReleaseInfo(githubRelease);

      expect(result.releaseName).toBe("");
    });

    it("should handle null body by converting to empty string", () => {
      const service = new GitHubService({ owner: mockOwner, repo: mockRepo });

      const githubRelease = {
        tag_name: "v1.0.0",
        name: "Release 1.0.0",
        published_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/test-owner/test-repo/releases/tag/v1.0.0",
        body: null,
      };

      const result = service.toReleaseInfo(githubRelease);

      expect(result.body).toBe("");
    });
  });
});
