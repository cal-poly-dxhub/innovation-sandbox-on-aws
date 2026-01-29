// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetParameterCommand,
  ParameterNotFound,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";

import {
  VersionStoreError,
  VersionStoreService,
} from "@amzn/innovation-sandbox-commons/isb-services/version-store-service.js";

/**
 * Unit Tests for VersionStoreService
 *
 * Tests cover:
 * - Reading existing parameter
 * - Creating parameter when not found
 * - Updating parameter
 *
 * **Validates: Requirements 3.1, 3.4, 3.5**
 */
describe("VersionStoreService", () => {
  const ssmMock = mockClient(SSMClient);
  const testParameterName = "/isb/test/release-notifier/last-known-version";

  beforeEach(() => {
    ssmMock.reset();
  });

  afterEach(() => {
    ssmMock.reset();
  });

  describe("getLastKnownVersion", () => {
    it("should return the version when parameter exists", async () => {
      const expectedVersion = "v1.2.3";

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Name: testParameterName,
          Value: expectedVersion,
          Type: "String",
        },
      });

      const service = new VersionStoreService({
        ssmClient: new SSMClient({}),
        parameterName: testParameterName,
      });

      const result = await service.getLastKnownVersion();

      expect(result).toBe(expectedVersion);
    });

    it("should return null when parameter does not exist (ParameterNotFound)", async () => {
      ssmMock.on(GetParameterCommand).rejects(
        new ParameterNotFound({
          message: "Parameter not found",
          $metadata: {},
        }),
      );

      const service = new VersionStoreService({
        ssmClient: new SSMClient({}),
        parameterName: testParameterName,
      });

      const result = await service.getLastKnownVersion();

      expect(result).toBeNull();
    });

    it("should return null when parameter value is empty", async () => {
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Name: testParameterName,
          Value: undefined,
          Type: "String",
        },
      });

      const service = new VersionStoreService({
        ssmClient: new SSMClient({}),
        parameterName: testParameterName,
      });

      const result = await service.getLastKnownVersion();

      expect(result).toBeNull();
    });

    it("should throw VersionStoreError on AccessDeniedException", async () => {
      const accessDeniedError = new Error("Access denied");
      accessDeniedError.name = "AccessDeniedException";

      ssmMock.on(GetParameterCommand).rejects(accessDeniedError);

      const service = new VersionStoreService({
        ssmClient: new SSMClient({}),
        parameterName: testParameterName,
      });

      await expect(service.getLastKnownVersion()).rejects.toThrow(VersionStoreError);
      await expect(service.getLastKnownVersion()).rejects.toMatchObject({
        retryable: false,
      });
    });
  });

  describe("updateVersion", () => {
    it("should successfully update the version parameter", async () => {
      const newVersion = "v2.0.0";
      let capturedInput: any;

      ssmMock.on(PutParameterCommand).callsFake((input) => {
        capturedInput = input;
        return {};
      });

      const service = new VersionStoreService({
        ssmClient: new SSMClient({}),
        parameterName: testParameterName,
      });

      await service.updateVersion(newVersion);

      expect(capturedInput).toMatchObject({
        Name: testParameterName,
        Value: newVersion,
        Type: "String",
        Overwrite: true,
      });
    });

    it("should create parameter when it does not exist (Overwrite: true handles this)", async () => {
      const newVersion = "v1.0.0";
      let capturedInput: any;

      ssmMock.on(PutParameterCommand).callsFake((input) => {
        capturedInput = input;
        return {};
      });

      const service = new VersionStoreService({
        ssmClient: new SSMClient({}),
        parameterName: testParameterName,
      });

      await service.updateVersion(newVersion);

      expect(capturedInput).toMatchObject({
        Name: testParameterName,
        Value: newVersion,
        Type: "String",
        Overwrite: true,
        Description: "Last known GitHub release version for release notifier",
      });
    });

    it("should throw VersionStoreError on AccessDeniedException", async () => {
      const accessDeniedError = new Error("Access denied");
      accessDeniedError.name = "AccessDeniedException";

      ssmMock.on(PutParameterCommand).rejects(accessDeniedError);

      const service = new VersionStoreService({
        ssmClient: new SSMClient({}),
        parameterName: testParameterName,
      });

      await expect(service.updateVersion("v1.0.0")).rejects.toThrow(VersionStoreError);
      await expect(service.updateVersion("v1.0.0")).rejects.toMatchObject({
        retryable: false,
      });
    });
  });

  describe("isNewVersion", () => {
    it("should return true when versions are different", () => {
      const result = VersionStoreService.isNewVersion("v1.0.0", "v2.0.0");
      expect(result).toBe(true);
    });

    it("should return false when versions are identical", () => {
      const result = VersionStoreService.isNewVersion("v1.0.0", "v1.0.0");
      expect(result).toBe(false);
    });

    it("should return false when stored version is null (first run)", () => {
      const result = VersionStoreService.isNewVersion(null, "v1.0.0");
      expect(result).toBe(false);
    });
  });
});
