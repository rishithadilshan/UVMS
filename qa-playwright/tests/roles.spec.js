const {test,expect}=require("../fixtures/test");
const {accountForRole}=require("../fixtures/accounts");
const {loginUI,loginAPI}=require("../helpers/auth");
for(const role of ["ADMIN","LECTURER","INSTRUCTOR","STUDENT"]) test(`${role}: dashboard and route authorization`,async({page})=>{
 const account=accountForRole(role); test.skip(!account,`Set QA_${role} credentials in .env.qa`);
 await loginUI(page,account);
 if(role==="ADMIN"){
  await expect(page).toHaveURL(/\/admin$/); await expect(page.getByRole("link",{name:"Venue Management"})).toBeVisible();
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/admin$/);
 } else {
  await expect(page).toHaveURL(/\/dashboard$/); await expect(page.getByRole("heading",{name:/welcome/i})).toBeVisible();
  await page.goto("/admin"); await expect(page).toHaveURL(/\/dashboard$/);
 }
});
test("non-admin roles are denied admin-only APIs",async({request},info)=>{
 for(const role of ["LECTURER","INSTRUCTOR","STUDENT"]){
  const account=accountForRole(role); test.skip(!account,`Configure all QA non-admin accounts`);
  const {token}=await loginAPI(request,info.project.metadata.apiURL,account);
  for(const path of ["/admin/overview","/users","/maintenance"]){
   const r=await request.get(`${info.project.metadata.apiURL}${path}`,{headers:{Authorization:`Bearer ${token}`}});
   expect(r.status(),`${role} -> ${path}`).toBe(403);
  }
 }
});
test("admin can access admin overview API",async({request},info)=>{
 const account=accountForRole("ADMIN"); test.skip(!account,"Configure QA_ADMIN account");
 const {token}=await loginAPI(request,info.project.metadata.apiURL,account);
 const r=await request.get(`${info.project.metadata.apiURL}/admin/overview`,{headers:{Authorization:`Bearer ${token}`}});
 expect(r.status()).toBe(200); expect(await r.json()).toHaveProperty("counts");
});
test("tampered JWT is rejected",async({request},info)=>{
 const account=accountForRole("LECTURER"); test.skip(!account,"Configure QA_LECTURER account");
 const {token}=await loginAPI(request,info.project.metadata.apiURL,account);
 const forged=token.slice(0,-2)+(token.slice(-2)==="aa"?"bb":"aa");
 const r=await request.get(`${info.project.metadata.apiURL}/auth/me`,{headers:{Authorization:`Bearer ${forged}`}});
 expect(r.status()).toBe(401);
});
