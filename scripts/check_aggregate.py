"""Verify the shared editor's aggregate scope using synthetic files.

Double-click after npm ci and installing the Playwright browser.
No real ParaTranz data is read or submitted.
"""

import os

# Keep this regression separate from other local browser tests.
os.environ.setdefault("SCKIT_UI_DEV_PORT", "3020")
os.environ.setdefault("SCKIT_UI_FIXTURE_PORT", "3021")
os.environ.setdefault("SCKIT_UI_SESSION", "sckit-aggregate")

from ui_smoke import FIXTURE_PORT, ROOT, main


AGGREGATE_CHECK = r'''async (page) => {
  try {
  await page.goto('http://127.0.0.1:3001/');
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).waitFor();
  await page.evaluate(() => {
    window.__auditSetOriginal(101, 'Aggregate shared source Alpha');
    window.__auditAddFile(
      { id: 42421, name: 'audit-other.strings', project: 4242, total: 4, translated: 2, disputed: 1, checked: 0, reviewed: 0, hidden: 0, locked: 0, words: 40 },
      [
        { id: 201, key: 'KEY_060', original: 'Aggregate shared source Beta', translation: '', stage: 0, context: '跨文件查询上下文' },
        { id: 202, key: 'AGGREGATE_TRANSLATED', original: 'Aggregate translated source', translation: '聚合查询译文', stage: 1 },
        { id: 203, key: 'AGGREGATE_DISPUTED', original: 'Aggregate disputed source', translation: '待核对译文', stage: 2 },
        { id: 204, key: 'AGGREGATE_PREFILL', original: 'Aggregate prefill source', translation: '', stage: 0 },
      ]
    );
  });
  await page.getByRole('button', { name: /审计测试项目 #4242/ }).click();
  await page.getByRole('main', { name: '项目文件管理' }).getByRole('button', { name: /audit.strings.*开始翻译/ }).click();
  const field = page.getByRole('textbox', { name: '译文', exact: true });
  const search = page.getByRole('textbox', { name: '搜索字符串' });
  const rows = page.locator('.string-list .string-row');
  const choose = async (label, option) => {
    const picker = page.getByRole('combobox', { name: label, exact: true });
    await picker.click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.string-list')?.getAttribute('aria-busy') === 'false' && !document.querySelector('button[aria-label="翻译文件"]')?.disabled);
  };
  const query = async (value, count) => {
    await search.fill(value);
    await page.waitForFunction(({ value, count }) => {
      const calls = JSON.parse(document.documentElement.dataset.auditCalls);
      const last = calls.filter(call => call.action === 'strings').at(-1);
      return last?.payload.text === value && document.querySelector('.string-list')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('.string-list .string-row').length === count;
    }, { value, count });
  };
  await field.fill('切换前保留的草稿');
  await choose('翻译文件', '全文聚合（全部文件）');
  if (!(await page.locator('.status-tabs').innerText()).includes('64')) throw new Error('Aggregate totals did not include both files');
  if (!(await page.locator('.status-tabs').innerText()).includes('42')) throw new Error('Aggregate untranslated count is incorrect');
  if (await rows.count() !== 50) throw new Error('Aggregate list did not retain the shared pagination');
  if (await page.getByRole('dialog', { name: /全文编辑器/ }).count()) throw new Error('Aggregate opened a separate editor');
  if ((await page.evaluate(() => window.__auditDrafts()))['4242/121']?.translation !== '切换前保留的草稿') throw new Error('Scope change discarded an edit');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.string-list .string-row').length === 14);
  if (await rows.filter({ hasText: 'audit-other.strings' }).count() !== 4) throw new Error('Cross-file pagination or source labels are missing');
  await choose('搜索范围', '原文');
  await query('Aggregate shared source', 2);
  if (await rows.filter({ hasText: 'audit.strings' }).count() !== 1 || await rows.filter({ hasText: 'audit-other.strings' }).count() !== 1) throw new Error('Search did not span files');
  const secondFileRow = () => rows.filter({ hasText: 'audit-other.strings' });
  await secondFileRow().getByRole('button', { name: '打开词条 KEY_060', exact: true }).click();
  await field.fill('聚合模式草稿');
  await choose('翻译文件', 'audit-other.strings');
  if (await field.inputValue() !== '聚合模式草稿' || await rows.count() !== 1) throw new Error('The original editor did not preserve the aggregate draft');
  if (await page.locator('.row-file').count()) throw new Error('Aggregate labels leaked into single-file mode');
  await choose('翻译文件', '全文聚合（全部文件）');
  await secondFileRow().getByRole('button', { name: '打开词条 KEY_060', exact: true }).click();
  await page.getByRole('button', { name: '提交并下一条', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.auditCalls).some(call => call.action === 'save' && call.payload.stringId === 201));
  await page.waitForFunction(() => document.querySelector('.string-list')?.textContent.includes('聚合模式草稿'));
  const saved = await page.evaluate(async () => (await window.scKit.request('string', { projectId: 4242, stringId: 201 })).data);
  if (saved.translation !== '聚合模式草稿' || saved.fileId !== 42421) throw new Error('Aggregate save targeted the wrong entry');
  const primary = await page.evaluate(async () => (await window.scKit.request('string', { projectId: 4242, stringId: 101 })).data);
  if (primary.translation !== '测试译文 1') throw new Error('Same-key entries in different files were mixed');
  await choose('词条状态', '未翻译');
  await page.waitForFunction(() => document.querySelectorAll('.string-list .string-row').length === 0);
  await choose('词条状态', '所有状态');
  await choose('搜索范围', '译文');
  await query('聚合查询译文', 1);
  if (!(await rows.innerText()).includes('audit-other.strings')) throw new Error('Translation search missed the other file');
  await choose('搜索范围', '上下文');
  await query('跨文件查询上下文', 1);
  await choose('搜索范围', '键值');
  await query('KEY_060', 2);
  await choose('排序方式', '键值 A–Z');
  if (await rows.count() !== 2) throw new Error('Sorting merged duplicate keys');
  await choose('排序方式', '默认');
  await choose('搜索范围', '文本与键值');
  await query('Aggregate prefill source', 1);
  await page.getByRole('checkbox', { name: '选择词条 AGGREGATE_PREFILL', exact: true }).check();
  await page.getByRole('button', { name: '全文翻译并预填充', exact: true }).click();
  const batch = page.getByRole('dialog', { name: '全文翻译并预填充', exact: true });
  if (!await batch.getByRole('radio', { name: /本项目所有未翻译文本/ }).count()) throw new Error('Batch scope still describes a single file');
  await batch.getByRole('radio', { name: /保存到 ParaTranz/ }).check();
  await batch.getByRole('button', { name: '开始翻译并预填充' }).click();
  await batch.getByText(/已处理 1 \/ 1 条：成功 1、失败 0/).waitFor();
  await batch.getByRole('button', { name: '关闭', exact: true }).click();
  if (!(await rows.innerText()).includes('本地模拟译文：Aggregate prefill source')) throw new Error('Batch save did not update the aggregate list');
  await query('', 14);
  await choose('每页词条数量', '100 / 页');
  if (await rows.count() !== 64) throw new Error('Changing page size omitted aggregate entries');
  await choose('搜索范围', '原文');
  await query('Aggregate shared source', 2);
  await page.screenshot({ path: 'output/playwright/aggregate-mode.png', fullPage: true });
  await query('', 64);
  await choose('翻译文件', 'audit.strings');
  if (await rows.count() !== 60) throw new Error('Returning to single-file scope retained other files');
  await page.getByRole('button', { name: '打开词条 KEY_040', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="译文"]')?.value === '切换前保留的草稿');
  return 'Aggregate regression passed: shared editor, cross-file pagination/search/filter/sort, source labels, duplicate keys, drafts, exact-entry save and batch save.';
  } catch (error) {
    const state = await page.evaluate(() => ({
      search: document.querySelector('#string-search')?.value,
      file: document.querySelector('button[aria-label="翻译文件"]')?.textContent,
      rows: document.querySelectorAll('.string-list .string-row').length,
      calls: JSON.parse(document.documentElement.dataset.auditCalls).slice(-5),
      error: document.querySelector('.error-banner')?.textContent,
    }));
    await page.screenshot({ path: 'output/playwright/aggregate-failure.png', fullPage: true });
    throw new Error(error.message + ': ' + JSON.stringify(state));
  }
}'''
AGGREGATE_CHECK = AGGREGATE_CHECK.replace("127.0.0.1:3001", f"127.0.0.1:{FIXTURE_PORT}")


if __name__ == "__main__":
    (ROOT / "output" / "playwright").mkdir(parents=True, exist_ok=True)
    raise SystemExit(main([AGGREGATE_CHECK]))
