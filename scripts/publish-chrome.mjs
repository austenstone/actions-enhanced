import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const api = "https://chromewebstore.googleapis.com";
const isPending = (state) =>
  state === "IN_PROGRESS" || state === "UPLOAD_IN_PROGRESS";

export const publishChrome = async ({
  publisherId,
  extensionId,
  token,
  mode = "upload",
  zip,
  version,
  request = fetch,
  wait = setTimeout,
}) => {
  if (!publisherId || !/^[a-zA-Z0-9_-]+$/.test(publisherId))
    throw new Error("Invalid CWS_PUBLISHER_ID");
  if (!/^[a-p]{32}$/.test(extensionId ?? ""))
    throw new Error("Invalid CWS_EXTENSION_ID");
  if (!token) throw new Error("Missing CWS_ACCESS_TOKEN");
  if (!["upload", "stage", "publish"].includes(mode))
    throw new Error("Invalid CWS_MODE");
  if (!zip?.length || !version)
    throw new Error("Missing ZIP or package version");

  const name = `publishers/${publisherId}/items/${extensionId}`;
  const call = async (url, options = {}) => {
    const response = await request(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const details = (await response.text()).replaceAll(token, "[REDACTED]");
      throw new Error(`Chrome Web Store HTTP ${response.status}: ${details}`);
    }
    return response.json();
  };

  const uploaded = await call(`${api}/upload/v2/${name}:upload`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: zip,
  });
  let state = uploaded.uploadState;
  for (let attempt = 0; isPending(state) && attempt < 30; attempt++) {
    await wait(5_000);
    const status = await call(`${api}/v2/${name}:fetchStatus`);
    state = status.lastAsyncUploadState;
  }
  if (state !== "SUCCEEDED")
    throw new Error(
      `Upload did not succeed: ${state ?? "missing upload state"}`,
    );
  if (uploaded.crxVersion && uploaded.crxVersion !== version)
    throw new Error("Uploaded version does not match package version");

  if (mode === "upload") return { version, uploadState: state };

  const submitted = await call(`${api}/v2/${name}:publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publishType: mode === "stage" ? "STAGED_PUBLISH" : "DEFAULT_PUBLISH",
      skipReview: false,
      blockOnWarnings: true,
    }),
  });
  if (!submitted.state || submitted.state === "ITEM_STATE_UNSPECIFIED")
    throw new Error("Submission response has no valid state");
  return { version, uploadState: state, submissionState: submitted.state };
};

const main = async () => {
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  const files = (await readdir("store-package")).filter((file) =>
    file.endsWith("-chrome.zip"),
  );
  if (files.length !== 1)
    throw new Error(`Expected exactly one Chrome ZIP, found ${files.length}`);
  const result = await publishChrome({
    publisherId: process.env.CWS_PUBLISHER_ID,
    extensionId: process.env.CWS_EXTENSION_ID,
    token: process.env.CWS_ACCESS_TOKEN,
    mode: process.env.CWS_MODE,
    version,
    zip: await readFile(resolve("store-package", files[0])),
  });
  console.log(JSON.stringify(result));
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
