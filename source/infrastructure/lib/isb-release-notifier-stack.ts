// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Stack, type StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import {
  addParameterGroup,
  ParameterWithLabel,
} from "@amzn/innovation-sandbox-infrastructure/helpers/cfn-utils";
import { NamespaceParam } from "@amzn/innovation-sandbox-infrastructure/helpers/shared-cfn-params";
import { applyIsbTag } from "@amzn/innovation-sandbox-infrastructure/helpers/tagging-helper";
import { IsbReleaseNotifierResources } from "@amzn/innovation-sandbox-infrastructure/isb-release-notifier-resources";

export interface IsbReleaseNotifierStackProps extends StackProps {
  // Inherited from StackProps
}

export class IsbReleaseNotifierStack extends Stack {
  constructor(scope: Construct, id: string, props?: IsbReleaseNotifierStackProps) {
    super(scope, id, props);

    // CloudFormation Parameters
    const namespaceParam = new NamespaceParam(this);

    const githubOwnerParam = new ParameterWithLabel(this, "GitHubOwner", {
      type: "String",
      label: "GitHub Owner",
      description:
        "The GitHub repository owner (e.g., 'aws-solutions-library-samples')",
      default: "aws-solutions-library-samples",
      allowedPattern: "^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$",
      constraintDescription:
        "GitHub owner must be a valid GitHub username or organization name",
    });

    const githubRepoParam = new ParameterWithLabel(this, "GitHubRepo", {
      type: "String",
      label: "GitHub Repository",
      description:
        "The GitHub repository name (e.g., 'innovation-sandbox-on-aws')",
      default: "innovation-sandbox-on-aws",
      allowedPattern: "^[a-zA-Z0-9._-]+$",
      constraintDescription: "GitHub repository must be a valid repository name",
    });

    const notificationEmailParam = new ParameterWithLabel(
      this,
      "NotificationEmail",
      {
        type: "String",
        label: "Notification Email",
        description:
          "Email address to receive notifications when new releases are detected",
        allowedPattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
        constraintDescription: "Must be a valid email address",
      },
    );

    addParameterGroup(this, {
      label: "Release Notifier Stack Configuration",
      parameters: [
        namespaceParam,
        githubOwnerParam,
        githubRepoParam,
        notificationEmailParam,
      ],
    });

    // Instantiate IsbReleaseNotifierResources
    new IsbReleaseNotifierResources(this, {
      namespace: namespaceParam.valueAsString,
      githubOwner: githubOwnerParam.valueAsString,
      githubRepo: githubRepoParam.valueAsString,
      notificationEmail: notificationEmailParam.valueAsString,
    });

    // Apply ISB tagging to all resources
    applyIsbTag(this, namespaceParam.valueAsString);
  }
}
