const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class McpRecoveryJournal {
  constructor(file, { maxBytes = 64 * 1024 * 1024 } = {}) { this.file = file; this.maxBytes = maxBytes; }
  append(record) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const line = Buffer.from(JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
    const size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
    if (size + line.length > this.maxBytes) throw new Error('MCP 恢复日志已达容量上限，请导出并清理日志后重试');
    const descriptor = fs.openSync(this.file, 'a', 0o600);
    try { fs.writeFileSync(descriptor, line); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
  }
  prepare(accountId, projectId, items) {
    const id = randomUUID();
    this.append({ id, state: 'prepared', accountId, projectId, items: items.map(item => ({
      stringId: item.stringId,
      before: { original: item.expectedOriginal, translation: item.expectedTranslation, stage: item.expectedStage, updatedAt: item.expectedUpdatedAt },
      intended: { translation: item.translation, stage: item.stage },
      draftBefore: { translation: item.expectedDraftTranslation, stage: item.expectedDraftStage, updatedAt: item.expectedDraftUpdatedAt },
    })) });
    return id;
  }
  outcome(id, result) {
    // An unconfirmed response is never automatically replayed from the journal.
    this.append({ id, state: result.ok ? 'acknowledged' : [400, 401, 403, 409, 413].includes(result.status) ? 'rejected' : 'unconfirmed',
      status: result.status, message: result.message,
      results: result.data?.results?.map(item => ({ stringId: item.stringId, saved: item.saved, message: item.message })) });
  }
  verify(id, entries) {
    this.append({ id, state: 'verification', entries: entries.map(entry => ({ stringId: entry.stringId,
      verified: entry.verified, warning: entry.warning })) });
  }
}
module.exports = { McpRecoveryJournal };
