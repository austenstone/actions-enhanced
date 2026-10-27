# Actions Enhanced

A Chrome extension that adds small conveniences to GitHub Actions **without
replacing GitHub's UI**. Native run rows, job navigation, menus, graph, logs,
approvals, artifacts, and run controls stay in place.

Extra controls let you filter already loaded jobs, show only items
needing attention, and navigate between jobs and failures. Nothing is
reordered until you ask; skipped jobs are hidden by default. Controls use GitHub's own button, input,
typography, and theme classes.

New UI follows [Primer](https://primer.style/product/), including its
[Breadcrumbs component](https://primer.style/product/components/breadcrumbs/).
Prefer Primer styles and tokens already loaded on GitHub over a separate visual
system or duplicate global stylesheet. See [UI conventions](AGENTS.md).

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or newer and npm.
- [Google Chrome](https://www.google.com/chrome/) 120 or newer.
- A GitHub account for private repositories.

## Install

### Download the preview

1. Download the Chrome ZIP from the [latest release](https://github.com/austenstone/actions-enhanced/releases).
2. Extract it into a folder you will keep on your computer.
3. Open `chrome://extensions` and enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Open a GitHub Actions workflow run. You should see List, Table, Graph and Waterfall view tabs.

This is an early preview, not a Chrome Web Store installation. GitHub page changes
can break enhancements. Disable the extension to return to the original interface.
To update, extract the next release over that folder, click **Reload** in
`chrome://extensions`, and refresh any open GitHub pages.

### Build from source

Install [Git](https://git-scm.com/) as well as the prerequisites above, then run:

```bash
git clone https://github.com/austenstone/actions-enhanced.git
cd actions-enhanced
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `.output/chrome-mv3` in this directory.
3. Open a repository's Actions tab, such as
   [actions/checkout](https://github.com/actions/checkout/actions).
4. Open a workflow run to see the enhanced workspace or job sidebar controls.
   The workflow run list stays native, without an extra search or filter bar.

**Needs attention** includes failures and explicit action-required statuses.
**Show all** clears local filters and restores all original rows in their original
order. Native pagination and menus are unchanged. Job search filters only the
sidebar links, not the native graph or logs. The current job stays visible even
when it does not match your filter.

On older run/job layouts, the controls stay pinned in GitHub's existing desktop sidebar.
Search by name, filter by status, use **Previous** / **Next** for adjacent jobs,
or move directly between failures. Links remain real GitHub URLs and support
opening in a new tab. Enter or Arrow Down in search focuses the first matching
native job link; Escape clears filters. No global keyboard shortcuts are changed.

The current GitHub run layout uses a two-pane workspace instead. View tabs stay
fixed at the top of the left pane while jobs, the table, or the waterfall scroll
underneath. The redundant extra job-filter controls are not shown.
Jobs default to **All except skipped** in the native status filter. Choose **All**
to include skipped jobs, or **Skipped** to inspect only those jobs. This also filters Table and Waterfall.
Native job
details and logs stay on the right, with a stacked layout on narrow screens.
Selecting a job uses GitHub's public Turbo navigation and scoped rendering to
update the native content pane without reloading the document or replacing the
live job navigator. Selection is reflected in the native list as well as the
optional table. Modified clicks still open real job URLs in another tab.
When native soft navigation is unavailable, the original job link remains usable.
The right pane has **Log**, **Annotations**, and **Details** tabs. Log is selected by default,
so annotations no longer push the job output down. Both tabs retain GitHub's real
content and controls in place, support arrow-key navigation, and preserve the
selected detail tab across jobs using the `ae_tab` URL parameter. Jobs without
annotations show an explicit empty state.
Annotations tabs use icon-and-number controls for errors, warnings, and notices, without text labels or pills,
omitting zero counts and refreshing when annotations change. If GitHub exposes only
an unclassified total, the total remains visible without inventing a severity.
The steps table uses 100 rows per page, with sorting applied across all loaded rows.

The job details toolbar also controls the log pane layout. Buttons at its right
place logs **beside** the jobs (default), **below** them, **maximized** over the
workspace, or **fullscreen** over the page; Escape or the pressed fullscreen
button returns to the previous layout. The **Close logs** button at its left hides
the log pane so jobs fill the workspace; clicking a step reopens it.
Layout changes are CSS only, so GitHub's
live log elements, the selected job, scroll positions, and detail tabs stay in
place. The layout is kept in the `ae_layout` URL parameter and carried across
job changes, except that a closed pane is not carried into new links.

Workflow-run-level content stays in the left pane alongside the job views:
**Summary** contains native run metadata and rendered job/PR summaries,
**Annotations** contains run annotations, and **Artifacts** contains the native
artifact download controls. The right pane is reserved for the selected job.
Switching left tabs preserves the native content and any open job logs.

Run pages also get a Primer breadcrumb trail and coordinated view links:
**List**, **Table**, **Graph**, and **Waterfall**. Older layouts retain their
native Annotations view link.
The compact breadcrumb replaces the large native run title block with workflow,
available branch/commit context, run number, and selected job. Native status and
duration sit beside it. The original title remains accessible to screen readers
and on the run-number tooltip. The redundant workflow-options button is hidden;
removing the enhancement restores the original header.
**Actions** returns to the repository's workflow runs. The workflow crumb opens
that workflow's runs; the branch crumb opens Actions with a native `branch:`
filter, rather than navigating to source code.
The extension starts at `document_start` with declarative CSS and reserves the
workspace layout as GitHub's elements appear, before mounting React. Incoming
Turbo pages receive the same layout preparation before rendering. Native content
is not hidden behind a loading screen.
List retains GitHub's native job list. Table automatically loads every loaded job's
steps into flat rows with **Job**, **Step**, **Status**, and **Duration** columns.
There are no parent rows or disclosures. Sort the steps by column or click a step
to open its matching native logs. The table fits the panel width; long job and
step names stay on one line with an ellipsis and reveal their full text on hover.
Step requests run at most four at a time and
reuse the shared persistent step cache; loading and retryable failures are shown per job.
Graph uses the corresponding native section when GitHub exposes it.
In the workspace the graph and run-level details are positioned below the left tabs.
The graph omits its duplicate filename/event heading and uses native Fit to window
to fit both canvas dimensions on initial display and panel resize, retaining native panning and zoom controls;
job annotations stay in the right detail pane. Existing live log elements are never moved into another
container.
Native job navigation, logs, run controls, and menus remain available.
Table shows available native step durations; missing durations remain unknown.
List job durations sit at the right edge of their native rows.

Expand a job in List to load its step headers from GitHub's same-origin job page.
Waterfall shows every job's steps by default. Skipped steps are hidden in List,
Table, and Waterfall. Step names, statuses, and
available durations are cached in local extension storage for up to 30 days
(up to 500 jobs), shared by List, Table, and Waterfall across reloads and tabs.
Running jobs refresh after 15 seconds. Rate-limit cooldowns also survive navigation.
Log bodies are not copied.
In List, clicking a job row only expands or collapses its steps; it does not open
or change the right pane. Matrix groups retain another nesting level above their
individual jobs. Clicking a step opens the native job logs, expands that step, and scrolls it into
view while retaining the left view. Step navigation uses `ae_step` in the URL.
The native dependency graph remains job-level. Step timing bars are not inferred
from rounded durations when exact timestamps are unavailable.

The selected view is encoded in `ae_view`; `ae_job` retains a selected job when
viewing the run summary. These extension-owned URL parameters make views
linkable and keep normal back/forward and new-tab navigation useful. Breadcrumbs
include only context verified on the page, rather than guessing a branch, commit,
or matrix relationship.

Waterfall uses real job timestamps, not inferred dependencies or durations.
Muted hatched segments show queue time from job creation to execution, including
concurrency holds. The elapsed-time axis uses round intervals such as 1m, 2m,
or 5m, with seconds for short runs and hours for long runs.
Timing loads automatically when the view opens, reads native
page data first, and fills missing job timestamps through the public
GitHub REST API without credentials, and is subject to public access and rate
limits. A private-repository sign-in session on github.com does not authorize
unauthenticated requests to api.github.com.
Timing snapshots are cached per repository, run, and attempt in local extension
storage, surviving page reloads and new tabs (up to 20 snapshots for 30 days).
Completed attempts are reused across job routes. A saved unpinned "latest" lookup
expires after one minute so a subsequent visit can discover a rerun.
API rate-limit cooldowns also survive reloads and apply across runs.
Completed snapshots are reused automatically. Active runs refresh only while the page is visible,
with bounded polling and rate-limit-aware delays. Failures retain the last good
snapshot and show an explicit error or incomplete-coverage warning.
The compact Primer-styled timeline consists of a shared elapsed-time ruler,
job names, execution bars, and durations immediately after each bar.
Skipped jobs are excluded. Both job names and bars open the native job logs.
No duplicate title, metadata header, or toolbar is rendered.
Native job-status filters retain the full execution time scale for comparison.
They are scoped to one verified run attempt, fetch at most 10 pages / 1,000 jobs,
and report incomplete coverage or unavailable timestamps explicitly. Canonical
`/attempts/N` pages and job links keep their attempt context.

## Development

```bash
npm run dev
```

Keep the terminal running. If WXT does not open a development browser, load
`.output/chrome-mv3-dev` manually through `chrome://extensions`, disabling the
production copy first. Refresh GitHub once. Saving content-script changes
rebuilds the extension and refreshes matching tabs automatically.

## Privacy and limitations

Search covers only items already loaded on the current page, not all repository
history or complete job logs. It matches available titles, workflow names,
branches, actors, run numbers, and statuses. Run-list filters reset on navigation.
Job search, status filter, and sidebar scroll are remembered across job navigation
within the same run in the current tab. The selected job comes from the native
URL or the view's `ae_job` parameter.
Unknown markup leaves GitHub unchanged; removing the controls restores any rows
hidden by their local filters.

The current tab's `sessionStorage` stores only the most recent run's navigation
state (run path, search text, status filter, sidebar scroll). It is not synced,
contains no logs or credentials, and expires when the tab's session ends.
GitHub page scripts can access same-origin session storage. If storage is blocked,
the controls show a warning and continue without persistence.

No token, analytics, or external backend is used. Ordinary navigation and filtering
operate on the page's loaded content. Optional timing requests send the public
repository and run identifiers to GitHub's API; they do not send logs or use
GitHub session credentials.
The content script matches `https://github.com/*` to handle client-side
navigation into Actions, but mounts only on recognized Actions pages.
Other GitHub hosts are not supported yet.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run build
npm run test:e2e
```

Browser tests use synthetic pages and an isolated Chromium profile. An optional
public-GitHub smoke test uses real `actions/checkout` markup without signing in
or changing workflow runs:

```bash
LIVE_GITHUB=1 npm run test:e2e
```

Built with [WXT](https://wxt.dev/) and [React](https://react.dev/).
