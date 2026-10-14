// Fetch pending requests separately so newer history cannot hide frozen points.
export async function getPendingRedemptions(fetchPage) {
  const requests = [];
  const limit = 200;
  for (let offset = 0; ; offset += limit) {
    const page = await fetchPage({ status: 'pending', limit, offset });
    requests.push(...page);
    if (page.length < limit) return requests;
  }
}
