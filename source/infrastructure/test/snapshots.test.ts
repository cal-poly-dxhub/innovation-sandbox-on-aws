// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ensureDirSync } from "fs-extra";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { IsbAccountPoolStack } from "@amzn/innovation-sandbox-infrastructure/isb-account-pool-stack";
import { IsbComputeStack } from "@amzn/innovation-sandbox-infrastructure/isb-compute-stack";
import { IsbDataStack } from "@amzn/innovation-sandbox-infrastructure/isb-data-stack";
import { IsbIdcStack } from "@amzn/innovation-sandbox-infrastructure/isb-idc-stack";
import { IsbSandboxAccountStack } from "@amzn/innovation-sandbox-infrastructure/isb-sandbox-account-stack";
import { AssetCode, Code } from "aws-cdk-lib/aws-lambda";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { ISource, Source } from "aws-cdk-lib/aws-s3-deployment";

function normalizeNonDeterministicTemplate(template: Template) {
  const lambdas = template.findResources("AWS::Lambda::Function");
  const layers = template.findResources("AWS::Lambda::LayerVersion");
  const bucketDeployments = template.findResources(
    "Custom::CDKBucketDeployment",
  );
  const spokeConfigParserCustomResources = template.findResources(
    "Custom::ParseJsonConfiguration",
  );
  const stackSets = template.findResources("AWS::CloudFormation::StackSet");

  const templateJson = template.toJSON();

  for (const lambda in lambdas) {
    templateJson["Resources"][lambda]["Properties"]["Code"] =
      "Omitted to remove snapshot dependency on hash";
  }

  for (const layer in layers) {
    templateJson["Resources"][layer]["Properties"]["Content"] =
      "Omitted to remove snapshot dependency on hash";
  }

  for (const bucketDeployment in bucketDeployments) {
    templateJson["Resources"][bucketDeployment]["Properties"][
      "SourceObjectKeys"
    ] = "Omitted to remove snapshot dependency on hash";
  }

  for (const cr in spokeConfigParserCustomResources) {
    templateJson["Resources"][cr]["Properties"]["forceUpdate"] =
      "Omitted to remove snapshot dependency on generated auto incrementing id";
  }

  for (const stackSet in stackSets) {
    templateJson["Resources"][stackSet]["Properties"]["TemplateURL"] =
      "Omitted to remove snapshot dependency on hash";
  }

  return templateJson;
}

function toFullDepthSnapshot(templateJson: Record<string, any>): string {
  return JSON.stringify(templateJson, null, 2);
}

beforeAll(async () => {
  vi.spyOn(Code, "fromAsset").mockImplementation(() => {
    const mockCode = new AssetCode("/mock/path");
    mockCode.bind = () => ({
      s3Location: {
        bucketName: "mock-bucket",
        objectKey: "mock-key",
      },
    });
    mockCode.bindToResource = vi.fn();

    return mockCode;
  });

  vi.spyOn(Source, "asset").mockImplementation((path) => {
    const mockBucket = {
      bucketName: "mock-source-bucket",
    } as IBucket;

    return {
      bind: () => ({
        bucket: mockBucket,
        zipObjectKey: "mock-source-key",
        deployTime: true,
        objectKey: "mock-object-key",
      }),
      bindToStackSynthesizer: vi.fn(),
      path: path || "/mock/asset/path",
    } as ISource;
  });

  // Mock child_process.execSync to prevent actual npm installs
  vi.mock("child_process", () => ({
    execSync: vi.fn().mockImplementation(() => Buffer.from("mocked execSync")),
  }));

  // Mock fs-extra functions to prevent actual file operations
  vi.mock("fs-extra", () => ({
    moveSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    ensureDirSync: vi.fn(),
  }));
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("IsbComputeStack Snapshot", () => {
  it("matches the snapshot", () => {
    ensureDirSync(path.join(__dirname, "..", "..", "frontend", "dist"));
    const app = new App();
    const stack = new IsbComputeStack(app, "IsbComputeStack");
    const template = Template.fromStack(stack);
    const templateJson = normalizeNonDeterministicTemplate(template);
    expect(toFullDepthSnapshot(templateJson)).toMatchSnapshot();
  });
});

describe("IsbDataStack Snapshot", () => {
  it("matches the snapshot", () => {
    const app = new App();
    const stack = new IsbDataStack(app, "IsbDataStack");
    const template = Template.fromStack(stack);
    const templateJson = normalizeNonDeterministicTemplate(template);

    expect(toFullDepthSnapshot(templateJson)).toMatchSnapshot();
  });
});

describe("IsbAccountPoolStack Snapshot", () => {
  it("matches the snapshot", () => {
    const app = new App();
    const stack = new IsbAccountPoolStack(app, "IsbAccountPoolStack");
    const template = Template.fromStack(stack);
    const templateJson = normalizeNonDeterministicTemplate(template);

    expect(toFullDepthSnapshot(templateJson)).toMatchSnapshot();
  });
});

describe("IdcStack Snapshot", () => {
  it("matches the snapshot", () => {
    const app = new App();
    const stack = new IsbIdcStack(app, "IsbIdcStack");
    const template = Template.fromStack(stack);
    const templateJson = normalizeNonDeterministicTemplate(template);

    expect(toFullDepthSnapshot(templateJson)).toMatchSnapshot();
  });
});

describe("SandboxAccountStack Snapshot", () => {
  it("matches the snapshot", () => {
    const app = new App();
    const stack = new IsbSandboxAccountStack(app, "IsbSandboxAccountStack");
    const template = Template.fromStack(stack);
    const templateJson = normalizeNonDeterministicTemplate(template);

    expect(toFullDepthSnapshot(templateJson)).toMatchSnapshot();
  });
});
