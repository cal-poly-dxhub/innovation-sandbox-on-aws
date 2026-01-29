// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Logger } from "@aws-lambda-powertools/logger";
import { backOff } from "exponential-backoff";
import { z } from "zod";

/**
 * Zod schema for validating GitHub API release response.
 * Handles null/missing fields gracefully by providing defaults.
 */
export const GitHubReleaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable().default(null),
  published_at: z.string(),
  html_url: z.string().url(),
  body: z.string().nullable().default(null),
});

export type GitHubRelease = z.infer<typeof GitHubReleaseSchema>;

/**
 * Parsed release information with null fields converted to empty strings.
 */
export interface ReleaseInfo {
  tagName: string;
  releaseName: string;
  publishedAt: string;
  htmlUrl: string;
  body: string;
  repoUrl: string;
}

/**
 * Custom error class for GitHub API errors.
 */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export interface GitHubServiceProps {
  owner: string;
  repo: string;
  logger?: Logger;
}

/**
 * Service for interacting with the GitHub Releases API.
 * Fetches the latest release from a configurable public GitHub repository.
 */
export class GitHubService {
  private readonly owner: string;
  private readonly repo: string;
  private readonly logger?: Logger;
  private readonly baseUrl = "https://api.github.com";

  constructor(props: GitHubServiceProps) {
    this.owner = props.owner;
    this.repo = props.repo;
    this.logger = props.logger;
  }

  /**
   * Fetches the latest release from the configured GitHub repository.
   * Uses exponential backoff for retryable errors (5xx, network errors).
   *
   * @returns The latest release information, or null if no releases exist.
   * @throws GitHubApiError for non-retryable errors (404, 403) after logging.
   */
  async getLatestRelease(): Promise<ReleaseInfo | null> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/releases/latest`;

    this.logger?.debug("Fetching latest release from GitHub API", {
      owner: this.owner,
      repo: this.repo,
      url,
    });

    try {
      const response = await backOff(
        () => this.fetchWithErrorHandling(url),
        {
          numOfAttempts: 3,
          startingDelay: 1000,
          timeMultiple: 2,
          retry: (error: Error) => {
            if (error instanceof GitHubApiError) {
              return error.retryable;
            }
            // Retry on network errors
            return true;
          },
        },
      );

      return response;
    } catch (error) {
      if (error instanceof GitHubApiError) {
        this.logger?.error("GitHub API error after retries", {
          error: error.message,
          statusCode: error.statusCode,
          owner: this.owner,
          repo: this.repo,
        });
        throw error;
      }

      this.logger?.error("Unexpected error fetching GitHub release", {
        error: error instanceof Error ? error.message : String(error),
        owner: this.owner,
        repo: this.repo,
      });
      throw error;
    }
  }

  /**
   * Performs the actual fetch with error handling for different HTTP status codes.
   */
  private async fetchWithErrorHandling(url: string): Promise<ReleaseInfo | null> {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Innovation-Sandbox-Release-Notifier",
      },
    });

    this.logger?.debug("GitHub API response received", {
      status: response.status,
      statusText: response.statusText,
    });

    // Handle 404 - repository not found or no releases
    if (response.status === 404) {
      const errorBody = await response.text();
      
      // Check if it's "no releases" vs "repo not found"
      if (errorBody.includes("Not Found")) {
        this.logger?.info("No releases found for repository", {
          owner: this.owner,
          repo: this.repo,
        });
        return null;
      }

      throw new GitHubApiError(
        `Repository not found: ${this.owner}/${this.repo}`,
        404,
        false,
      );
    }

    // Handle 403 - rate limited or forbidden
    if (response.status === 403) {
      const rateLimitReset = response.headers.get("X-RateLimit-Reset");
      const resetTime = rateLimitReset
        ? new Date(parseInt(rateLimitReset) * 1000).toISOString()
        : "unknown";

      this.logger?.error("GitHub API rate limited or forbidden", {
        rateLimitReset: resetTime,
        owner: this.owner,
        repo: this.repo,
      });

      throw new GitHubApiError(
        `GitHub API rate limited. Reset time: ${resetTime}`,
        403,
        false,
      );
    }

    // Handle 5xx - server errors (retryable)
    if (response.status >= 500) {
      throw new GitHubApiError(
        `GitHub API server error: ${response.status} ${response.statusText}`,
        response.status,
        true,
      );
    }

    // Handle other non-success status codes
    if (!response.ok) {
      throw new GitHubApiError(
        `GitHub API error: ${response.status} ${response.statusText}`,
        response.status,
        false,
      );
    }

    // Parse and validate the response
    const data = await response.json();

    this.logger?.debug("GitHub API response body", { data });

    const parseResult = GitHubReleaseSchema.safeParse(data);

    if (!parseResult.success) {
      this.logger?.error("Failed to parse GitHub release response", {
        errors: parseResult.error.errors,
        data,
      });
      throw new GitHubApiError(
        `Invalid GitHub release response: ${parseResult.error.message}`,
        undefined,
        false,
      );
    }

    const release = parseResult.data;

    return this.toReleaseInfo(release);
  }

  /**
   * Converts a GitHub API release response to our internal ReleaseInfo format.
   * Handles null fields by converting them to empty strings.
   */
  toReleaseInfo(release: GitHubRelease): ReleaseInfo {
    return {
      tagName: release.tag_name,
      releaseName: release.name ?? "",
      publishedAt: release.published_at,
      htmlUrl: release.html_url,
      body: release.body ?? "",
      repoUrl: `https://github.com/${this.owner}/${this.repo}`,
    };
  }
}
