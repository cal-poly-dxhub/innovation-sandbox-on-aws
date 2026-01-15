// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Local integration test for the GitHub Release Notifier.
 * Tests the GitHub API call without AWS dependencies.
 *
 * Run with: npx tsx source/lambdas/release-notifier/release-checker/test/local-test.ts
 */

import { GitHubService } from "@amzn/innovation-sandbox-commons/isb-services/github-service.js";

async function main() {
  const owner = process.argv[2] || "aws-solutions-library-samples";
  const repo = process.argv[3] || "innovation-sandbox-on-aws";

  console.log(`\nTesting GitHub Release Notifier locally...`);
  console.log(`Repository: ${owner}/${repo}\n`);

  const githubService = new GitHubService({ owner, repo });

  try {
    const release = await githubService.getLatestRelease();

    if (release) {
      console.log("✅ Successfully fetched latest release:\n");
      console.log(`  Tag:       ${release.tagName}`);
      console.log(`  Name:      ${release.releaseName || "(no name)"}`);
      console.log(`  Published: ${release.publishedAt}`);
      console.log(`  URL:       ${release.htmlUrl}`);
      console.log(`  Notes:     ${release.body?.substring(0, 100) || "(no notes)"}...`);
    } else {
      console.log("ℹ️  No releases found for this repository");
    }
  } catch (error) {
    console.error("❌ Error fetching release:", error);
    process.exit(1);
  }
}

main();
