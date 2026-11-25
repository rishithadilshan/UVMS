function accountForRole(role) {
  const prefix = `QA_${role}`;
  const email = process.env[`${prefix}_EMAIL`]?.trim(), password = process.env[`${prefix}_PASSWORD`]?.trim();
  if (!email || !password || /replace-with-dedicated-password/i.test(password) ||
      email.toLowerCase() === `qa-${role.toLowerCase()}@example.test`) return null;
  return { role, email, password };
}
function testData() {
  return { venueId: process.env.QA_VENUE_ID || "", categoryId: process.env.QA_CATEGORY_ID || "",
    participants: Number(process.env.QA_PARTICIPANTS || 2),
    facilities: (process.env.QA_FACILITIES || "").split(",").map(s => s.trim()).filter(Boolean),
    impossibleFacility: process.env.QA_IMPOSSIBLE_FACILITY || "__uvms_qa_facility_that_does_not_exist__" };
}
module.exports = { accountForRole, testData };
