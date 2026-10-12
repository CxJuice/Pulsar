"""Run the browser UI regression against a local ParaTranz fixture.

Double-click this file after ``npm ci`` and ``npx playwright install chromium``.
The fixture only serves synthetic data and never sends writes to ParaTranz.
"""

from pathlib import Path
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen


# Local test configuration. Change these only if the ports are in use.
DEV_PORT = int(os.environ.get("SCKIT_UI_DEV_PORT", "3000"))
FIXTURE_PORT = int(os.environ.get("SCKIT_UI_FIXTURE_PORT", "3001"))
SESSION = os.environ.get("SCKIT_UI_SESSION", "sckit-ui-smoke")
STARTUP_SECONDS = 60

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "node_modules" / "@playwright" / "cli" / "playwright-cli.js"
NPM = shutil.which("npm.cmd" if os.name == "nt" else "npm")
NODE = shutil.which("node")

UI_CHECK = r'''async (page) => {
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).click();
  await page.getByRole('button', { name: '编辑全部文本' }).click();
  const waitWorkspace = async fileId => page.waitForFunction(fileId => {
    const workspace = JSON.parse(localStorage.getItem('sckit-workspace'));
    return workspace?.projectId === 4242 && workspace.fileId === fileId
      && document.querySelector('.string-list')?.getAttribute('aria-busy') === 'false';
  }, fileId);
  await waitWorkspace(0);
  const aggregateRows = page.locator('.string-list .string-row');
  if (await aggregateRows.count() !== 50) throw new Error('Edit all did not open the paginated aggregate workspace');
  if (await aggregateRows.filter({ has: page.getByRole('button', { name: '打开词条 KEY_058', exact: true }) }).count() !== 1) throw new Error('The first aggregate page is missing its expected entry');
  if (await page.locator('.row-file').count() !== 50) throw new Error('Aggregate rows are missing their source file labels');
  if (await page.getByRole('dialog', { name: /全文编辑器/ }).count()) throw new Error('Edit all opened a separate editor instead of the aggregate workspace');
  const filePicker = page.getByRole('combobox', { name: '翻译文件', exact: true });
  await filePicker.click();
  await page.getByRole('option', { name: 'audit.strings', exact: true }).click();
  await waitWorkspace(42420);
  await page.getByRole('combobox', { name: '词条状态', exact: true }).click();
  await page.getByRole('option', { name: '所有状态' }).click();
  await page.getByRole('textbox', { name: '搜索字符串' }).fill('KEY_003');
  await page.getByRole('listbox', { name: '待翻译字符串' }).getByRole('option', { name: /KEY_003/ }).waitFor();
  await page.waitForFunction(() => !!document.querySelector('.string-list [role="option"][aria-selected="true"] .row-content[aria-label="打开词条 KEY_003"]'));
  await page.getByRole('button', { name: '清除搜索' }).click();
  await page.getByText('2 / 2', { exact: true }).first().waitFor();
  const selected = await page.getByRole('listbox', { name: '待翻译字符串' }).getByRole('option', { name: /KEY_003/ }).getAttribute('aria-selected');
  if (selected !== 'true') throw new Error('Clearing search lost the selected item');
  await page.getByRole('combobox', { name: '排序方式' }).click();
  await page.getByRole('option', { name: '键值 A–Z' }).click();
  await page.getByRole('listbox', { name: '待翻译字符串' }).getByRole('option', { name: /1 打开词条 KEY_001/ }).waitFor();
  await page.getByRole('listbox', { name: '待翻译字符串' }).getByRole('option', { name: /50 打开词条 KEY_050/ }).waitFor();
  await page.getByRole('button', { name: '全文翻译并预填充', exact: true }).click();
  const batch = page.getByRole('dialog', { name: '全文翻译并预填充', exact: true });
  const concurrency = batch.getByRole('spinbutton', { name: '并发数量' });
  await concurrency.fill('4');
  await concurrency.blur();
  await page.evaluate(() => window.__auditConfigureTranslation({ delay: 2000 }));
  await batch.getByRole('button', { name: '开始翻译并预填充' }).click();
  await page.waitForFunction(() => window.__auditTranslationStats().active === 4);
  if (await concurrency.isEnabled()) throw new Error('Concurrency changed during an active batch');
  await batch.getByRole('button', { name: '停止', exact: true }).click();
  await batch.getByText(/已停止：成功 0、失败 0/).waitFor();
  const stopped = await page.evaluate(() => window.__auditTranslationStats());
  if (stopped.started !== 4 || stopped.canceled !== 4 || stopped.active !== 0) throw new Error('Stop did not cancel all four translations or started queued entries');
  await batch.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '全文翻译并预填充', exact: true }).click();
  if (await concurrency.inputValue() !== '4') throw new Error('The chosen concurrency was not retained');
  await concurrency.fill('3');
  await concurrency.blur();
  await page.evaluate(() => window.__auditConfigureTranslation({ delay: 150, failOnceText: 'Audit entry 23', timeouts: { 'Audit entry 24': 1, 'Audit entry 25': 3 } }));
  await batch.getByRole('button', { name: '开始翻译并预填充' }).click();
  await batch.getByText(/已处理 40 \/ 40 条：成功 38、失败 2/).waitFor();
  const completed = await page.evaluate(() => ({ stats: window.__auditTranslationStats(), drafts: window.__auditDrafts() }));
  if (completed.stats.maximum !== 3 || completed.stats.started !== 43) throw new Error('Timeout retries exceeded concurrency three or used the wrong attempt count');
  if (completed.stats.attempts['Audit entry 24'] !== 2 || completed.stats.attempts['Audit entry 25'] !== 3) throw new Error('Timeouts did not recover or respect the retry limit');
  if (await batch.locator('details').count() || await batch.getByText(/本地模拟翻译失败|翻译请求超时|KEY_038/).count()) throw new Error('Individual entry failures are still displayed');
  for (let id = 121; id <= 160; id++) {
    if (id === 123 || id === 125) continue;
    const expected = '本地模拟译文：Audit entry ' + String(id - 100).padStart(2, '0');
    if (completed.drafts['4242/' + id]?.translation !== expected) throw new Error('Parallel results were written to the wrong entry');
  }
  await page.evaluate(() => window.__auditConfigureTranslation({ delay: 150 }));
  await batch.getByRole('button', { name: '重试失败项' }).click();
  await batch.getByText(/已处理 2 \/ 2 条：成功 2、失败 0/).waitFor();
  if ((await page.evaluate(() => window.__auditTranslationStats())).started !== 2) throw new Error('Retry translated successful entries again');
  await batch.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).click();
  await page.getByRole('main', { name: '项目文件管理' }).getByRole('button', { name: /audit.strings.*开始翻译/ }).click();
  await page.getByRole('button', { name: '全文翻译并预填充', exact: true }).click();
  if (await concurrency.inputValue() !== '3') throw new Error('Concurrency did not survive a page reload');
  await concurrency.fill('4');
  await concurrency.blur();
  await batch.getByRole('radio', { name: /保存到 ParaTranz/ }).check();
  await page.evaluate(() => window.__auditConfigureTranslation({ delay: 150, slowAfterFirst: true }));
  await batch.getByRole('button', { name: '开始翻译并预填充' }).click();
  await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.auditCalls).some(call => call.action === 'save'));
  await page.waitForFunction(() => window.__auditTranslationStats().active === 4 && window.__auditTranslationStats().started >= 5);
  await batch.getByRole('button', { name: '停止', exact: true }).click();
  await batch.getByText(/已停止：成功 1、失败 0/).waitFor();
  const afterSaveStop = await page.evaluate(() => ({ stats: window.__auditTranslationStats(), saves: JSON.parse(document.documentElement.dataset.auditCalls).filter(call => call.action === 'save').length }));
  if (afterSaveStop.saves !== 1 || afterSaveStop.stats.canceled !== 4) throw new Error('Stop did not finish just the active save and cancel the other translations');
}'''


SINGLE_CONTEXT_CHECK = r'''async (page) => {
  await page.goto('http://127.0.0.1:3001/');
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).waitFor();
  await page.evaluate(async () => {
    ['Avenger Combat Helmet Red', 'Avenger Combat Helmet Blue', 'Avenger Combat Helmet Carbon Fiber'].forEach((text, index) => window.__auditSetOriginal(121 + index, text));
    const settings = (await window.scKit.getTranslationSettings()).data;
    await window.scKit.saveTranslationSettings({ ...settings, provider: 'llm', mode: 'api', llmModel: 'synthetic-model', llmConfigured: true });
    window.__auditConfigureTranslation({ delay: 150 });
  });
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).click();
  await page.getByRole('main', { name: '项目文件管理' }).getByRole('button', { name: /audit.strings.*开始翻译/ }).click();
  await page.getByRole('button', { name: '打开词条 KEY_040', exact: true }).click();
  await page.getByRole('button', { name: '翻译', exact: true }).click();
  const source = page.getByRole('textbox', { name: '当前句子或选中的文本', exact: true });
  const result = page.locator('.translation-result-text');
  const translate = page.getByRole('button', { name: 'LLM 翻译并填入', exact: true });
  const select = async (key, expected) => {
    await page.getByRole('button', { name: '打开词条 ' + key, exact: true }).click();
    await page.waitForFunction(expected => document.querySelector('#translation-source')?.value === expected, expected);
  };
  const expectResult = async text => {
    await page.waitForFunction(text => document.querySelector('.translation-result-text')?.textContent === '本地模拟译文：' + text, text);
    await translate.waitFor();
  };
  await translate.click();
  await expectResult('Avenger Combat Helmet Red');
  await select('KEY_039', 'Avenger Combat Helmet Blue');
  await translate.click();
  await expectResult('Avenger Combat Helmet Blue');
  const sent = await page.evaluate(() => JSON.parse(document.documentElement.dataset.auditCalls).filter(call => call.action === 'translate').map(call => call.payload));
  if (JSON.stringify(sent[0].context.shared) !== JSON.stringify(sent[1].context.shared)) throw new Error('Single-entry variants did not share stable references');
  if (!sent[1].context.terms.some(term => term.term === 'Blue' && term.translation === '蓝色') || sent[0].context.key === sent[1].context.key) throw new Error('Shared references replaced per-entry glossary or identity');
  await select('KEY_040', 'Avenger Combat Helmet Red');
  await translate.click();
  await expectResult('Avenger Combat Helmet Red');
  await page.getByRole('status').filter({ hasText: '已复用本机缓存' }).waitFor();
  if ((await page.evaluate(() => window.__auditTranslationStats())).started !== 2) throw new Error('Returning to an identical request called the provider again');
  await page.getByRole('button', { name: '重新请求翻译', exact: true }).click();
  await expectResult('Avenger Combat Helmet Red');
  if ((await page.evaluate(() => window.__auditTranslationStats())).started !== 3) throw new Error('Forced translation did not bypass the result cache');
  await page.evaluate(() => window.__auditSetTerm('Red', '新的红色译名'));
  await page.getByRole('button', { name: /^项目术语|^术语/ }).click();
  await page.getByRole('button', { name: '刷新术语', exact: true }).click();
  await page.getByText('新的红色译名', { exact: true }).waitFor();
  await page.getByRole('button', { name: '翻译', exact: true }).click();
  await translate.click();
  await expectResult('Avenger Combat Helmet Red');
  if ((await page.evaluate(() => window.__auditTranslationStats())).started !== 4) throw new Error('Glossary refresh did not invalidate the result/context cache');
  const refreshed = await page.evaluate(() => JSON.parse(document.documentElement.dataset.auditCalls).filter(call => call.action === 'translate').at(-1).payload);
  if (!refreshed.context.terms.some(term => term.term === 'Red' && term.translation === '新的红色译名')) throw new Error('Updated glossary was not sent');
  await page.evaluate(async () => {
    const settings = (await window.scKit.getTranslationSettings()).data;
    const saved = await window.scKit.saveTranslationSettings({ ...settings, llmPrefixPrompt: 'New style' });
    window.dispatchEvent(new CustomEvent('sckit:translation-settings-updated', { detail: saved.data }));
    window.__auditConfigureTranslation({ delay: 800 });
  });
  await select('KEY_039', 'Avenger Combat Helmet Blue');
  await translate.click();
  await page.waitForFunction(() => window.__auditTranslationStats().active === 1);
  await select('KEY_038', 'Avenger Combat Helmet Carbon Fiber');
  await translate.click();
  await expectResult('Avenger Combat Helmet Carbon Fiber');
  const switched = await page.evaluate(() => window.__auditTranslationStats());
  if (switched.started !== 2 || switched.canceled !== 1 || switched.active !== 0) throw new Error('Fast switching delayed the new request or failed to cancel the old one');
  if (await page.getByRole('textbox', { name: '译文', exact: true }).inputValue() !== '本地模拟译文：Avenger Combat Helmet Carbon Fiber') throw new Error('Canceled result filled a different entry');
  await source.fill('Translate only this selected fragment.');
  await translate.click();
  await expectResult('Translate only this selected fragment.');
  const fragment = await page.evaluate(() => JSON.parse(document.documentElement.dataset.auditCalls).filter(call => call.action === 'translate').at(-1).payload);
  if (fragment.context.shared) throw new Error('A text fragment reused the complete-entry group');
  return 'Single translation cache passed: shared references, exact hits, forced refresh, glossary invalidation, fast switching and fragment isolation.';
}'''


GROUP_CONTEXT_CHECK = r'''async (page) => {
  await page.goto('http://127.0.0.1:3001/');
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).waitFor();
  await page.evaluate(async () => {
    const variants = ['Avenger Combat Helmet Red', 'Avenger Combat Helmet Blue', 'Avenger Combat Helmet Carbon Fiber',
      'Arden Assault Vest Level 1', 'Arden Assault Vest Level 2', 'Arden Assault Vest Level 3'];
    variants.forEach((source, index) => window.__auditSetOriginal(121 + index, source));
    const settings = (await window.scKit.getTranslationSettings()).data;
    await window.scKit.saveTranslationSettings({ ...settings, provider: 'llm', mode: 'api', llmModel: 'synthetic-model', llmConfigured: true });
    window.__auditConfigureTranslation({ delay: 1500 });
  });
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).click();
  await page.getByRole('main', { name: '项目文件管理' }).getByRole('button', { name: /audit.strings.*开始翻译/ }).click();
  for (const key of ['KEY_040', 'KEY_039', 'KEY_038', 'KEY_037', 'KEY_036', 'KEY_035']) {
    await page.getByRole('checkbox', { name: '选择词条 ' + key, exact: true }).check();
  }
  await page.getByRole('button', { name: '全文翻译并预填充', exact: true }).click();
  const batch = page.getByRole('dialog', { name: '全文翻译并预填充', exact: true });
  await batch.getByRole('spinbutton', { name: '并发数量' }).fill('6');
  await batch.getByRole('button', { name: '开始翻译并预填充' }).click();
  await page.waitForFunction(() => window.__auditTranslationStats().active === 6);
  const sent = await page.evaluate(() => JSON.parse(document.documentElement.dataset.auditCalls).filter(call => call.action === 'translate').map(call => call.payload));
  if (sent.length !== 6) throw new Error('Grouped translations waited for a model warmup or were serialized');
  const helmets = sent.filter(call => call.text.startsWith('Avenger'));
  const vests = sent.filter(call => call.text.startsWith('Arden'));
  for (const group of [helmets, vests]) {
    if (group.length !== 3 || new Set(group.map(call => JSON.stringify(call.context.shared))).size !== 1) throw new Error('Variants did not use exactly the same shared context');
    if (!group[0].context.shared.variantTemplate?.includes('[variant]')) throw new Error('General variant structure was not recognized');
  }
  if (JSON.stringify(helmets[0].context.shared) === JSON.stringify(vests[0].context.shared)) throw new Error('Unrelated equipment contexts were mixed');
  if (helmets[0].context.shared.terms.some(term => ['Red', 'Blue', 'Carbon Fiber'].includes(term.term))) throw new Error('Variant-specific terms leaked into the shared prefix');
  const blue = sent.find(call => call.text.endsWith('Blue'));
  const carbon = sent.find(call => call.text.endsWith('Carbon Fiber'));
  if (!blue.context.terms.some(term => term.term === 'Blue' && term.translation === '蓝色') || !carbon.context.terms.some(term => term.term === 'Carbon Fiber' && term.translation === '碳纤维')) throw new Error('Current variant terms were dropped');
  if (new Set(sent.map(call => call.context.key)).size !== 6 || new Set(sent.map(call => call.context.notes.entryContext)).size !== 6) throw new Error('Per-entry key or notes were mixed');
  await batch.getByText(/已处理 6 \/ 6 条：成功 6、失败 0/).waitFor();
  const drafts = await page.evaluate(() => window.__auditDrafts());
  for (const call of sent) {
    const id = 161 - Number(call.context.key.slice(4));
    if (drafts['4242/' + id]?.translation !== '本地模拟译文：' + call.text) throw new Error('A variant reused another entry\'s translation');
  }
  return 'Grouped context regression passed: generic attributes, six parallel requests, per-entry glossary/notes and independent results.';
}'''


SAVE_NEXT_CHECK = r'''async (page) => {
  await page.goto('http://127.0.0.1:3001/');
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).waitFor();
  await page.evaluate(async () => {
    if (!window.__auditDrafts) throw new Error('Save-next regression requires the local fixture');
    for (const [id, translation] of [[122, '下一条本地预填充'], [151, '跨页本地预填充'], [154, '']]) {
      await window.scKit.request('draft', { projectId: 4242, stringId: id, translation, stage: 0, updatedAt: new Date().toISOString() });
    }
    window.__auditSetRemote(152, '下一条远端预填充');
    window.__auditSetRemote(154, '待删除远端译文');
  });
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).click();
  await page.getByRole('main', { name: '项目文件管理' }).getByRole('button', { name: /audit.strings.*开始翻译/ }).click();
  const field = page.getByRole('textbox', { name: '译文', exact: true });
  const waitSelected = async key => {
    await page.waitForFunction(key => document.querySelector('.string-list [role="option"][aria-selected="true"] .row-content')?.getAttribute('aria-label') === '打开词条 ' + key, key);
    await field.waitFor();
  };
  const expectTranslation = async expected => {
    await page.waitForFunction(expected => document.querySelector('textarea[aria-label="译文"]')?.value === expected, expected);
  };
  await waitSelected('KEY_040');
  await field.fill('当前词条提交内容');
  await field.press('Tab');
  await waitSelected('KEY_039');
  await expectTranslation('下一条本地预填充');
  await page.getByRole('button', { name: '提交并下一条', exact: true }).click();
  await waitSelected('KEY_038');
  await expectTranslation('');
  await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.auditCalls).some(call => call.action === 'save' && call.payload.stringId === 122));
  const firstSaves = await page.evaluate(() => JSON.parse(document.documentElement.dataset.auditCalls).filter(call => call.action === 'save'));
  if (!firstSaves.some(call => call.payload.stringId === 122 && call.payload.translation === '下一条本地预填充')) throw new Error('Restored prefill could not be submitted without retyping');
  if (firstSaves.some(call => call.payload.stringId === 123)) throw new Error('Moving to an empty entry submitted a blank translation');
  if (await page.getByRole('button', { name: '提交并下一条', exact: true }).isEnabled()) throw new Error('An untouched empty entry became dirty');
  await page.getByRole('combobox', { name: '词条状态', exact: true }).click();
  await page.getByRole('option', { name: '所有状态', exact: true }).click();
  await waitSelected('KEY_060');
  await field.fill('第一条更新后的译文');
  await page.getByRole('button', { name: '提交并下一条', exact: true }).click();
  await waitSelected('KEY_059');
  await expectTranslation('测试译文 2');
  await page.getByRole('button', { name: '打开词条 KEY_011', exact: true }).click();
  await waitSelected('KEY_011');
  await field.fill('上一页最后一条译文');
  await page.getByRole('button', { name: '提交并下一条', exact: true }).click();
  await waitSelected('KEY_010');
  await expectTranslation('跨页本地预填充');
  await page.getByRole('button', { name: '提交并下一条', exact: true }).click();
  await waitSelected('KEY_009');
  await expectTranslation('下一条远端预填充');
  await page.getByRole('button', { name: '下一条字符串', exact: true }).click();
  await waitSelected('KEY_008');
  await expectTranslation('');
  await page.getByRole('button', { name: '上一条字符串', exact: true }).click();
  await waitSelected('KEY_009');
  await expectTranslation('下一条远端预填充');
  await field.fill('远端预填充的更新');
  await field.press('Control+Enter');
  await waitSelected('KEY_008');
  await expectTranslation('');
  await page.getByRole('button', { name: '提交疑问并下一条', exact: true }).click();
  await waitSelected('KEY_007');
  await expectTranslation('');
  if (!await page.getByRole('button', { name: '提交并下一条', exact: true }).isEnabled()) throw new Error('An intentional empty draft was hidden as a cleared display');
  return 'Save-next regression passed: local and empty drafts, remote translation, page boundary, shortcuts and manual navigation.';
}'''


SUGGESTION_NAVIGATION_CHECK = r'''async (page) => {
  await page.goto('http://127.0.0.1:3001/');
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).waitFor();
  await page.evaluate(async () => {
    const base = window.scKit.request.bind(window.scKit);
    const project = (await base('project', { projectId: 4242 })).data;
    const file = (await base('files', { projectId: 4242 })).data[0];
    const rows = (await base('strings', { projectId: 4242, pageSize: 800 })).data.results;
    const otherProject = { ...project, id: 4343, name: '另一个本地项目' };
    const otherFile = { ...file, id: 42421, name: 'other.strings', total: 1, translated: 1 };
    const foreignFile = { ...otherFile, id: 43430, project: 4343, name: 'foreign.strings' };
    const other = { ...rows[0], id: 9001, key: 'OTHER_FILE', fileId: otherFile.id, file: otherFile, translation: '其他文件译文' };
    const foreign = { ...rows[0], id: 9101, project: 4343, key: 'FOREIGN', fileId: foreignFile.id, file: foreignFile, translation: '另一个项目译文' };
    const candidates = [rows[0], other, foreign, { ...foreign, id: 999, key: 'DENIED' }];
    const ok = data => ({ ok: true, data: JSON.parse(JSON.stringify(data)) });
    window.__jumpCalls = [];
    window.scKit.openExternal = async url => { window.__jumpCalls.push({ action: 'external', url }); };
    window.scKit.request = async (action, p = {}, requestId) => {
      window.__jumpCalls.push({ action, payload: p });
      if (action === 'project') return ok(p.projectId === 4343 ? otherProject : project);
      if (action === 'files') return ok(p.projectId === 4343 ? [foreignFile] : [file, otherFile]);
      if (action === 'suggestions') return ok(candidates.map(row => ({ ...row, matching: .9, project: row.project === 4343 ? otherProject : project })));
      if (action === 'memory') return ok({ results: [{ ...foreign, project: otherProject }], rowCount: 1, page: 1, pageSize: 50 });
      if (action === 'string') {
        if (p.stringId === 999) return { ok: false, message: '本地模拟：没有词条访问权限' };
        return ok((p.projectId === 4343 ? [foreign] : [...rows, other]).find(row => row.id === p.stringId));
      }
      if (action === 'strings') {
        let matched = (p.projectId === 4343 ? [foreign] : [...rows, other]).filter(row => (!p.fileId || row.fileId === p.fileId) && (p.stage == null || row.stage === p.stage));
        const text = (p.text || '').toLowerCase();
        if (text) matched = matched.filter(row => (p.searchMode === 'text' ? [row.original, row.translation, row.key].join(' ') : String(row[p.searchMode] || '')).toLowerCase().includes(text));
        const size = p.pageSize || 50, count = Math.max(1, Math.ceil(matched.length / size)), current = Math.min(p.page || 1, count);
        return ok({ results: matched.slice((current - 1) * size, current * size), rowCount: matched.length, pageCount: count, page: current, pageSize: size });
      }
      return base(action, p, requestId);
    };
  });
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).click();
  await page.getByRole('main', { name: '项目文件管理' }).getByRole('button', { name: /audit.strings.*开始翻译/ }).click();
  const field = page.getByRole('textbox', { name: '译文', exact: true });
  const waitSelected = async (key, translation) => {
    await page.waitForFunction(({ key, translation }) => {
      const row = document.querySelector('.string-list [role="option"][aria-selected="true"] .row-content');
      const field = document.querySelector('textarea[aria-label="译文"]');
      return row?.getAttribute('aria-label') === '打开词条 ' + key && field?.value === translation && !field.disabled;
    }, { key, translation });
  };
  const jump = key => page.getByTitle('在本地编辑器中定位 ' + key, { exact: true }).click();
  await waitSelected('KEY_040', '');
  await field.fill('跳转前保留的草稿');
  await jump('DENIED');
  await page.locator('.error-banner').filter({ hasText: '本地模拟：没有词条访问权限' }).waitFor();
  await waitSelected('KEY_040', '跳转前保留的草稿');
  await jump('KEY_060');
  await waitSelected('KEY_060', '测试译文 1');
  if (await page.getByRole('textbox', { name: '搜索字符串' }).inputValue() !== 'KEY_060') throw new Error('The source key was not used to locate the entry');
  if (!(await page.getByRole('combobox', { name: '词条状态', exact: true }).innerText()).includes('所有状态')) throw new Error('The untranslated filter still hides the translated target');
  if ((await page.evaluate(() => window.__auditDrafts()))['4242/121']?.translation !== '跳转前保留的草稿') throw new Error('Jump discarded the previous edit');
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await waitSelected('KEY_010', '');
  await jump('KEY_060');
  await waitSelected('KEY_060', '测试译文 1');
  await field.fill('跨文件前的草稿');
  await jump('OTHER_FILE');
  await waitSelected('OTHER_FILE', '其他文件译文');
  const workspace = await page.evaluate(() => JSON.parse(localStorage.getItem('sckit-workspace')));
  if (workspace.fileId !== 42421 || workspace.projectId !== 4242) throw new Error('Cross-file jump did not change the active file');
  if ((await page.evaluate(() => window.__auditDrafts()))['4242/101']?.translation !== '跨文件前的草稿') throw new Error('Cross-file jump lost a draft');
  await jump('FOREIGN');
  await waitSelected('FOREIGN', '另一个项目译文');
  await jump('KEY_060');
  await waitSelected('KEY_060', '跨文件前的草稿');
  const memory = page.getByRole('region', { name: '搜索历史翻译' });
  await memory.getByRole('searchbox', { name: '输入原文、译文或键值进行搜索' }).fill('foreign');
  await memory.getByRole('button', { name: '搜索历史翻译', exact: true }).click();
  await memory.getByTitle('在本地编辑器中定位 FOREIGN', { exact: true }).click();
  await waitSelected('FOREIGN', '另一个项目译文');
  await jump('KEY_060');
  await waitSelected('KEY_060', '跨文件前的草稿');
  const card = page.locator('.suggestion-card').filter({ has: page.getByTitle('在本地编辑器中定位 KEY_060', { exact: true }) });
  await field.fill('查看所有情况前的草稿');
  await card.getByRole('button', { name: '显示所有出现的情况', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sckit-workspace'))?.fileId === 0);
  await waitSelected('KEY_060', '查看所有情况前的草稿');
  const occurrenceScope = await page.evaluate(() => JSON.parse(localStorage.getItem('sckit-workspace')));
  if (occurrenceScope.fileId !== 0 || occurrenceScope.projectId !== 4242) throw new Error('Occurrences did not open all files in the local editor');
  if (await page.getByRole('dialog', { name: '词汇索引', exact: true }).count()) throw new Error('Occurrences still opened a separate dialog');
  if (await page.locator('.string-list [role="option"]').count() !== 2) throw new Error('Occurrences did not include the matching entry in another file');
  await page.getByRole('button', { name: '打开词条 OTHER_FILE', exact: true }).click();
  await waitSelected('OTHER_FILE', '其他文件译文');
  const foreignCard = page.locator('.suggestion-card').filter({ has: page.getByTitle('在本地编辑器中定位 FOREIGN', { exact: true }) });
  await foreignCard.getByRole('button', { name: '显示所有出现的情况', exact: true }).click();
  await waitSelected('FOREIGN', '另一个项目译文');
  if ((await page.evaluate(() => JSON.parse(localStorage.getItem('sckit-workspace')))).projectId !== 4343) throw new Error('Occurrences did not switch to the suggestion source project');
  await jump('KEY_060');
  await waitSelected('KEY_060', '查看所有情况前的草稿');
  await page.getByRole('button', { name: '词汇索引', exact: true }).click();
  const concordance = page.getByRole('dialog', { name: '词汇索引', exact: true });
  const occurrence = concordance.locator('.concordance-row').filter({ hasText: 'other.strings' });
  await occurrence.getByRole('button', { name: '查看词条', exact: true }).click();
  await concordance.waitFor({ state: 'hidden' });
  await waitSelected('OTHER_FILE', '其他文件译文');
  const calls = await page.evaluate(() => window.__jumpCalls);
  if (calls.some(call => ['external', 'save'].includes(call.action))) throw new Error('A local jump opened a web page or submitted a translation');
  return 'Suggestion navigation passed: filters, other pages/files/projects, drafts, memory, concordance and access failures.';
}'''


def port_open(port: int) -> bool:
    with socket.socket() as connection:
        connection.settimeout(0.5)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def app_ready() -> bool:
    try:
        with urlopen(f"http://127.0.0.1:{FIXTURE_PORT}/", timeout=2) as response:
            return response.status == 200 and b"ScTranslateKit" in response.read(100_000)
    except OSError:
        return False


def stop_tree(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    else:
        import signal
        os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def main(checks: list[str] | None = None) -> int:
    if not NPM or not NODE or not CLI.exists():
        print("Run npm ci before the UI smoke test.", file=sys.stderr)
        return 2
    if port_open(DEV_PORT) or port_open(FIXTURE_PORT):
        print(f"Ports {DEV_PORT} and {FIXTURE_PORT} must be free.", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="sckit-ui-smoke-") as temporary:
        processes = []
        logs = []
        try:
            for command, name in [
                ([NPM, "run", "dev:web", "--", "--port", str(DEV_PORT)], "nuxt.log"),
                ([NODE, str(ROOT / "tests" / "ui" / "browser-fixture-server.cjs")], "fixture.log"),
            ]:
                output = open(Path(temporary) / name, "w", encoding="utf-8")
                logs.append(output)
                options = {"cwd": ROOT, "stdout": output, "stderr": subprocess.STDOUT}
                if os.name == "nt":
                    options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
                else:
                    options["start_new_session"] = True
                processes.append(subprocess.Popen(command, **options))
            deadline = time.monotonic() + STARTUP_SECONDS
            while time.monotonic() < deadline:
                if all(port_open(port) for port in (DEV_PORT, FIXTURE_PORT)) and app_ready():
                    break
                if any(process.poll() is not None for process in processes):
                    raise RuntimeError("A local UI test server exited during startup")
                time.sleep(0.25)
            else:
                raise RuntimeError("Local UI test servers did not become ready")
            cli = [NODE, str(CLI), "--session", SESSION]
            subprocess.run([*cli, "open", f"http://127.0.0.1:{FIXTURE_PORT}"], cwd=ROOT, check=True)
            subprocess.run([*cli, "snapshot"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
            for check in checks if checks is not None else [UI_CHECK, SAVE_NEXT_CHECK, GROUP_CONTEXT_CHECK, SUGGESTION_NAVIGATION_CHECK, SINGLE_CONTEXT_CHECK]:
                check = check.replace("127.0.0.1:3001", f"127.0.0.1:{FIXTURE_PORT}")
                subprocess.run([*cli, "run-code", " ".join(check.splitlines())], cwd=ROOT, check=True)
            print("Browser UI regression passed.")
            return 0
        except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
            print(f"Browser UI regression failed: {type(error).__name__}", file=sys.stderr)
            if CLI.exists() and NODE:
                snapshot = subprocess.run([NODE, str(CLI), "--session", SESSION, "snapshot"], cwd=ROOT, capture_output=True, text=True)
                print("\n".join(line for line in snapshot.stdout.splitlines() if any(marker in line for marker in ("KEY_003", "搜索字符串", " / 2", "加载词条", "停止加载"))), file=sys.stderr)
            for output in logs:
                output.flush()
                print(Path(output.name).read_text(encoding="utf-8")[-3000:], file=sys.stderr)
            return 1
        finally:
            if CLI.exists():
                subprocess.run([NODE, str(CLI), "--session", SESSION, "close"], cwd=ROOT, capture_output=True)
            for process in reversed(processes):
                stop_tree(process)
            for output in logs:
                output.close()


if __name__ == "__main__":
    raise SystemExit(main())
