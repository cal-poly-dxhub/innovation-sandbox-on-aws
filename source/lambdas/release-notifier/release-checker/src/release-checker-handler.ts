// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { SNSClient } from "@aws-sdk/client-sns";
import { SSMClient } from "@aws-sdk/client-ssm";
import { Context, ScheduledEvent } from "aws-lambda";

import { IsbServices } from "@amzn/innovation-sandbox-commons/isb-services/index.js";
import {
  ReleaseCheckerEnvironment,
  ReleaseCheckerEnvironmentSchema,
} from "@amzn/innovation-sandbox-commons/lambda/environments/release-checker-environment.js";
import baseMiddlewareBundle from "@amzn/innovation-sandbox-commons/lambda/middleware/base-middleware-bundle.js";
import { ValidatedEnvironment } from "@amzn/innovation-sandbox-commons/lambda/middleware/environment-validator.js";
import { VersionStoreService } from "@amzn/innovation-sandbox-commons/isb-services/version-store-service.js";

const serviceName = "ReleaseChecker";
const tracer = new Tracer();
const logger = new Logger({ serviceName });

export const handler = baseMiddlewareBundle({
  logger,
  tracer,
  environmentSchema: ReleaseCheckerEnvironmentSchema,
  moduleName: "release-checker",
}).handler(checkForNewRelease);

export async function checkForNewRelease(
  _event: ScheduledEvent,
  context: Context & ValidatedEnvironment<ReleaseCheckerEnvironment>,
): Promise<string> {
  const { env } = context;

  // Initialize services
  const gitHubService = IsbServices.gitHubService({
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    logger,
  });

  const ssmClient = new SSMClient({});
  const versionStoreService = IsbServices.versionStoreService({
    ssmClient,
    parameterName: env.SSM_PARAMETER_NAME,
    logger,
  });

  const snsClient = new SNSClient({});
  const releaseNotificationService = IsbServices.releaseNotificationService({
    snsClient,
    topicArn: env.SNS_TOPIC_ARN,
    logger,
  });

  // Fetch latest release from GitHub
  logger.info("Fetching latest release from GitHub", {
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
  });

  const latestRelease = await gitHubService.getLatestRelease();

  if (!latestRelease) {
    logger.info("No releases found for repository", {
      owner: env.GITHUB_OWNER,
      repo: env.GITHUB_REPO,
    });
    return "No releases found for repository";
  }

  logger.debug("Latest release fetched", {
    tagName: latestRelease.tagName,
    releaseName: latestRelease.releaseName,
    publishedAt: latestRelease.publishedAt,
  });

  // Get last known version from SSM
  const lastKnownVersion = await versionStoreService.getLastKnownVersion();

  logger.debug("Last known version retrieved", {
    lastKnownVersion,
    currentVersion: latestRelease.tagName,
  });

  // Check if this is the first run (no stored version)
  if (lastKnownVersion === null) {
    logger.info("First run detected, storing current version without notification", {
      version: latestRelease.tagName,
    });

    await versionStoreService.updateVersion(latestRelease.tagName);

    return `First run: stored initial version ${latestRelease.tagName}`;
  }

  // Check if there's a new release
  const isNewRelease = VersionStoreService.isNewVersion(
    lastKnownVersion,
    latestRelease.tagName,
  );

  if (!isNewRelease) {
    logger.info("No new release detected", {
      currentVersion: latestRelease.tagName,
    });
    return `No new release: current version is ${latestRelease.tagName}`;
  }

  // New release detected - publish notification
  logger.info("New release detected, publishing notification", {
    previousVersion: lastKnownVersion,
    newVersion: latestRelease.tagName,
  });

  await releaseNotificationService.publishReleaseNotification({
    repoOwner: env.GITHUB_OWNER,
    repoName: env.GITHUB_REPO,
    tagName: latestRelease.tagName,
    releaseName: latestRelease.releaseName,
    publishedAt: latestRelease.publishedAt,
    releaseUrl: latestRelease.htmlUrl,
    releaseNotes: latestRelease.body,
    repoUrl: latestRelease.repoUrl,
  });

  // Update stored version
  await versionStoreService.updateVersion(latestRelease.tagName);

  logger.info("Successfully processed new release", {
    previousVersion: lastKnownVersion,
    newVersion: latestRelease.tagName,
  });

  return `New release detected: ${lastKnownVersion} -> ${latestRelease.tagName}`;
}
