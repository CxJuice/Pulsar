const MCP_BATCH_LIMIT = 25;
const MCP_READ_CONCURRENCY = 4;

function validateBatchIds(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MCP_BATCH_LIMIT ||
    ids.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) || new Set(ids).size !== ids.length) {
    throw new Error(`批量任务需包含 1 到 ${MCP_BATCH_LIMIT} 个不重复的有效词条 ID`);
  }
}

async function mapLimit(items, limit, action) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await action(items[index], index);
    }
  }));
  return results;
}

function batchSummary(projectId, results) {
  const succeeded = results.filter(result => result.ok === true).length;
  return { projectId, total: results.length, succeeded, failed: results.length - succeeded, results };
}

module.exports = { MCP_BATCH_LIMIT, MCP_READ_CONCURRENCY, validateBatchIds, mapLimit, batchSummary };
