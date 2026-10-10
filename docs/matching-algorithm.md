# 翻译记忆匹配算法选型

日期：2026-10-11，Australia/Sydney。

## 采用完整字符串的归一化 Levenshtein 相似度

距离计算使用现成 npm 库 [leven](https://github.com/sindresorhus/leven)，固定版本 4.1.0。默认插入、删除、替换成本均为 1。采用标准归一化公式 `1 - distance / max(lengthA, lengthB)`；这一公式见 [RapidFuzz Levenshtein 文档](https://rapidfuzz.github.io/RapidFuzz/Usage/distance/Levenshtein.html)。没有重新编写编辑距离算法。

比较双方完整原文，不裁出最相似的短语，也不额外增加权重或分数。所有返回候选均计算分数，再执行 70% 过滤和降序排序。分数不等于语义正确率；70% 是应用的筛选阈值，不是算法保证。

百分比徽标按用户要求直接舍去小数位，显示整数。筛选和排序仍使用未经截断的原始分数。

## 候选算法比较

|算法|官方行为|本项目选择|
|---|---|---|
|完整 Levenshtein normalized similarity|完整序列的插入、删除和替换均计入距离|采用，符合完整原文建议对比|
|partial_ratio|寻找短字符串在长字符串中的最佳对齐|不用于建议评分，会使局部命中压过整体差异|
|token_set_ratio|一侧词集合为另一侧子集时可返回 100%|不采用，与用户报告的误导性 100% 问题一致|
|Jaro-Winkler|对共同前缀额外提高分数|不采用，当前型号、标题经常共享前缀|

行为依据：[RapidFuzz fuzz 文档](https://rapidfuzz.github.io/RapidFuzz/Usage/fuzz.html)、[Jaro-Winkler 官方文档](https://docs.rs/rapidfuzz/latest/rapidfuzz/distance/jaro_winkler/index.html)。这些选择是针对当前完整文本筛选需求的判断，不是库作者对翻译质量的保证。

## 用户示例的标准公式结果

以完整当前原文 `Delphi RS-10`（长度 12）比较：

|建议原文|Levenshtein 距离|归一化相似度|70% 筛选|
|---|---:|---:|---|
|Delphi|6|50%|过滤|
|-10|9|25%|过滤|
|RS|10|16.67%|过滤|

表格是根据标准距离定义与公式推导的结果，不是自动测试记录。`RSI Discovery Event` 与整段 Greetings 任务说明也采用完整字符串对比，不能用局部短语分数替代整段分数。

## 实现范围

- 在 Nuxt 前端调用现成库；Rust 服务继续读取并缓存 API 候选。
- 不对文字预处理，保留大小写、符号、空白、标签和变量。
- leven 按 JavaScript UTF-16 码元计算距离和长度，不等同于可见字素数量；中文常用字符和 ASCII 示例不受这一差别影响。
- 差异渲染仍保持同一段落中的短语展示；它不参与匹配评分或排序。
- API 最多返回 30 条候选。本地评分覆盖这些候选，不覆盖服务器未返回的整个翻译记忆库。
