// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

import { BaseLambdaEnvironmentSchema } from "@amzn/innovation-sandbox-commons/lambda/environments/base-lambda-environment.js";

export const ReleaseCheckerEnvironmentSchema =
  BaseLambdaEnvironmentSchema.extend({
    GITHUB_OWNER: z.string(),
    GITHUB_REPO: z.string(),
    SSM_PARAMETER_NAME: z.string(),
    SNS_TOPIC_ARN: z.string(),
    ISB_NAMESPACE: z.string(),
  });

export type ReleaseCheckerEnvironment = z.infer<
  typeof ReleaseCheckerEnvironmentSchema
>;
