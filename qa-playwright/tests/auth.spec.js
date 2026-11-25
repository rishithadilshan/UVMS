const {test,expect}=require("../fixtures/test");
const {accountForRole}=require("../fixtures/accounts");
const {loginUI}=require("../helpers/auth");
test("invalid credentials do not establish a session",async({page})=>{
 await page.goto("/login"); await page.getByLabel("Email").fill("not-a-real-qa-user@example.test");
 await page.getByLabel("Password").fill("incorrect-password"); await page.getByRole("button",{name:"Sign in"}).click();
 await expect(page.getByRole("alert")).toContainText(/invalid credentials|could not log in/i);
 await expect(page).toHaveURL(/\/login$/);
 expect(await page.evaluate(()=>sessionStorage.getItem("uvms_token"))).toBeNull();
});
for(const role of ["ADMIN","LECTURER","INSTRUCTOR","STUDENT"]) test(`${role}: login, session restore and logout`,async({page})=>{
 const account=accountForRole(role); test.skip(!account,`Set QA_${role}_EMAIL and QA_${role}_PASSWORD in .env.qa`);
 await loginUI(page,account); await expect(page.locator(".profile-chip")).toBeVisible();
 await page.reload(); await expect(page.locator(".profile-chip")).toBeVisible();
 await page.getByRole("button",{name:"Log out"}).click(); await expect(page).toHaveURL(/\/login$/);
 expect(await page.evaluate(()=>sessionStorage.getItem("uvms_token"))).toBeNull();
});
