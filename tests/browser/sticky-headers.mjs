// Run against a BB automation tab with a tour open:
// node tests/browser/sticky-headers.mjs /path/to/private-cdp-connection.json [tour-url]
// Uses real layout and hit testing; jsdom cannot test sticky positioning.
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
    const result = await evaluate(`(async () => {
      const root = document.querySelector('.pr-tour-root');
      const scroller = root.querySelector('.pr-tour-scroll') ?? root;
      const section = [...root.querySelectorAll('.section')].find(section => section.getBoundingClientRect().height > 1000);
      if (!section) throw new Error('Use a tour with a section taller than the viewport');
      scroller.scrollTop += section.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 250;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const header = section.querySelector('.section__header');
      const checkbox = header.querySelector('input[type="checkbox"]');
      const toolbar = root.querySelector('.tour-toolbar');
      const control = checkbox.getBoundingClientRect();
      const hit = document.elementFromPoint(control.left + control.width / 2, control.top + control.height / 2);
      return { headerTop: header.getBoundingClientRect().top, toolbarBottom: toolbar?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top, checkboxClickable: hit === checkbox, scrollTop: scroller.scrollTop };
    })()`);
    console.log(JSON.stringify({ width, ...result }));
    assert.ok(result.scrollTop > 0, "The tour should have scrolled");
    assert.ok(
      Math.abs(result.headerTop - result.toolbarBottom) < 2,
      "Section controls must stick immediately below the export toolbar",
    );
    assert.ok(result.checkboxClickable, "The Viewed checkbox must be unobscured and clickable");
  }
} finally {
  ws.close();
}
