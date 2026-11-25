function colomboDatePlus(days=7) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Colombo", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
  const y=+parts.find(x=>x.type==="year").value, m=+parts.find(x=>x.type==="month").value, d=+parts.find(x=>x.type==="day").value;
  const date=new Date(Date.UTC(y,m-1,d+days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;
}
module.exports={colomboDatePlus};
