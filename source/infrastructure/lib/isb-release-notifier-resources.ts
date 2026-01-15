// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import path from "path";

import { ReleaseCheckerEnvironmentSchema } from "@amzn/innovation-sandbox-commons/lambda/environments/release-checker-environment.js";
import { IsbLambdaFunction } from "@amzn/innovation-sandbox-infrastructure/components/isb-lambda-function";
import { IsbKmsKeys } from "@amzn/innovation-sandbox-infrastructure/components/kms";

export interface IsbReleaseNotifierResourcesProps {
  namespace: string;
  githubOwner: string;
  githubRepo: string;
  notificationEmail: string;
}

export class IsbReleaseNotifierResources {
  readonly snsTopic: Topic;
  readonly lambda: IsbLambdaFunction<typeof ReleaseCheckerEnvironmentSchema>;
  readonly scheduler: CfnSchedule;
  readonly ssmParameter: StringParameter;

  constructor(scope: Construct, props: IsbReleaseNotifierResourcesProps) {
    const kmsKey = IsbKmsKeys.get(scope, props.namespace);

    // SSM Parameter for storing last known version
    const ssmParameterName = `/isb/${props.namespace}/release-notifier/last-known-version`;
    this.ssmParameter = new StringParameter(scope, "LastKnownVersionParameter", {
      parameterName: ssmParameterName,
      description: "Stores the last known GitHub release version for the release notifier",
      stringValue: "initial", // Initial placeholder value
      simpleName: false,
    });

    // SNS Topic for release notifications
    this.snsTopic = new Topic(scope, "ReleaseNotificationTopic", {
      topicName: `ISB-ReleaseNotification-${props.namespace}`,
      displayName: `Innovation Sandbox Release Notifications (${props.namespace})`,
      masterKey: kmsKey,
    });

    // Add email subscription to the SNS topic
    this.snsTopic.addSubscription(
      new EmailSubscription(props.notificationEmail),
    );

    // Lambda function for checking releases
    this.lambda = new IsbLambdaFunction(scope, "ReleaseChecker", {
      description: "Checks GitHub for new releases and sends notifications",
      entry: path.join(
        __dirname,
        "..",
        "..",
        "lambdas",
        "release-notifier",
        "release-checker",
        "src",
        "release-checker-handler.ts",
      ),
      handler: "handler",
      namespace: props.namespace,
      environment: {
        GITHUB_OWNER: props.githubOwner,
        GITHUB_REPO: props.githubRepo,
        SSM_PARAMETER_NAME: ssmParameterName,
        SNS_TOPIC_ARN: this.snsTopic.topicArn,
        ISB_NAMESPACE: props.namespace,
      },
      envSchema: ReleaseCheckerEnvironmentSchema,
      reservedConcurrentExecutions: 1,
    });

    // Grant Lambda permissions for SSM and SNS
    this.ssmParameter.grantRead(this.lambda.lambdaFunction);
    this.ssmParameter.grantWrite(this.lambda.lambdaFunction);
    this.snsTopic.grantPublish(this.lambda.lambdaFunction);
    kmsKey.grantEncryptDecrypt(this.lambda.lambdaFunction);

    // EventBridge Scheduler role for invoking Lambda
    const schedulerRole = new Role(scope, "ReleaseCheckerSchedulerRole", {
      description:
        "Allows EventBridge Scheduler to invoke Innovation Sandbox's ReleaseChecker lambda",
      assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
    });

    this.lambda.lambdaFunction.grantInvoke(schedulerRole);

    // EventBridge Scheduler with daily schedule
    this.scheduler = new CfnSchedule(scope, "ReleaseCheckerScheduledEvent", {
      description: "Triggers release checker once per day",
      scheduleExpression: "rate(1 day)",
      flexibleTimeWindow: {
        mode: "FLEXIBLE",
        maximumWindowInMinutes: 15, // As per requirement 1.3
      },
      target: {
        retryPolicy: {
          maximumRetryAttempts: 3,
        },
        arn: this.lambda.lambdaFunction.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });
  }
}
