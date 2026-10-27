# Actions Enhanced privacy policy

Effective date: 2026-10-27

Actions Enhanced is an independent browser extension that enhances GitHub Actions
pages. It is not affiliated with or endorsed by GitHub or Google.

## Data accessed

The extension reads content on GitHub Actions pages you visit to display workflow
runs, job and step names, statuses, durations, timestamps, branch and commit
context, and annotations. This can include information from private repositories
that your existing GitHub session can access.

Native logs remain rendered by GitHub. The extension can expand, navigate and
restyle that interface, but does not cache log bodies or upload them to a developer
service.

## Local storage

The extension stores step metadata for up to 500 jobs and timing metadata for up
to 20 run snapshots in local extension storage for up to 30 days. These caches
can include repository identifiers, job and step names, statuses and timestamps.
They are not synced through Chrome.

The most recent run's navigation preferences, search text, status filter and
sidebar scroll position may be stored in the GitHub tab's session storage.
GitHub page scripts can access same-origin session storage. This state expires
when the tab's session ends. Rate-limit cooldown timestamps are also stored
locally.

Uninstalling the extension removes its extension-local storage. Clearing GitHub
site data removes its session-storage preferences. Cached records expire and are
pruned as the extension is used.

## Network requests

The extension requests job pages from GitHub using your existing GitHub session
to retrieve step metadata. It does not read or store your GitHub password, cookies
or access tokens.

Waterfall timing may request public workflow and job metadata from
`api.github.com` without authentication. Those requests include the repository,
run and attempt identifiers needed to retrieve the requested timing data. GitHub
receives normal connection information, such as your IP address, when your
browser makes these requests.

GitHub's own page continues to make its normal requests for navigation, logs,
hovercards and other native features. GitHub's handling of information is covered
by the [GitHub privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Sharing and use

The extension has no developer-operated backend, analytics, advertising or
tracking service. The developer does not receive or sell your repository data,
browsing history or cached metadata. Data is used only to provide the extension's
GitHub Actions interface and is not used for advertising, credit decisions or
unrelated purposes.

## Contact and changes

For privacy questions, [open an issue](https://github.com/austenstone/actions-enhanced/issues).
Do not include private repository details, logs or credentials in a public issue.
Changes to this policy will be published in this file with an updated effective
date.
