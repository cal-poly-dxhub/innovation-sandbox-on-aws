// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Logger } from "@aws-lambda-powertools/logger";
import {
  GetParameterCommand,
  ParameterNotFound,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import { backOff } from "exponential-backoff";

/**
 * Custom error class for Version Store errors.
 */
export class VersionStoreError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "VersionStoreError";
  }
}

export interface VersionStoreServiceProps {
  ssmClient: SSMClient;
  parameterName: string;
  logger?: Logger;
}

/**
 * Service for managing version state in SSM Parameter Store.
 * Stores and retrieves the last known release version for comparison.
 */
export class VersionStoreService {
  private readonly ssmClient: SSMClient;
  private readonly parameterName: string;
  private readonly logger?: Logger;

  constructor(props: VersionStoreServiceProps) {
    this.ssmClient = props.ssmClient;
    this.parameterName = props.parameterName;
    this.logger = props.logger;
  }

  /**
   * Retrieves the last known version from SSM Parameter Store.
   *
   * @returns The last known version string, or null if the parameter does not exist.
   * @throws VersionStoreError for access denied or other non-recoverable errors.
   */
  async getLastKnownVersion(): Promise<string | null> {
    this.logger?.debug("Fetching last known version from SSM Parameter Store", {
      parameterName: this.parameterName,
    });

    try {
      const result = await backOff(
        () => this.fetchParameter(),
        {
          numOfAttempts: 3,
          startingDelay: 1000,
          timeMultiple: 2,
          retry: (error: Error) => {
            if (error instanceof VersionStoreError) {
              return error.retryable;
            }
            // Retry on network/service errors
            return true;
          },
        },
      );

      return result;
    } catch (error) {
      if (error instanceof VersionStoreError) {
        this.logger?.error("Version store error after retries", {
          error: error.message,
          parameterName: this.parameterName,
        });
        throw error;
      }

      this.logger?.error("Unexpected error fetching version from SSM", {
        error: error instanceof Error ? error.message : String(error),
        parameterName: this.parameterName,
      });
      throw error;
    }
  }

  /**
   * Updates the stored version in SSM Parameter Store.
   * Creates the parameter if it does not exist.
   *
   * @param version The new version string to store.
   * @throws VersionStoreError for access denied or other non-recoverable errors.
   */
  async updateVersion(version: string): Promise<void> {
    this.logger?.debug("Updating version in SSM Parameter Store", {
      parameterName: this.parameterName,
      version,
    });

    try {
      await backOff(
        () => this.putParameter(version),
        {
          numOfAttempts: 3,
          startingDelay: 1000,
          timeMultiple: 2,
          retry: (error: Error) => {
            if (error instanceof VersionStoreError) {
              return error.retryable;
            }
            // Retry on network/service errors
            return true;
          },
        },
      );

      this.logger?.info("Successfully updated version in SSM Parameter Store", {
        parameterName: this.parameterName,
        version,
      });
    } catch (error) {
      if (error instanceof VersionStoreError) {
        this.logger?.error("Version store error after retries", {
          error: error.message,
          parameterName: this.parameterName,
        });
        throw error;
      }

      this.logger?.error("Unexpected error updating version in SSM", {
        error: error instanceof Error ? error.message : String(error),
        parameterName: this.parameterName,
      });
      throw error;
    }
  }

  /**
   * Compares two version strings to determine if they are different.
   *
   * @param storedVersion The currently stored version (can be null for first run).
   * @param fetchedVersion The newly fetched version.
   * @returns true if versions are different (new release), false if identical.
   */
  static isNewVersion(storedVersion: string | null, fetchedVersion: string): boolean {
    // If no stored version, this is the first run - not considered a "new" release
    // The caller should handle this case specially (store version, no notification)
    if (storedVersion === null) {
      return false;
    }
    return storedVersion !== fetchedVersion;
  }

  /**
   * Performs the actual SSM GetParameter call with error handling.
   */
  private async fetchParameter(): Promise<string | null> {
    try {
      const response = await this.ssmClient.send(
        new GetParameterCommand({
          Name: this.parameterName,
        }),
      );

      this.logger?.debug("SSM GetParameter response received", {
        parameterName: this.parameterName,
        hasValue: !!response.Parameter?.Value,
      });

      if (!response.Parameter?.Value) {
        return null;
      }

      return response.Parameter.Value;
    } catch (error) {
      // Handle ParameterNotFound - return null (initial state)
      if (
        error instanceof ParameterNotFound ||
        (error instanceof Error && error.name === "ParameterNotFound")
      ) {
        this.logger?.info("SSM parameter not found, treating as initial state", {
          parameterName: this.parameterName,
        });
        return null;
      }

      // Handle access denied - not retryable
      if (error instanceof Error && error.name === "AccessDeniedException") {
        throw new VersionStoreError(
          `Access denied to SSM parameter: ${this.parameterName}`,
          false,
        );
      }

      // Handle service unavailable - retryable
      if (
        error instanceof Error &&
        (error.name === "ServiceUnavailable" ||
          error.name === "InternalServerError" ||
          error.name === "ThrottlingException")
      ) {
        throw new VersionStoreError(
          `SSM service error: ${error.message}`,
          true,
        );
      }

      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Performs the actual SSM PutParameter call with error handling.
   */
  private async putParameter(version: string): Promise<void> {
    try {
      await this.ssmClient.send(
        new PutParameterCommand({
          Name: this.parameterName,
          Value: version,
          Type: "String",
          Overwrite: true,
          Description: "Last known GitHub release version for release notifier",
        }),
      );

      this.logger?.debug("SSM PutParameter completed successfully", {
        parameterName: this.parameterName,
      });
    } catch (error) {
      // Handle access denied - not retryable
      if (error instanceof Error && error.name === "AccessDeniedException") {
        throw new VersionStoreError(
          `Access denied to SSM parameter: ${this.parameterName}`,
          false,
        );
      }

      // Handle service unavailable - retryable
      if (
        error instanceof Error &&
        (error.name === "ServiceUnavailable" ||
          error.name === "InternalServerError" ||
          error.name === "ThrottlingException")
      ) {
        throw new VersionStoreError(
          `SSM service error: ${error.message}`,
          true,
        );
      }

      // Re-throw other errors
      throw error;
    }
  }
}
