const { norm } = require('./availability');

/**
 * Rule-based venue recommendation (no AI / paid services). Venues passed in already satisfy every MANDATORY
 * requirement (capacity, facilities, availability, maintenance). They are ranked by how well they match the
 * optional preferences. Score components (max 100):
 *   55  baseline for meeting all mandatory requirements
 *   25  capacity fit  (the closer the capacity is to the participant count the better; very large rooms score lower)
 *   10  preferred building (when specified)
 *   10  preferred venue type (when specified)
 *  -3   per unrequested extra facility (max -10) so specialised rooms are not wasted on simple requests
 */
function scoreVenue(venue, { participants, facilities = [], building, type }) {
  let score = 55;
  const fit = participants ? Math.min(1, participants / venue.capacity) : 0.5;
  score += Math.round(25 * fit);
  const wantBuilding = norm(building), wantType = norm(type);
  const buildingMatch = !!wantBuilding && norm(venue.building) === wantBuilding;
  const typeMatch = !!wantType && norm(venue.type) === wantType;
  if (buildingMatch) score += 10;
  if (typeMatch) score += 10;
  const req = new Set(facilities.map(norm));
  const extras = (venue.facilities || []).filter((f) => !req.has(norm(f))).length;
  score -= Math.min(10, extras * 3);
  return { score: Math.max(0, Math.min(100, score)), buildingMatch, typeMatch };
}

function explain(venue, criteria, s) {
  const parts = [];
  parts.push(criteria.participants ? `sufficient capacity (${venue.capacity} seats for ${criteria.participants} participants)` : `${venue.capacity} seats`);
  if (criteria.facilities?.length) parts.push(`all requested facilities (${criteria.facilities.join(', ')})`);
  parts.push('is available during your selected time');
  let text = `Recommended because this venue has ${parts[0]}${criteria.facilities?.length ? `, ${parts[1]}` : ''}, and ${parts[parts.length - 1]}`;
  if (s.buildingMatch) text += `; it is in your preferred building (${venue.building})`;
  if (s.typeMatch) text += `; it matches your preferred venue type (${venue.type})`;
  return `${text}.`;
}

function rank(venues, criteria) {
  const ranked = venues.map((v) => { const s = scoreVenue(v, criteria); return { venue: v, ...s, explanation: explain(v, criteria, s) }; });
  ranked.sort((a, b) => b.score - a.score || a.venue.capacity - b.venue.capacity || a.venue.name.localeCompare(b.venue.name));
  return ranked;
}

module.exports = { scoreVenue, rank, explain };
