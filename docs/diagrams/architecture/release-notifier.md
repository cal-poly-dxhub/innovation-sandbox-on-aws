# GitHub Release Notifier Architecture

## Overview

The GitHub Release Notifier monitors a configurable GitHub repository for new releases and sends email notifications when detected. It runs as a serverless stack integrated with the Innovation Sandbox infrastructure.

## Architecture Diagram

```mermaid
flowchart TB
    subgraph AWS["AWS Account"]
        subgraph Stack["InnovationSandbox-ReleaseNotifier Stack"]
            Scheduler["EventBridge Scheduler<br/>━━━━━━━━━━━━━━━━<br/>rate(1 day)<br/>15-min flex window"]
            
            Lambda["Release Checker Lambda<br/>━━━━━━━━━━━━━━━━<br/>Node.js 22 / ARM64<br/>1024 MB Memory"]
            
            SSM["SSM Parameter Store<br/>━━━━━━━━━━━━━━━━<br/>/isb/{namespace}/release-notifier/<br/>last-known-version"]
            
            SNS["SNS Topic<br/>━━━━━━━━━━━━━━━━<br/>ISB-ReleaseNotification-{namespace}"]
            
            KMS["KMS Key<br/>━━━━━━━━━━━━━━━━<br/>Encrypts SNS & Logs"]
            
            Email["Email Subscription"]
        end
    end
    
    GitHub["GitHub Releases API<br/>━━━━━━━━━━━━━━━━<br/>api.github.com/repos/<br/>{owner}/{repo}/releases/latest"]
    
    User["Administrator<br/>Email Inbox"]
    
    Scheduler -->|"Triggers daily"| Lambda
    Lambda -->|"GET latest release"| GitHub
    Lambda <-->|"Read/Write version"| SSM
    Lambda -->|"Publish notification"| SNS
    KMS -.->|"Encrypts"| SNS
    SNS -->|"Delivers email"| Email
    Email -->|"Notification"| User

    style Scheduler fill:#ff9900,color:#000
    style Lambda fill:#ff9900,color:#000
    style SSM fill:#3b48cc,color:#fff
    style SNS fill:#d93954,color:#fff
    style KMS fill:#3b48cc,color:#fff
    style GitHub fill:#24292e,color:#fff
```

## Data Flow

```mermaid
sequenceDiagram
    participant Scheduler as EventBridge Scheduler
    participant Lambda as Release Checker Lambda
    participant GitHub as GitHub API
    participant SSM as SSM Parameter Store
    participant SNS as SNS Topic
    participant Email as Email

    Scheduler->>Lambda: Trigger (daily)
    Lambda->>GitHub: GET /repos/{owner}/{repo}/releases/latest
    GitHub-->>Lambda: Release info (tag, name, notes, URL)
    
    Lambda->>SSM: GetParameter (last known version)
    SSM-->>Lambda: Stored version or null
    
    alt First Run (no stored version)
        Lambda->>SSM: PutParameter (current version)
        Note over Lambda: No notification sent
    else Version Changed (new release)
        Lambda->>SNS: Publish notification
        SNS->>Email: Send email
        Lambda->>SSM: PutParameter (new version)
    else Version Unchanged
        Note over Lambda: No action needed
    end
    
    Lambda-->>Scheduler: Complete
```

## Components

| Component | Resource | Purpose |
|-----------|----------|---------|
| Scheduler | EventBridge Scheduler | Triggers Lambda once per day |
| Lambda | ISB-ReleaseChecker-{namespace} | Checks GitHub, compares versions, sends notifications |
| SSM Parameter | /isb/{namespace}/release-notifier/last-known-version | Persists last known release version |
| SNS Topic | ISB-ReleaseNotification-{namespace} | Delivers email notifications |
| KMS Key | ISB KMS Key | Encrypts SNS messages and CloudWatch logs |

## Configuration

The stack accepts these CloudFormation parameters:

| Parameter | Description | Default |
|-----------|-------------|---------|
| Namespace | Solution namespace (shared with other ISB stacks) | myisb |
| GitHubOwner | GitHub repository owner | aws-solutions |
| GitHubRepo | GitHub repository name | innovation-sandbox-on-aws |
| NotificationEmail | Email address for notifications | (required) |


## Troubleshooting

### CloudWatch Logs Insights Queries

Use these queries against the log group `/aws/lambda/ISB-ReleaseChecker-{namespace}`:

**Recent executions summary:**
```
fields @timestamp, message, level
| filter @message like /Lambda invocation|New release|No new release|First run|No releases found/
| sort @timestamp desc
| limit 20
```

**Errors and warnings:**
```
fields @timestamp, level, message, errorType, errorMessage
| filter level in ["ERROR", "WARN", "CRITICAL"]
| sort @timestamp desc
| limit 50
```
