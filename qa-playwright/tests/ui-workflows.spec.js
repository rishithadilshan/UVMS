const {test,expect}=require("../fixtures/test");
const {accountForRole}=require("../fixtures/accounts");
const {loginUI}=require("../helpers/auth");
test("lecturer can load venue search and booking pages",async({page})=>{
 const a=accountForRole("LECTURER");test.skip(!a,"Configure QA_LECTURER");
 await loginUI(page,a);await page.getByRole("link",{name:"Find a Venue"}).click();
 await expect(page.getByRole("heading",{name:"Find a venue"})).toBeVisible();
 await expect(page.getByLabel("Booking date")).toBeVisible();
 await page.getByRole("link",{name:"My Bookings"}).click();
 await expect(page.getByRole("heading",{name:/my bookings/i})).toBeVisible();
});
test("admin venue page and add form render without mutating data",async({page})=>{
 const a=accountForRole("ADMIN");test.skip(!a,"Configure QA_ADMIN");
 await loginUI(page,a);await page.getByRole("link",{name:"Venue Management"}).click();
 await expect(page.getByRole("heading",{name:"Venue management"})).toBeVisible();
 await page.getByRole("button",{name:/add venue/i}).click();
 await expect(page.getByRole("heading",{name:"Add venue"})).toBeVisible();
 await expect(page.getByLabel("Venue name")).toBeVisible();
});
