import assert from "node:assert/strict";
import { test } from "node:test";
import { publishChrome } from "./publish-chrome.mjs";

const options = {
  publisherId: "test-publisher",
  extensionId: "fbokfihbkhamfknoheebpgpanonpkcjc",
  token: "test-token",
  version: "0.1.1",
  zip: Buffer.from("test-zip"),
  wait: async () => {},
};

const mockApi = (responses) => {
  const calls = [];
  return {
    calls,
    request: async (url, init) => {
      calls.push({ url, ...init });
      assert.ok(responses.length, "Unexpected API request");
      const next = responses.shift();
      return Response.json(next.body ?? next, { status: next.status ?? 200 });
    },
  };
};

test("uploads the ZIP with authentication and never submits by default", async () => {
  const api = mockApi([{ uploadState: "SUCCEEDED", crxVersion: "0.1.1" }]);
  const result = await publishChrome({ ...options, request: api.request });
  assert.deepEqual(result, { version: "0.1.1", uploadState: "SUCCEEDED" });
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].method, "POST");
  assert.equal(api.calls[0].body, options.zip);
  assert.equal(api.calls[0].headers.Authorization, "Bearer test-token");
  assert.equal(api.calls[0].headers["Content-Type"], "application/zip");
  assert.equal(
    api.calls[0].url,
    "https://chromewebstore.googleapis.com/upload/v2/publishers/test-publisher/items/fbokfihbkhamfknoheebpgpanonpkcjc:upload",
  );
});

for (const pending of ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"]) {
  test(`waits for ${pending} before submitting for staged review`, async () => {
    const api = mockApi([
      { uploadState: pending },
      { lastAsyncUploadState: pending },
      { lastAsyncUploadState: "SUCCEEDED" },
      { state: "PENDING_REVIEW" },
    ]);
    const result = await publishChrome({
      ...options,
      mode: "stage",
      request: api.request,
    });
    assert.equal(result.submissionState, "PENDING_REVIEW");
    assert.equal(api.calls.length, 4);
    assert.ok(api.calls[1].url.endsWith(":fetchStatus"));
    assert.deepEqual(JSON.parse(api.calls[3].body), {
      publishType: "STAGED_PUBLISH",
      skipReview: false,
      blockOnWarnings: true,
    });
  });
}

test("publishes after review only when explicitly selected", async () => {
  const api = mockApi([
    { uploadState: "SUCCEEDED", crxVersion: "0.1.1" },
    { state: "PENDING_REVIEW" },
  ]);
  await publishChrome({ ...options, mode: "publish", request: api.request });
  assert.equal(JSON.parse(api.calls[1].body).publishType, "DEFAULT_PUBLISH");
});

for (const state of ["FAILED", "NOT_FOUND", undefined]) {
  test(`never submits after upload state ${state}`, async () => {
    const api = mockApi([{ uploadState: state }]);
    await assert.rejects(
      publishChrome({ ...options, mode: "publish", request: api.request }),
      /Upload did not succeed/,
    );
    assert.equal(api.calls.length, 1);
  });
}

test("bounds async processing time and never submits on timeout", async () => {
  const api = mockApi([
    { uploadState: "IN_PROGRESS" },
    ...Array.from({ length: 30 }, () => ({
      lastAsyncUploadState: "IN_PROGRESS",
    })),
  ]);
  await assert.rejects(
    publishChrome({ ...options, mode: "publish", request: api.request }),
    /Upload did not succeed: IN_PROGRESS/,
  );
  assert.equal(api.calls.length, 31);
});

test("surfaces API failures, redacts the token, and does not retry writes", async () => {
  const api = mockApi([
    { status: 403, body: { error: "No access for test-token" } },
  ]);
  await assert.rejects(
    publishChrome({ ...options, request: api.request }),
    (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.match(error.message, /No access/);
      assert.ok(!error.message.includes("test-token"));
      return true;
    },
  );
  assert.equal(api.calls.length, 1);
});

test("blocks mismatched versions before submission", async () => {
  const api = mockApi([{ uploadState: "SUCCEEDED", crxVersion: "0.1.0" }]);
  await assert.rejects(
    publishChrome({ ...options, mode: "publish", request: api.request }),
    /version does not match/,
  );
  assert.equal(api.calls.length, 1);
});

test("surfaces publish validation warnings as failures", async () => {
  const api = mockApi([
    { uploadState: "SUCCEEDED" },
    { status: 400, body: { error: "Listing needs attention" } },
  ]);
  await assert.rejects(
    publishChrome({ ...options, mode: "stage", request: api.request }),
    /Listing needs attention/,
  );
  assert.equal(api.calls.length, 2);
});

test("rejects invalid configuration before making requests", async () => {
  const api = mockApi([]);
  for (const override of [
    { publisherId: "" },
    { publisherId: "../other" },
    { extensionId: "invalid" },
    { token: "" },
    { mode: "surprise" },
    { zip: Buffer.alloc(0) },
  ]) {
    await assert.rejects(
      publishChrome({ ...options, ...override, request: api.request }),
    );
  }
  assert.equal(api.calls.length, 0);
});

test("never retries a submission after a network failure", async () => {
  const calls = [];
  await assert.rejects(
    publishChrome({
      ...options,
      mode: "publish",
      request: async (url) => {
        calls.push(url);
        if (calls.length === 1)
          return Response.json({ uploadState: "SUCCEEDED" });
        throw new Error("Connection interrupted");
      },
    }),
    /Connection interrupted/,
  );
  assert.equal(calls.length, 2);
});

test("rejects a successful HTTP response without a submission state", async () => {
  const api = mockApi([{ uploadState: "SUCCEEDED" }, {}]);
  await assert.rejects(
    publishChrome({ ...options, mode: "stage", request: api.request }),
    /Submission response has no valid state/,
  );
});
