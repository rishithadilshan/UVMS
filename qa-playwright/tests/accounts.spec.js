const {test,expect}=require("../fixtures/test");
const {accountForRole}=require("../fixtures/accounts");

test("sample QA credentials are treated as unconfigured",async()=>{
 const keys=["QA_ADMIN_EMAIL","QA_ADMIN_PASSWORD"];
 const previous=keys.map(key=>process.env[key]);
 try{
  process.env.QA_ADMIN_EMAIL="qa-admin@example.test";
  process.env.QA_ADMIN_PASSWORD="replace-with-dedicated-password";
  expect(accountForRole("ADMIN")).toBeNull();

  process.env.QA_ADMIN_EMAIL="admin@university.test";
  process.env.QA_ADMIN_PASSWORD="a-real-local-test-password";
  expect(accountForRole("ADMIN")).toEqual({
   role:"ADMIN",
   email:"admin@university.test",
   password:"a-real-local-test-password"
  });
 }finally{
  keys.forEach((key,index)=>{
   if(previous[index]===undefined) delete process.env[key];
   else process.env[key]=previous[index];
  });
 }
});
