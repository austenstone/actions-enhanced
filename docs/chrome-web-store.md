# Chrome Web Store listing

## Listing copy

**Name:** Actions Enhanced

**Summary:** A faster way to scan workflow runs and find failed jobs, right inside GitHub.

**Description:**

Actions Enhanced improves GitHub Actions without replacing the native interface.
Keep GitHub's logs, job navigation, dependency graph and run controls, with a more
compact workspace built around them.

- Switch between List, Table, Graph and Waterfall views.
- Inspect job steps in a sortable table with 100 rows per page.
- Hide skipped jobs by default, or include them through the native status filter.
- Scan errors, warnings and notices with compact icon-and-number controls.
- Keep native logs beside or below jobs, maximize them, or use fullscreen.
- Reuse locally cached step metadata and execution timing across page visits.

Works on github.com. GitHub Enterprise Server and other GitHub hosts are not
supported. Some timing features require publicly accessible GitHub API data and
are subject to GitHub rate limits. This is an early release; GitHub page changes
may affect compatibility.

No separate login, access token, analytics or developer-operated backend.
Repository metadata is processed locally, with requests to GitHub when needed.
See the privacy policy for local caching and data-access details.

Independent project. Not affiliated with or endorsed by GitHub or Google.

**Category:** Developer Tools (or the closest available developer category).

**Language:** English

**Homepage:** https://github.com/austenstone/actions-enhanced

**Support:** https://github.com/austenstone/actions-enhanced/issues

**Privacy policy:** https://github.com/austenstone/actions-enhanced/blob/main/PRIVACY.md

## Privacy practices

Review the live dashboard's wording before submitting these answers. Local
processing is not the same as sending data to the developer, but the extension
does access repository page content and retain metadata locally. Do not claim it
does not access data.

**Single purpose:** Improve the display and navigation of GitHub Actions
workflow runs, jobs, steps, annotations and execution timing on github.com.

**Storage justification:** Cache step and timing metadata locally to avoid
repeated GitHub requests and retain request cooldowns. No synced storage.

**GitHub site access justification:** Read and enhance GitHub Actions pages,
retain native navigation across GitHub's client-side page changes, and request
same-origin job metadata using the user's existing GitHub session. Content
scripts match github.com so they can handle navigation into Actions from other
GitHub pages; enhancements activate on recognized Actions pages.

**Remote code:** No remotely hosted executable code is loaded by the extension.
React and all extension scripts are bundled in the uploaded ZIP.

**Data handling:** Website content and workflow metadata are accessed to provide
the feature. Private-repository metadata may be cached on the user's device.
No data is transmitted to the developer or sold. Requests to GitHub are described
in the privacy policy. Answer the dashboard's specific collection and use
questions based on these facts, not a blanket "no data" statement.

The account owner must review and make any legal certifications requested by
Google. Do not submit a certification that does not match the implementation.

## Assets and submission

The extension ZIP includes 16, 32, 48 and 128-pixel icons. Upload the 128-pixel
icon and actual 1280 x 800 screenshots from the session's store-assets folder.
Screenshots are captured from public GitHub runs, not private customer material.

Upload the ZIP produced by `npm run zip`, not a GitHub source archive.
Select Public distribution. Review the privacy fields, listing and screenshots
before submitting for Google's review.

## Publishing with GitHub Actions

[Publish Chrome extension](../.github/workflows/publish-chrome.yml) builds and
checks the extension, saves the ZIP as a workflow artifact, then uses the
[Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/api/reference/rest).
It runs manually from `main`, never on a push or pull request. Builds run without
Google credentials; only the separate upload job can request an OIDC token.
Actions are pinned to immutable revisions.

Choose a mode when running the workflow:

| Mode | Result |
| --- | --- |
| `upload` (default) | Upload a new package without submitting it for review. |
| `stage` | Upload and submit for review. Hold the approved version for manual publishing. |
| `publish` | Upload and submit for review. Publish automatically after Google approves it. |

Submission blocks on validation warnings and never skips Google's review.
An accepted submission is not confirmation that the extension is live.
Asynchronous uploads must finish successfully before submission; processing
timeouts and failed responses stop the workflow. Mutating API requests are not
retried automatically. If a network failure leaves the result uncertain, inspect
the dashboard before running again.

### One-time Google setup

Use a dedicated Google Cloud project and
[service account](https://developer.chrome.com/docs/webstore/service-accounts)
with [Workload Identity Federation](https://github.com/google-github-actions/auth#indirect-wif).
No service-account JSON key, OAuth client secret, or refresh token is needed.
The account owner must authorize the following cloud/IAM setup and link the
service account; adding these files does not perform those actions.

The provisioning identity needs `roles/iam.workloadIdentityPoolAdmin` on the
project to create the pool and provider. Project Owner alone does not include
those permissions. Grant this role to the provisioning identity, not to the
publishing service account.

Run these commands after selecting your project ID:

```bash
PROJECT_ID="your-google-cloud-project"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SERVICE_ACCOUNT="chrome-web-store@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud services enable \
  chromewebstore.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project="$PROJECT_ID"

gcloud iam service-accounts create chrome-web-store \
  --project="$PROJECT_ID" \
  --display-name="Actions Enhanced store publishing"

gcloud iam workload-identity-pools create github \
  --project="$PROJECT_ID" \
  --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc actions-enhanced \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
  --attribute-condition="assertion.repository_id == '1435242138' && assertion.repository_owner_id == '22425467' && assertion.ref == 'refs/heads/main' && assertion.sub == 'repo:austenstone@22425467/actions-enhanced@1435242138:environment:chrome-web-store' && assertion.workflow_ref == 'austenstone/actions-enhanced/.github/workflows/publish-chrome.yml@refs/heads/main' && assertion.event_name == 'workflow_dispatch'"

gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" \
  --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository_id/1435242138"

gcloud iam workload-identity-pools providers describe actions-enhanced \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool=github \
  --format="value(name)"
```

The trust condition restricts access to this repository's numeric ID and owner,
this exact workflow on `main`, manual dispatch, and the named environment.
Forks and other workflows do not qualify. If adapting this project, replace those
identity values intentionally. Do not grant the service account Editor or Owner;
the IAM binding above only lets the constrained GitHub identity impersonate it.

This repository uses immutable OIDC subjects, so the subject includes the owner
and repository numeric IDs. Check the live configuration with
`gh api repos/austenstone/actions-enhanced/actions/oidc/customization/sub`
before adapting the condition; do not assume the older name-only subject.

In the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole/),
add the service account email under **Account**. This grants access to the
publisher's items, not just this extension, so keep the trust condition narrow.
Confirm the publisher ID in **Publisher > Settings**.

### GitHub environment

Create a `chrome-web-store` environment in repository **Settings > Environments**.
Restrict deployment branches to `main` and add a required reviewer if desired.
Add these environment **variables**, not secrets:

| Variable | Value |
| --- | --- |
| `CWS_PUBLISHER_ID` | Publisher ID confirmed in the developer dashboard. |
| `CWS_WORKLOAD_IDENTITY_PROVIDER` | Full provider name printed by the last command above. |
| `CWS_SERVICE_ACCOUNT` | `chrome-web-store@YOUR_PROJECT_ID.iam.gserviceaccount.com` |

The workflow targets extension `fbokfihbkhamfknoheebpgpanonpkcjc`.
It requests a short-lived access token with only the `chromewebstore` OAuth
scope and does not create a credentials file.

### First publication and updates

Complete the dashboard's listing, screenshots, distribution, privacy fields and
account-owner certifications first. The API does not fill those forms.
Google requires a manual publication after changing visibility before subsequent
API publishing can use that visibility.

For each new upload, increase the version in `package.json`, `package-lock.json`
and `wxt.config.ts`; Chrome rejects a version already uploaded. The workflow
checks that the built manifest and package versions match.

After these workflow files are on `main`, open **Actions > Publish Chrome
extension > Run workflow**, select `main`, and start with `upload`. Review the
result in the developer dashboard. For a later new version, choose `stage` or
`publish` when you intend to submit it.
