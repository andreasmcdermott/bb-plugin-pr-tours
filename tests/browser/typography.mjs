// Run against a BB automation tab with a tour open:
// node tests/browser/typography.mjs /path/to/private-cdp-connection.json [tour-url]
// Checks compact type and visible single-line badges using real browser layout.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const connection = JSON.parse(await readFile(process.argv[2], "utf8"));
const ws = new WebSocket(connection.wsEndpoint);
const pending = new Map();
let sequence = 0;
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error("Browser connection failed"));
});
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
};
ws.onclose = () => {
  for (const request of pending.values()) request.reject(new Error("Browser connection closed"));
};
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  const { targetInfos } = await call("Target.getTargets");
  const target = targetInfos.find((target) => target.type === "page");
  assert.ok(target, "Open a tour in the automation tab first");
  const { sessionId } = await call("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  const command = (method, params) => call(method, params, sessionId);
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    return result.result.value;
  }
  if (process.argv[3]) await command("Page.navigate", { url: process.argv[3] });
  for (const width of [1440, 640, 380]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const previousOrigin = await evaluate("performance.timeOrigin");
    await command("Page.reload");
    let loaded = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        await evaluate(
          `performance.timeOrigin !== ${previousOrigin} && !!document.querySelector(".pr-tour-root .section__header")`,
        )
      ) {
        loaded = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(loaded, "The tour should load");
    const result = await evaluate(`(() => {
      const root = document.querySelector('.pr-tour-root');
      const badges = [...root.querySelectorAll('.badge')].map(badge => {
        const style = getComputedStyle(badge);
        const rect = badge.getBoundingClientRect();
        return { text: badge.textContent, background: style.backgroundColor, whiteSpace: style.whiteSpace, shrink: style.flexShrink, height: rect.height, lineHeight: parseFloat(style.lineHeight) };
      });
      return { fontSize: getComputedStyle(root).fontSize, badges };
    })()`);
    assert.equal(result.fontSize, "13px", "The tour should use its compact base font");
    assert.ok(result.badges.length > 0, "Use a tour with requirement or finding badges");
    for (const badge of result.badges) {
      assert.notEqual(
        badge.background,
        "rgba(0, 0, 0, 0)",
        `${badge.text} needs a visible background`,
      );
      assert.equal(badge.whiteSpace, "nowrap", `${badge.text} must not wrap`);
      assert.equal(badge.shrink, "0", `${badge.text} must keep its width`);
      assert.ok(badge.height <= badge.lineHeight + 4, `${badge.text} should stay on one line`);
    }
    console.log(
      JSON.stringify({
        width,
        fontSize: result.fontSize,
        badges: result.badges.length,
        singleLine: true,
      }),
    );
  }
} finally {
  ws.close();
}
