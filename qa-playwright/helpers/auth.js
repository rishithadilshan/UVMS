async function loginUI(page, account) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  const loginResponsePromise = page.waitForResponse(response =>
    response.url().endsWith("/auth/login") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  const response = await loginResponsePromise;
  if (!response.ok()) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Login failed for ${account.role}: ${response.status()} ${body.message || ""}`.trim());
  }
  await page.waitForURL(url => !url.pathname.endsWith("/login"));
}
async function loginAPI(request, apiURL, account) {
  const response = await request.post(`${apiURL}/auth/login`, { data: { email: account.email, password: account.password } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`Login failed for ${account.role}: ${response.status()} ${body.message || ""}`);
  return { token: body.token, user: body.user };
}
module.exports = { loginUI, loginAPI };
