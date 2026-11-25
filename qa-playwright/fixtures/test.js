const base = require("@playwright/test");
const test = base.test.extend({
  page: async ({ page }, use, testInfo) => {
    const browserErrors = [];
    page.on("pageerror", error => browserErrors.push(`pageerror: ${error.message}`));
    page.on("console", message => {
      if (message.type() === "error") browserErrors.push(`console.error: ${message.text()}`);
    });
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus && browserErrors.length) {
      await testInfo.attach("browser-errors", {
        body: Buffer.from(browserErrors.join("\n"), "utf8"),
        contentType: "text/plain"
      });
    }
  }
});
module.exports = { test, expect: base.expect };
