// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Logger } from "@aws-lambda-powertools/logger";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { backOff } from "exponential-backoff";

/**
 * Custom error class for Release Notification errors.
 */
export class ReleaseNotificationError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "ReleaseNotificationError";
  }
}

/**
 * Payload containing all release information for notification.
 */
export interface ReleaseNotificationPayload {
  repoOwner: string;
  repoName: string;
  tagName: string;
  releaseName: string;
  publishedAt: string;
  releaseUrl: string;
  releaseNotes: string;
  repoUrl: string;
}

export interface ReleaseNotificationServiceProps {
  snsClient: SNSClient;
  topicArn: string;
  logger?: Logger;
}

/**
 * Service for publishing release notifications to SNS.
 * Formats and sends email notifications when new GitHub releases are detected.
 */
export class ReleaseNotificationService {
  private readonly snsClient: SNSClient;
  private readonly topicArn: string;
  private readonly logger?: Logger;

  constructor(props: ReleaseNotificationServiceProps) {
    this.snsClient = props.snsClient;
    this.topicArn = props.topicArn;
    this.logger = props.logger;
  }

  /**
   * Publishes a release notification to the SNS topic.
   *
   * @param payload The release notification payload containing all release details.
   * @throws ReleaseNotificationError for access denied or other non-recoverable errors.
   */
  async publishReleaseNotification(payload: ReleaseNotificationPayload): Promise<void> {
    this.logger?.debug("Publishing release notification to SNS", {
      topicArn: this.topicArn,
      repoOwner: payload.repoOwner,
      repoName: payload.repoName,
      tagName: payload.tagName,
    });

    const subject = this.formatSubject(payload);
    const message = this.formatMessage(payload);

    try {
      await backOff(
        () => this.publishToSns(subject, message),
        {
          numOfAttempts: 3,
          startingDelay: 1000,
          timeMultiple: 2,
          retry: (error: Error) => {
            if (error instanceof ReleaseNotificationError) {
              return error.retryable;
            }
            // Retry on network/service errors
            return true;
          },
        },
      );

      this.logger?.info("Successfully published release notification to SNS", {
        topicArn: this.topicArn,
        repoOwner: payload.repoOwner,
        repoName: payload.repoName,
        tagName: payload.tagName,
      });
    } catch (error) {
      if (error instanceof ReleaseNotificationError) {
        this.logger?.error("Release notification error after retries", {
          error: error.message,
          topicArn: this.topicArn,
        });
        throw error;
      }

      this.logger?.error("Unexpected error publishing release notification", {
        error: error instanceof Error ? error.message : String(error),
        topicArn: this.topicArn,
      });
      throw error;
    }
  }

  /**
   * Formats the email subject with repository name and version tag.
   * Format: "New Release: {owner}/{repo} {tagName}"
   */
  formatSubject(payload: ReleaseNotificationPayload): string {
    return `New Release: ${payload.repoOwner}/${payload.repoName} ${payload.tagName}`;
  }

  /**
   * Formats the email body with all required fields.
   * Includes: repo name, tag, release name, date, notes, and URLs.
   */
  formatMessage(payload: ReleaseNotificationPayload): string {
    const lines = [
      `A new release has been published for ${payload.repoOwner}/${payload.repoName}!`,
      "",
      `Release: ${payload.releaseName || payload.tagName}`,
      `Version: ${payload.tagName}`,
      `Published: ${payload.publishedAt}`,
      "",
      "Release Notes:",
      payload.releaseNotes || "(No release notes provided)",
      "",
      `View Release: ${payload.releaseUrl}`,
      `Repository: ${payload.repoUrl}`,
    ];

    return lines.join("\n");
  }

  /**
   * Performs the actual SNS publish call with error handling.
   */
  private async publishToSns(subject: string, message: string): Promise<void> {
    try {
      await this.snsClient.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Subject: subject,
          Message: message,
        }),
      );

      this.logger?.debug("SNS PublishCommand completed successfully", {
        topicArn: this.topicArn,
      });
    } catch (error) {
      // Handle topic not found - not retryable
      if (error instanceof Error && error.name === "NotFoundException") {
        throw new ReleaseNotificationError(
          `SNS topic not found: ${this.topicArn}`,
          false,
        );
      }

      // Handle access denied - not retryable
      if (error instanceof Error && error.name === "AuthorizationErrorException") {
        throw new ReleaseNotificationError(
          `Access denied to SNS topic: ${this.topicArn}`,
          false,
        );
      }

      // Handle service unavailable - retryable
      if (
        error instanceof Error &&
        (error.name === "InternalErrorException" ||
          error.name === "ThrottledException" ||
          error.name === "KMSThrottlingException")
      ) {
        throw new ReleaseNotificationError(
          `SNS service error: ${error.message}`,
          true,
        );
      }

      // Re-throw other errors
      throw error;
    }
  }
}
