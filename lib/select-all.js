// Supabase sends at most 1000 rows for one request, so a table that can grow past that is read in
// pages. make() builds the query with a stable order; the result is { data, error } like a select.
async function selectAll(make, page = 1000) {
  let rows = [];
  for (let from = 0; from < 200000; from += page) {
    const { data, error } = await make().range(from, from + page - 1);
    if (error) return { data: from ? rows : null, error };
    rows = rows.concat(data || []);
    if (!data || data.length < page) break;
  }
  return { data: rows, error: null };
}

module.exports = { selectAll };
