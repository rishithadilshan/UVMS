const {test,expect}=require("../fixtures/test");
const {accountForRole,testData}=require("../fixtures/accounts");
const {loginAPI}=require("../helpers/auth");
const {colomboDatePlus}=require("../helpers/dates");
const {readBooking}=require("../helpers/db");
const d=testData(), api=info=>info.project.metadata.apiURL, h=token=>({Authorization:`Bearer ${token}`});
async function cleanup(request,apiURL,token,id){
 if(!id)return;
 const r=await request.post(`${apiURL}/bookings/${id}/cancel`,{headers:h(token),data:{reason:"Playwright QA cleanup"}});
 if(![200,202,404,409].includes(r.status())) throw new Error(`Cleanup failed for test-created booking ${id}: ${r.status()}`);
}
async function postBooking(request,apiURL,token,extra={}){
 return request.post(`${apiURL}/bookings`,{headers:h(token),data:{
  venueId:d.venueId,date:colomboDatePlus(7),startTime:"09:00",endTime:"10:00",
  participants:d.participants,categoryId:d.categoryId,purpose:`Playwright QA ${Date.now()}`,
  facilities:d.facilities,...extra
 }});
}
test("invalid venue search time is rejected",async({request},info)=>{
 const a=accountForRole("LECTURER");test.skip(!a,"Configure QA_LECTURER account");
 const {token}=await loginAPI(request,api(info),a);
 const r=await request.get(`${api(info)}/venues/search`,{headers:h(token),params:{date:colomboDatePlus(7),startTime:"11:00",endTime:"10:00",participants:2}});
 expect(r.status()).toBe(400);
});
test("venue search filters by capacity and mandatory facilities",async({request},info)=>{
 test.skip(!d.venueId,"Set QA_VENUE_ID");const a=accountForRole("LECTURER");test.skip(!a,"Configure QA_LECTURER");
 const {token}=await loginAPI(request,api(info),a), base={date:colomboDatePlus(7),startTime:"09:00",endTime:"10:00"};
 const venueResponse=await request.get(`${api(info)}/venues/${d.venueId}`,{headers:h(token)});
 expect(venueResponse.ok()).toBeTruthy();
 const venue=await venueResponse.json();
 const cap=await request.get(`${api(info)}/venues/search`,{headers:h(token),params:{...base,participants:Number(venue.capacity)+1}});
 expect(cap.ok()).toBeTruthy();const c=await cap.json();
 expect([...c.available,...c.booked,...c.unavailable].some(v=>v.id===d.venueId)).toBeFalsy();
 const fac=await request.get(`${api(info)}/venues/search`,{headers:h(token),params:{...base,participants:d.participants,facilities:d.impossibleFacility}});
 expect(fac.ok()).toBeTruthy();const f=await fac.json();
 expect([...f.available,...f.booked,...f.unavailable].some(v=>v.id===d.venueId)).toBeFalsy();
});
test("lecturer booking is confirmed and optional DB read-back matches",async({request},info)=>{
 test.skip(!d.venueId||!d.categoryId,"Set dedicated QA_VENUE_ID and QA_CATEGORY_ID");
 const a=accountForRole("LECTURER");test.skip(!a,"Configure QA_LECTURER");
 const {token,user}=await loginAPI(request,api(info),a);let id;
 try{
  const r=await postBooking(request,api(info),token),body=await r.json();expect(r.status()).toBe(201);
  expect(body.status).toBe("CONFIRMED");id=body.booking.id;expect(body.booking.owner.id).toBe(user.id);
  const row=await readBooking(id);if(row){expect(row.owner_id).toBe(user.id);expect(row.status).toBe("CONFIRMED");}
 }finally{await cleanup(request,api(info),token,id);}
});
test("student booking is pending approval",async({request},info)=>{
 test.skip(!d.venueId||!d.categoryId,"Set dedicated QA venue/category");
 const a=accountForRole("STUDENT");test.skip(!a,"Configure QA_STUDENT");
 const {token,user}=await loginAPI(request,api(info),a);let id;
 try{
  const r=await postBooking(request,api(info),token,{purpose:`Student QA ${Date.now()}`,justification:"Local automated test for an academic activity."});
  const body=await r.json();expect(r.status()).toBe(201);expect(body.status).toBe("PENDING");id=body.booking.id;expect(body.booking.owner.id).toBe(user.id);
 }finally{await cleanup(request,api(info),token,id);}
});

test("admin approval changes a student request to CONFIRMED",async({request},info)=>{
 test.skip(!d.venueId||!d.categoryId,"Set dedicated QA venue/category");
 const student=accountForRole("STUDENT"),admin=accountForRole("ADMIN");
 test.skip(!student||!admin,"Configure QA_STUDENT and QA_ADMIN");
 const [s,a]=await Promise.all([loginAPI(request,api(info),student),loginAPI(request,api(info),admin)]);
 let id;
 try{
  const created=await postBooking(request,api(info),s.token,{purpose:`Approval QA ${Date.now()}`,justification:"Local QA test for an academic activity."});
  const body=await created.json();expect(created.status()).toBe(201);expect(body.status).toBe("PENDING");id=body.booking.id;
  const decision=await request.post(`${api(info)}/bookings/${id}/decision`,{headers:h(a.token),data:{decision:"APPROVE"}});
  expect(decision.status()).toBe(200);
  const detail=await request.get(`${api(info)}/bookings/${id}`,{headers:h(a.token)});
  expect(detail.status()).toBe(200);expect((await detail.json()).status).toBe("CONFIRMED");
 }finally{await cleanup(request,api(info),a.token,id);}
});

test("calendar hides another user's booking purpose from students",async({request},info)=>{
 test.skip(!d.venueId||!d.categoryId,"Set dedicated QA venue/category");
 const lecturer=accountForRole("LECTURER"),student=accountForRole("STUDENT"),admin=accountForRole("ADMIN");
 test.skip(!lecturer||!student||!admin,"Configure QA lecturer, student and admin accounts");
 const [l,s,a]=await Promise.all([loginAPI(request,api(info),lecturer),loginAPI(request,api(info),student),loginAPI(request,api(info),admin)]);
 let id;
 try{
  const purpose=`Private calendar QA ${Date.now()}`;
  const created=await postBooking(request,api(info),l.token,{purpose});
  const body=await created.json();expect(created.status()).toBe(201);id=body.booking.id;
  const date=body.booking.date;
  const [studentCalendar,adminCalendar]=await Promise.all([
   request.get(`${api(info)}/calendar`,{headers:h(s.token),params:{from:date,to:date,venueId:d.venueId}}),
   request.get(`${api(info)}/calendar`,{headers:h(a.token),params:{from:date,to:date,venueId:d.venueId}})
  ]);
  expect(studentCalendar.status()).toBe(200);expect(adminCalendar.status()).toBe(200);
  const studentEvent=(await studentCalendar.json()).events.find(e=>e.kind==="BOOKING"&&e.status==="CONFIRMED"&&e.venueId===d.venueId&&e.start.startsWith(date));
  const adminEvent=(await adminCalendar.json()).events.find(e=>e.id===id);
  expect(studentEvent).toBeTruthy();expect(studentEvent.label).not.toBe(purpose);
  expect(studentEvent).not.toHaveProperty("ownerName");
  expect(adminEvent).toBeTruthy();expect(adminEvent.label).toBe(purpose);
 }finally{await cleanup(request,api(info),l.token,id);}
});

test("concurrent requests cannot double-book the same venue interval",async({request},info)=>{
 test.skip(!d.venueId||!d.categoryId,"Set dedicated QA venue/category");
 const la=accountForRole("LECTURER"),ia=accountForRole("INSTRUCTOR");test.skip(!la||!ia,"Configure QA lecturer and instructor");
 const [a,b]=await Promise.all([loginAPI(request,api(info),la),loginAPI(request,api(info),ia)]);
 const payload={venueId:d.venueId,date:colomboDatePlus(10),startTime:"13:00",endTime:"14:00",
  participants:d.participants,categoryId:d.categoryId,purpose:`Concurrent QA ${Date.now()}`,facilities:d.facilities};
 const [ra,rb]=await Promise.all([
  request.post(`${api(info)}/bookings`,{headers:h(a.token),data:payload}),
  request.post(`${api(info)}/bookings`,{headers:h(b.token),data:payload})
 ]);
 const [ja,jb]=await Promise.all([ra.json(),rb.json()]);
 expect([ra.status(),rb.status()].sort((x,y)=>x-y)).toEqual([201,409]);
 const id=ra.status()===201?ja.booking.id:jb.booking.id, token=ra.status()===201?a.token:b.token;
 await cleanup(request,api(info),token,id);
});
