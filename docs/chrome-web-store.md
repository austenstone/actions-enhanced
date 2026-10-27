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
