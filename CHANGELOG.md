## 0.1.15（2026-10-26）

- **新增 `tabellio health [--days N] [--json]`**：零模型、只读，把 `runs/recall-audit-*.jsonl`、`runs/usage.jsonl`、`runs/feedback.jsonl` 聚合成一张使用体检表——召回次数/注入率/意图闸拦截/拒答/裁决丢弃、每次注入条数与字符（p50/p90/估算 token）、注入轮次延迟（p50/p90/慢轮/冷启动）、judge 调用与耗时、反馈信号、库规模与候选待批。缺日志时在 `warnings` 里说明哪一块没有，不拿 0 冒充。
  口径三条写进 `docs/07-usage.md §17`：延迟只算真正注入的轮次（被意图闸/拒答挡掉的轮次会稀释中位数）；token 按中文约 2 字/token 估算；窗口内新增含批量导入，不等于日常写入。
  为什么需要：之前调召回/judge 参数只能翻 JSONL 手算（0.39.5 的两个等待预算就是这么算出来的），健康度没有可复制的表，也没法做趋势。3 个用例（固定窗口聚合、空库说明、CLI `--json` 解析）。

## 0.1.14（2026-10-22）

- **空库不再报「索引还没生成」**：`status()` 的这条 warning 现在只在 `notes > 0` 时出现。索引是 `notes/` 的纯函数，没有笔记时它不存在是正常状态；新装用户刚捕获第一条候选（还没批准）时，面板/CLI 不该看起来像坏了。有笔记但没建索引仍然照报。

## 0.1.13（2026-10-22）

- CLI `search` 新增 `--no-refuse`：检索口径下覆盖率不参与准入，由调用方判断要不要答；不拒答不等于编造命中（没词面证据仍返回空）。

- **RRF 名次改为全库名次，不再用「批次内位置」**：`mergeSemanticItems` 新增 `lexRanks`（id → 全库词法名次）；`recall` 返回的每条 item 多一个 `lexRank` 字段。此前同一个笔记的 RRF 分数取决于它在**当次预算选中集合**里排第几——预算松一点紧一点，同一问题就会换答案，既不能解释也不能复现。语义补进来的条目现在也能查到词法名次（它被预算裁掉过，不代表它没有名次）。
- 新增 `test/core-semantic-batch-invariance.test.mjs`：同一库、同一查询，预算裁到只剩一条时合并顺序必须不变；不传 `lexRanks` 时用例会失败，正好钉住旧行为。
- **小语料覆盖率闸不再比调用方的闸更严**：`minCoverage: 0` 现在在 15 篇的库上也是「关掉」，不会被 0.25 的保底闸重新打开（旧行为让「关闸」在小库上失效）。
- **`refuse` 口径开关**：`recall({ refuse: false })` 进入检索口径，覆盖率不参与准入、只保留硬拒答（认不出信息词）；返回值带 `policy: 'qa' | 'search'`。默认 `refuse: true`，行为不变。依据：56 题冻结集上 0.6 → recall@5 0.861 / 拒答 0.75，0.2 → 1.000 / 0.15 —— 一个常量不可能同时服务两个目标；模拟用户库上 `refuse:false` 只多 1.2 个点命中，却让双 gold 从 66.7% 掉到 56.7%、token +44%，所以插件不切这个口径。
- **push / pull 分账**：`selectBudget` 给核心档单独一份额度（`pushMaxNotes: 2`、`pushMaxTokens: 120`，可用 `budget` 覆盖）。有检索命中时核心档不再和命中抢 `maxNotes`；没有命中时（首轮、面板）仍回落到整份预算。返回值新增 `split: { pull, push }`，被挤掉的核心档记 `reason: 'push_budget'` 并带 `limitReason`，不和「预算用尽」混在一起。实测（151 篇模拟用户库、120 题）：同一阈值下命中率不变（85.0%），平均条数 5.05 → 4.01、token 383 → 304（−21%）；56 题冻结集 `recall@5` 0.861、`match_rate` 0.786 逐位不变，注入 token 166.2 → 103.5（token_efficiency 2.579 → 5.351）。
- 默认值注释补上 2026-10-22 的复测数字：覆盖率闸是**面向问答的拒答闸**（56 题口径下 recall@5 0.861 / 拒答 1.00），自动注入/高召回场景应由调用方显式传低值（插件默认已改 0.2），不要把它当通用检索准入。默认值本身未改。

## 0.1.12

- **语义融合改为 RRF（默认）**：`mergeSemanticItems` 不再只把语义命中追加到词面结果之后，而是按 reciprocal rank fusion 合并两路名次（`rrfK` 默认 60，同分词面优先）。原因：词面命中一旦填满 `maxNotes`，追加的语义条目会被整段截掉；真库 30 题复核里，RRF 把核心默认阈值下的命中从 12/20 提到 18/20、插件的宽松档从 17/20 提到 19/20，负例注入数不变（该题集已参与过阈值讨论，数字只用于机制验证，不当独立估计）。需要旧行为时传 `fusion: 'append'`。
- 文档：`docs/11-semantic-recall.md` 规则与「非目标」同步；`test/semantic.test.mjs` 增 RRF 置换用例。

## 0.1.11

- **适配器契约变成可执行声明**：新增 `src/conformance.js`（契约名 `tabellio-adapter-contract`、版本 `0.1`、能力表），`tools/conformance.mjs --contract` 直接打印，`--json` 输出里带上契约；新增一条不变量「契约声明的能力计数与真实 MCP 工具面一致」，共 23 项。
- 明确退出码约定：`0` 全过 / `1` 有失败 / `2` 用法错误（未知参数）。
- 文档：`docs/12-conformance-and-tuning.md` 增加契约节，`docs/03-hosts-and-interfaces.md` §7.4 指向可执行声明。

# 变更记录

## 0.1.10（2026-10-21）

- GitHub 仓库由 `yffo/memory-service` 更名为 `yffo/tabellio`（GitHub 自动重定向旧地址）；`package.json` 的 `repository` / `homepage` / `bugs`、`server.json` 与 `docs/07-usage.md` 的仓库地址同步更新。
- 仅元数据与文档，召回/写入行为无变化。

## 0.1.9（2026-10-21）

把「适配器契约」和「阈值调参」做成可执行的两条命令，而不是只写在文档里。

- 新增 `tools/conformance.mjs`：22 项一致性检查（写入闸/生命周期/候选漏斗/归档隔离/反馈只重排/回执校验/CLI 与 MCP 同一库），只碰临时库、不联网；CI 增加 `npm run check:conformance`。适配器契约文字版见 `docs/03-hosts-and-interfaces.md` §7。
- 新增 `src/core/tuning.js` + `tools/tune-recall.mjs`：在冻结题集上扫阈值网格，只接受「命中不降、误注入不增、至少一项更好」的候选；退出码 3 表示有建议点，需要人批准后手动改配置，不做自动写入。
- 新增 `src/core/secrets.js`：写入闸增加凭据值检测（sk-/ghp_/AKIA/AIza/私钥/Bearer 与「密码…是 <真值>」形态），策略句（「密钥由 KMS 管理」「统一放 1Password」）放行。
- 文档 `docs/12-conformance-and-tuning.md`，含实测基线（`bench/core-30-v1`：hit 31/36、false-inject 5/20，无可白拿的提升）与「合成集不能外推」的声明。
- 发布包新增 `tools/`（`npm pack` 会带上这两条命令）。

只记**看得见的行为变化**与**改了的口径**，不记「测试通过数」这类会腐烂的状态
（要读状态就去跑 `node --test` 与 `node bench/run-eval.mjs`）。

## 0.1.8（2026-10-21）

- 导出 `rankSemantic(index, queryVector, {top, minSimilarity})`：宿主若自己维护内存索引（如 DSH 插件），可与 `indexSemantic` 复用同一套余弦排序，不必在适配层复制实现。
- 0.1.7 已含 `indexSemantic` / `semanticRecall` / `mergeSemanticItems`（见上一条）；本次只是补齐排序导出，行为不变。

## 0.1.7（2026-10-21）

把语义召回收进核心：索引格式、可索引条件、相似度排序、与词面结果的合并都由核心提供；embedding 服务由宿主注入 `embed(texts) -> vectors`，核心不联网、不保存 endpoint/Key。

- 新增 `indexSemantic(ctx, {embed, model, batch, maxChars, onProgress})`：增量建/刷新 `runs/semantic-index.json`，只对新增或正文变化的笔记调用 `embed`；返回 `{ok,size,changed,removed,model,index}`。
- 新增 `semanticRecall(ctx, query, {embed, model, top, minSimilarity})`：读索引、embed 查询、余弦 top-k，返回 `{ok,hits,size}`。
- 新增 `mergeSemanticItems(result, {hits, readNote, maxNotes, allowedTrusts})`：纯函数；保留词面顺序、只追加未命中的条目，并在合并时再验 archived/draft/superseded/valid_to 与 trust。
- 新增 `src/core/semantic.js`（`cosine` / `planSemanticIndex` / `rankSemantic` / `mergeSemanticItems` / `indexableEntry`）与 `src/store/semantic-index.js`（模型隔离、坏文件降级为空索引）；文档 `docs/11-semantic-recall.md`。
- 行为不变：`recallQuery` 不自动使用语义；宿主显式调用并在失败时回退词面结果。
- 测试：`test/semantic.test.mjs` 4 条（增量计划、生命周期排除、排序阈值、合并过滤、落盘与模型失效、假 embedder round-trip）。

## 0.1.6（2026-10-21）

本次把「用错了会改」和「久了会淡」收进核心：反馈事件与遗忘衰减是**排序增强**，默认不改变任何召回结果，宿主显式开启才生效。核心只提供事件、聚合与纯函数权重，不判定归因、不删除笔记。

### 反馈排序：`recordFeedback` / `applyFeedback`

- **修的问题**：召回的笔记被用户明确纠正后，下一次仍然按原顺序出现；插件里各自记的反馈随宿主更换而丢失。旧插件的 `panel-feedback.jsonl` / `outcome.jsonl` 也只有那个插件读得到。
- **做法**：新增 `<store>/runs/feedback.jsonl`（`signal` ∈ `useful`/`wrong`/`stale`/`corrected`，1–6 个 `noteIds`，可带 `query`/`source`/`at`），`recordFeedback` 写入、`readFeedback` 读取（自动合并两个旧插件文件，去重排序）、`feedbackSummary` 给窗口统计。`recallQuery` 新增 `applyFeedback: true` 时按 `1 + 0.03*min(useful,3) - 0.12*min(wrong+stale,4) - 0.08*min(corrected,3)` 重排。
- **行为**：只影响顺序——不增、不删、不越过 `minRelevance`/`minCoverage`/`minScore` 与拒答；拒绝的结果不会被反馈救回来。CLI 新增 `tabellio feedback record|list|summary`；MCP `recall` 新增 `apply_feedback` 输入（工具面仍是只读 5 / 可写 7）。
- **边界**：核心不猜测「这句话是不是在纠错」，归因由宿主完成；90 天窗口外的反馈不再压排序。

### 遗忘衰减：`decay`

- **修的问题**：一条三年前的项目笔记和上周的规则按同一把尺子排序，旧信息沉不下去；但直接删或归档又不可逆。
- **做法**：`recallQuery` 新增 `decay: { halfLifeDays, floor }`（也接受 `decayDays`），按 `clamp(0.5 ** (ageDays / halfLife), floor, 1)` 乘进排序分；`valid_from` 缺失时用创建时间，半衰期默认 180 天、floor 默认 0.6。`trust: user_stated`、`evergreen: true` 或 `tags` 含 `evergreen` 的笔记不衰减。
- **行为**：只压排序，不归档、不删除；默认关闭，可单独关闭反馈或衰减。
- **边界**：不做「自动衰减开关」「自动遗忘」；真要下线一条记忆仍走 `consolidate --archive` 或宿主动作。设计说明见 `docs/10-feedback-and-decay.md`。

## 0.1.5（2026-10-19）

本次发布把只读体检 `doctor` 与 `setup --json` 泄露修复发出去：前者让用户一条命令看明白「哪一环没接上」，后者避免把宿主配置里其他 MCP server 的 env/token 打到 stdout。

### 体检：`tabellio doctor` 一份只读报告回答「哪一环没接上」

- **修的问题**：安装链路已经有 `setup` / `setup --verify` / `hook` / `schedule`，但用户出问题时得分别跑 `status`、`setup`、`hook install`（dry-run）、`schedule status` 才能拼出全貌；「配置写对了」和「宿主真能连上」仍然容易混。没有体检入口，支持成本会落回到读文档。
- **做法**：新增 `src/doctor.js` 与 `tabellio doctor [--verify] [--json]`。它只读地聚合：库（`status` 的解析失败/索引是否陈旧/超长/待批准候选与提案）、宿主（`planSetup` 的检测与冲突/损坏状态，不输出配置正文）、Claude 钩子（SessionEnd/SessionStart/`--auto-consolidate` 是否与当前 bin/store 匹配）、macOS 定时任务（`scheduleStatus` 的已安装/已加载）。`--verify` 才调用宿主 CLI，沿用 `hostverify` 的六级分级。
- **行为**：建议分 `error` / `warn` / `info`；解析失败、宿主配置冲突/损坏、配置里的 Node/MCP 入口绝对路径不存在、钩子或 plist 读不了退 1，待批准候选/索引陈旧/未装钩子只是提醒退 0。空库跑完不建目录；`--json` 的 `hosts.items` 不含 `preview`，不会把别的 MCP server 的 env/token 再打印出来。`doctor` 不自动修，`setup` / `hook install` / `schedule install` 仍要用户确认。
- **边界**：不检查 Cursor 的 GUI 连接，不把配置文件存在说成已连接；不做网络探测、不启动 MCP server；`launchctl` 不可用时只说「无法确认」，不猜已加载。证据见 `test/doctor.test.mjs`（空库、候选、宿主冲突、失效入口、钩子、`--verify`、CLI 退出码）。

### 安全：`setup --json` 不再回显宿主配置全文

- **修的问题**：`setup` 的计划对象把整份宿主配置放在 `preview` 里，而 `--json` 直接序列化计划。只要 `~/.claude.json` / `~/.cursor/mcp.json` / `~/.codex/config.toml` 里有别的 MCP server 的环境变量或 token，`tabellio setup --json` 就会把它们打印到 stdout（日志、录屏、issue 里都会带走）。dry-run 和 `--write` 都一样。
- **做法**：`src/setup.js` 把 `preview` 改成**不可枚举**属性，只有 `applySetup` 在进程内能读到；`JSON.stringify` / CLI 输出不再包含它。`applySetup` 增加 `missing_preview` 防御：计划若被序列化后再应用，不会把 `undefined` 写成文件。`--json` 的计划形状里不再有 `preview`。
- **边界**：这不是加密，只是不回显；宿主配置本身的读写权限仍由用户与宿主控制。`setup --write` 仍会原样保留配置文件里的其他字段。

## 0.1.4（2026-10-19）

本次发布把 0.1.3 之后的 M2 能力一次发出去：内容类巩固执行层、自动发现提案、macOS launchd 定时自动发现。

### 定时：macOS launchd 定期自动发现，只产提案

- **修的问题**：自动发现已经能安全地产提案，但触发仍要人记得敲 `consolidate --auto`，或依赖 Claude Code 的 SessionEnd。用户不装钩子、或不用 Claude 时，「定期看一眼有没有重复」这件事还是没人做；加常驻 daemon 又会引入端口、保活与权限问题。
- **做法**：新增 `src/schedule.js` 与 `tabellio schedule install|uninstall|status`。只支持 macOS launchd：在 `~/Library/LaunchAgents/io.github.yffo.tabellio.sweep.plist` 写 LaunchAgent，`StartInterval` 默认 21600 秒（6 小时，可 `--interval 15m..7d`），`RunAtLoad=false`，命令固定为 `<node> <bin/memory> consolidate --auto --write --store <store> --json`。默认 dry-run，`--write` 才建日志目录（0700）、原子写 plist（0644）、`bootout` 后 `bootstrap gui/<uid>`；update 先备份，冲突默认拒绝、`--force` 才替换。`status` 只读，解析 plist 并用 `launchctl print` 区分「已安装」与「已加载」。
- **行为**：定时任务到点跑一次就退出，只写 `runs/proposals/` 的 pending 提案；不合并、不批准、不写正式笔记、不重建索引。加载失败时 plist 保留、命令退 1 并说明「已写未加载」；卸载只 `bootout` 并删除自己的 label，不碰别的 LaunchAgent。Linux/Windows 返回 `unsupported_platform`，不伪造调度器；Linux 可先用 cron 跑同一条命令。
- **边界**：不是常驻进程，没有「错过的每一次都补跑」；`StartInterval` 是间隔不是日历，睡眠/关机期间不运行。Node 被 nvm 挪走后任务会失败，`status` 会显示未加载。它仍只产提案，**不会自动批准或自动执行合并**；批准入口始终是 `inbox`。
- **证据**：新增 `test/schedule.test.mjs`（计划/应用/冲突/加载失败/卸载/status/XML 转义）、`test/cli-schedule.test.mjs`（dry-run、真实文件、退出码、非 macOS），以及 gated 的 `test/schedule-launchd-e2e.test.mjs`（`TABELLIO_SCHEDULE_E2E=1` 且 macOS 才跑，临时 HOME/store，plan→apply→status 断言 `launchctl` 已加载，`finally` 卸载）。本机实测通过且无残留 plist。

### 巩固：自动发现近似重复，只产 inbox 提案

- **修的问题**：内容类执行层已经能安全地合并，但源 id 仍要人自己去读库、找重复、抄 id；「每次都要用户提醒沉淀」的问题只解决了一半——发现了也没有入口，普通人不会主动做近似重复排查。自动执行又违背「不静默写正式库」的边界。
- **做法**：新增 `src/core/auto-consolidate.js` 与 `src/store/proposals.js`。`consolidate --auto` 扫描 active、未过期、未被取代、正文至少 40 字的笔记，按 `scope` / `kind` / `trust` 分组，用 8-gram 字符 n-gram 的 Jaccard 相似度找近似重复（默认阈值 0.62，每组最多 4 条，每次最多 20 组）。发现结果只写成 `runs/proposals/<proposal_id>.json` 的 pending 提案，不写笔记、不建索引、不进检索面。`--write` 才落提案，默认 dry-run；重复扫描同一组会复用已有提案，不重复创建。
- **行为**：`inbox` 同时列候选与自动巩固提案；`--accept prop_...` 才调用内容类执行层合并（写目标、关闭源、写内容回执，可 `--undo`），`--reject` 把提案移到 `runs/proposals/rejected/`。批准前逐源比对提案里的正文 hash，源被改过就整单 `proposal_stale`，不写任何文件。因为人已经逐条看过固定清单，批准路径把 5% 保险丝显式放开为 `maxChangeRatio:1`；执行层自己的 hash、字段、目标存在检查一条不少。两类 id 可在同一次 `inbox` 调用里混批。
- **行为（钩子）**：`hook install --host claude --auto-consolidate --write` 让 SessionEnd 在抓候选之后顺带跑一次 sweep（只写提案），并隐含安装 SessionStart 提示；关闭开关只把 SessionEnd 改回原命令，不删除已装的 SessionStart，避免已有提案没人提示。sweep 失败不阻塞会话结束，命令仍退 0。
- **边界**：只做 merge 近似重复，不做自动 summarize / promote / 误报判定，也不自动执行；提案未批准前不进检索面。这条自动发现本身没有定时触发——要么显式跑 `consolidate --auto`，要么装 Claude Code 钩子；macOS 定时触发见上面的 `schedule`，仍然只产提案。相似度是字面 8-gram，不是语义模型；跨语言、改写较大的重复会漏。提案里的 source hash 只证明「批准时源没变」，不是签名。

### 巩固：内容类 merge / summarize / promote 可 `--apply`，回执与撤销成对

- **修的问题**：内容类操作此前只到提案层：人看完草稿还得手动复制成新 note、手动给源写 `valid_to`，或者干脆放弃。架构里「没有 receipt 的写入是 bug」「内容类必须有撤销」两条都空着；`docs/06` 的 §4.2 也因此把执行层标成未实现。
- **做法**：新增 `src/core/content-receipt.js` 与 `src/api.js` 的 `applyContentConsolidation` / `undoContentConsolidation`。默认仍是 dry-run；`--apply` 后按模式执行：merge / summarize 写一条 `active` 目标，再把源写成 `valid_to` + `superseded_by`（**正文不改**）；promote 只写 `notes/candidates/` 的 `draft`，**不关闭源**，批准仍走 `inbox`。内容类 run 写 `runs/<run>.plan.json`、`runs/<run>.json`（schema `tabellio.consolidate.content/1`，只存目标与源的 hash、不存正文）与 `.undo.json`。`--undo` 先预检目标全文 hash 和每个源的正文 hash/字段，任一冲突整单拒绝；通过后先恢复源字段、再删除目标。
- **行为**：`consolidate --merge/--summarize/--promote` 现在接受 `--apply` 与 `--max-change-ratio`；默认 5% 保险丝对内容类按「动到多少条现有笔记」算（merge = 源数，summarize = 1，promote = 0），不按写文件次数算，否则两条库上 merge 会被算成 150%。dry-run 的 `apply_supported` 变为 `true`，并带 `run_id` 与「加 --apply 执行」的 `next_action`；apply 成功返回目标、源、回执路径；中止原因包括 `change_ratio_exceeded`、`target_exists`、`source_changed`、写失败与 `receipt_write_failed`（后两者会回滚）。`--undo` 对内容类 run 返回 `target_deleted:true`。
- **边界**：仍不接受 `--scope` / `--kinds`，不能和 `--archive` / `--undo` / 其他内容模式同用；执行层本身不接受自动选源；自动发现见上一节，只产合并提案、仍需人在 `inbox` 批准。没有 LLM 摘要（merge 是去重拼接、summarize 是抽取式首句、promote 是脚手架）。回执 hash 是防误改，不是签名；promote 的候选被 `inbox --accept` 批准后，内容回执指向的候选 id 已不在候选目录，再 undo 会按 `target_missing` 拒绝。写入回执、replay、`diff.jsonl`、后台定时自动巩固仍未做。

## 0.1.3（2026-10-18）

0.1.2 发布后 smoke test 发现包内自报版本仍是 0.1.1；0.1.3 只修这个问题，功能面与 0.1.2 相同。

### 版本：CLI 与 MCP 自报版本从 `package.json` 读取

- **修的问题**：0.1.2 发布前只抬了 `package.json` 与 `server.json`，`bin/memory` 的 `VERSION` 与 `src/mcp/protocol.js` 的 `SERVER_VERSION` 仍硬编码 `0.1.1`。从官方 registry 装 0.1.2 后，`tabellio --version` 和 MCP `serverInfo.version` 都还报 0.1.1；包内容本身是 0.1.2，但包内自报版本错了。
- **做法**：新增 `src/version.js`，从 `package.json` 读 `version` 作为唯一真相源；CLI 与 MCP 都从它取版本。新增 `test/version.test.mjs`，断言 CLI、MCP `initialize` 与 `package.json` 一致，并真实 spawn `tabellio --version`。
- **行为**：以后抬版本只改 `package.json`（`server.json` 的 registry 元数据仍要同步），CLI 与 MCP 不会再漂。本地 `npm pack` 后装 tarball 验证：`--version` 与 MCP `serverInfo.version` 都是 0.1.3。
- **边界**：npm 上的 0.1.2 不可覆盖，仍会自报 0.1.1；要正确版本号请用 0.1.3。功能与 0.1.2 没有区别。

## 0.1.2（2026-10-18）

本次发布把 M1 之后的 M2 可用面一次发出去：`setup`、`capture` / `inbox`、MCP `capture` / `recall`、`setup --verify`、Claude Code 会话钩子。

### MCP：`recall` 一次返回正文，预算感知且可拒答

- **修的问题**：MCP 的读接口只有 `search` + `read`：`search` 只给指针，agent 得再逐条 `read` 才能拿到内容。很多宿主不会自动链式调用，模型看到一串 id 也不会自己补第二步，结果「有记忆」和「用上记忆」之间卡着两次工具调用。更根本的是，CLI 的核心读原语 `recall`（预算感知、拒答是一等结果）一直没暴露给宿主。
- **做法**：`src/mcp/protocol.js` 新增只读工具 `recall`（`RECALL_INPUT`：`query` 必填，可选 `budget_tokens` / `kinds` / `trusts`），底层复用 `recallQuery`。默认预算 500 token；文本结果给每条 `id` / `kind` / `trust` 和正文，`structuredContent` 只给元数据（`items` 里**不重复正文**，避免宿主把同一段内容算两遍 token）。工具面变成默认 5 条只读（`recall` / `search` / `read` / `list` / `status`），`--allow-write` 后 7 条，仍在 5±2 内。
- **行为**：命中时一次调用就能拿到预算内的正文；证据不足时 `refused:true`、`items:[]`，`isError:false`——拒答是正常判定，不是工具故障。空 / 缺 `query` 才是 `isError:true` 的 `invalid_params`。`recall` 始终只读，不受 `--allow-write` 影响；`initialize` / `server/discover` 的 instructions 也改成优先引导 `recall`，需要指针或逐条核对时再用 `search` + `read`。
- **边界**：没有把 `explain` / `verify` / 回执 / `as_of` 暴露给 MCP；`structuredContent` 故意不含正文，程序化调用方需要正文时仍应 `read`；没有自动巩固、后台任务或从对话自动抽取。
### 钩子：Claude Code 会话开始时提示待批准候选（默认不装）

- **修的问题**：SessionEnd 钩子会把候选放进 `notes/candidates/`，但用户不主动跑 `tabellio inbox` 就永远看不到；自动捕获与人工批准之间缺一个通知环，等于仍要用户自己想起去查。
- **做法**：`hook install --host claude --session-start --write` 在 `hooks.SessionStart` 里再加一个 tabellio 钩子，指向内部命令 `tabellio hook claude-session-start`。默认 install 仍只装 SessionEnd，不改变旧行为；`uninstall` 同时清两个事件里的 tabellio 钩子，但保留用户自己的 SessionStart 钩子。
- **行为**：内部命令只读候选数；候选数 > 0 时向 stdout 输出 Claude 的 hook 协议 JSON（`hookSpecificOutput.hookEventName=SessionStart` + `additionalContext`，提示运行 `tabellio inbox`），= 0 时静默。**不写库、不批准、不删除**，批准权仍在 CLI `inbox`。事件/读取/store 错误一律退 0，不阻塞会话开始。
- **验证**：单元与 CLI 测试覆盖双事件安装/卸载、保留他人 SessionStart 钩子、协议输出、无候选静默、坏事件与坏 store 退 0；gated `test/hook-claude-e2e.test.mjs` 用并排 marker 钩子证明真实 Claude Code 2.1.142 确实触发 SessionStart，且提示没有写库。不伪造 additionalContext 已被模型看到。
- **边界**：只支持 Claude Code；提示只在候选数 > 0 时出现，不是每次会话都打扰；没有定时/后台触发、没有自动批准、没有自动巩固。

### 钩子：Claude Code 会话结束时自动生成候选（默认不装）

- **修的问题**：`setup` 解决了安装摩擦，`capture` 给了 agent 主动提议的入口，但两者都要求「有人先想起要记」。真实用户不会每轮都敲 `remember`，也不会替 agent 调用 `capture`；而完全自动写正式库又违背「不静默写」的边界。
- **做法**：新增 `src/hooks.js` 与 `tabellio hook install` / `uninstall`，只支持 Claude Code。它合并 `~/.claude/settings.json` 的 `hooks.SessionEnd`，用 exec form（`command` + `args`）指向内部命令 `tabellio hook claude-session-end`，`timeout:15` 秒；默认 dry-run，`--write` 才落盘，写前备份为 `settings.json.tabellio-backup-<时间戳>`，JSON 原子写，新文件 mode `0600`，保留用户其他钩子、`env` 与 settings 其他字段。已有指向别的 store 的 tabellio 钩子先报冲突，`--force` 才替换；坏 JSON 整份不写。
- **行为**：内部命令从 `SessionEnd` 事件拿到 `transcript_path`，只读当前会话、只取真实用户发言，跳过 sidechain / meta / compact summary / tool_result / system-reminder；按显式线索（「记住」「以后都」「我偏好」「我们决定」「默认用」「改用」等中英文）切句，排除问句/假设句与命中密钥模式的整句，每会话最多 3 条。**不调用模型、不联网、不摘要、不自动合并**，只写 `notes/candidates/`，不重建主索引、不进默认检索面；`written_by:capture:hook`，`source:claude:session-end:<session_id>`。批准仍走 CLI `tabellio inbox` 的同一条写入闸门。内部命令的任何事件/读取/store 错误都退 0（不阻塞宿主退出）；安装/卸载冲突、坏配置、未知宿主退 1，参数缺值退 2。
- **验证**：真实 Claude Code 2.1.142 的 `-p` 会话已实测 `SessionEnd` 触发、exec form 被接受、候选落盘且主库 `notes=0`；即使未登录导致模型 API 失败，钩子仍触发。可复核的 gated 测试是 `test/hook-claude-e2e.test.mjs`（`TABELLIO_HOOK_E2E=1` 才跑）；单元与 CLI 测试在 `test/hooks.test.mjs` / `test/cli-hooks.test.mjs`。
- **边界**：只支持 Claude Code——Cursor 没有等价的无头钩子契约，Codex 没有会话结束钩子，不伪造。没有定时/后台触发，没有自动巩固，也不承诺「记住一切」；线索规则是尽力而为，可能漏也可能误报，候选箱仍是人工闸门；密钥过滤是尽力而为，不是 DLP。安装会改用户的 `~/.claude/settings.json`，所以必须显式加 `--write`。

### 宿主：`setup --verify` 用宿主自己的命令验证连接

- **修的问题**：`setup` 只证明「配置文件写对了」，用户在 Claude Code / Codex 里看到的连接状态它不知道；把「写对」说成「连上」是假验证。
- **做法**：新增 `src/hostverify.js` 与 `tabellio setup --verify`。验证不读 JSON 自证，而是调用宿主自己的 CLI：Claude Code 跑 `claude mcp list`，Codex 跑 `codex mcp list`，Cursor 没有无头命令。结果分级为 `connected` / `configured` / `unverified` / `unavailable` / `failed` / `missing`。`--verify` 可单独用，也可与 `--write` 连用；验证时用配置文件的临时副本，不碰真实配置。
- **行为**：Claude Code 只有报 `✓ Connected` 才是 `connected`；Codex 报 `enabled` 只算 `configured`（`mcp list` 不 spawn server，不能冒充连接检查）；Cursor 固定 `unverified`；宿主 CLI 找不到是 `unavailable`，不算配置失败。只有 `failed` / `missing` 让退出码变 1，且失败不回滚已写配置。
- **边界**：Cursor 仍需在 GUI 里确认；Codex 的 `configured` 不是「已连接」；`--verify` 不修配置，也不替代用户在宿主里实际发一次请求。真实宿主 E2E 在 `test/host-e2e.test.mjs`，默认跳过，`TABELLIO_HOST_E2E=1` 才跑。

M2 的既定内容是巩固进程与生命周期。开工时先把 M1 留下的两个洞堵了 ——
它们都属于「判据说达标了、但真实库上不成立」的那一类，不修掉的话 M2 的判据 3
（不腐烂、不害人）是在坏地基上盖楼。

### MCP：`capture` 让 agent 主动提议，批准仍留在 CLI

- **修的问题**：MCP 工具面此前只有 `search` / `read` / `list` / `status`，`--allow-write` 只多一个 `remember`。Agent 在会话里看到「这条以后用得上」时，要么直接 `remember` 写进正式库（越过候选与人工批准），要么什么也做不了；CLI 的 `capture` 它够不着。
- **做法**：`src/mcp/protocol.js` 新增 `capture` 工具（`CAPTURE_INPUT`：`content` 必填，可选 `source` / `kind` / `tags` / `id`；不暴露 `trust` / `scope`）。与 `remember` 一样只在 `--allow-write` 时挂载，工具面变成 6 条（仍在 5±2 内）。底层复用 `addCandidate`，`written_by` 记为 `capture:mcp`，不是 CLI。
- **行为**：成功只落 `notes/candidates/<id>.md`（`status:draft` / `trust:system_derived`），不重建主索引、不进检索面；返回候选 id、标题、字数、来源与路径，并提示人运行 `tabellio inbox`。重复 / 超长 / id 已存在是**正常判定**（`ok:false`、`isError:false`），只有非法输入或落盘失败才标 `isError:true`——宿主会把 `isError` 当失败并自动重试，不能把「这条已经有了」伪装成故障。
- **边界**：没有把批准权交给 agent，也没有新增 `inbox --accept` 的 MCP 写工具；`capture` 本身仍只是显式提交，不会从对话自动抽取（自动候选只在 Claude `SessionEnd` 钩子启用后发生）。仍没有自动巩固或后台任务。候选正文上限仍是 8KB，批准时仍走 `remember` 的同一条闸门。

### 上手：`setup` 一条命令写宿主配置；`capture` / `inbox` 让候选可批准

- **修的问题**：装完 `tabellio` 之后，用户还得自己翻三个宿主的文档、手写 MCP 配置；记忆只能靠人先想起「这件事该记」，再主动 `remember`。前者是安装摩擦，后者是「产品该负责判断，却把判断推给用户」——而完全自动写又违背「不静默写」的边界。
- **做法**：新增 `src/setup.js`（纯计划 `planSetup` + 落盘 `applySetup`）与 `tabellio setup`，给 Claude Code（`~/.claude.json`）、Cursor（`~/.cursor/mcp.json`）、Codex CLI（`~/.codex/config.toml`）写 `tabellio` 的 MCP server；新增候选 API `addCandidate` / `listCandidates` / `reviewCandidates` 与 CLI `capture` / `inbox`。候选落在 `notes/candidates/`，**不参与默认检索**；`inbox --accept` 走与 `remember` 同一条写入闸门（去重/长度/信任分级一条不少），批准后才进 `notes/` 与主索引。
- **行为**：`setup` 默认 dry-run，`--write` 才落盘；`all` 只处理已安装的宿主，显式 `--host` 可创建；写前备份为 `<文件>.tabellio-backup-<时间戳>`，JSON 原子写，Codex 只替换 `[mcp_servers.tabellio]` 段、保留其他段与注释。已有不同的 `tabellio` 配置默认 `conflict` 整单不写，`--force` 才替换；坏 JSON/TOML 整单拒绝。默认给 MCP 加 `--allow-write`，`--read-only` 可去掉；`command` 默认当前 node，`mcpBin` 用绝对路径，不依赖 PATH。`capture` 写入 `status:draft` / `trust:system_derived` / `provenance.written_by:capture:cli`，默认不重建主索引；`inbox` 无参数只列候选，`--accept` / `--reject` 可重复或逗号分隔，批准后候选移到 `notes/candidates/decided/`、拒绝移到 `rejected/` 留审计；`status` 的候选数不再恒为 0，并提示「N 条候选待处理」。
- **边界**：只自动写 Claude/Cursor/Codex 三家；DSH 的 `~/.dsh/cordis.patch.yml` 是 YAML loader patch，零依赖改写的风险高于收益，只给文档片段、不做自动写。**这一版没有会话结束钩子或自动抽取**：`capture` 是显式原语，宿主/脚本要自己调用；后续 M2 补了 Claude Code 的 `SessionEnd` 钩子（见顶部），其他宿主仍未做。也没有自动巩固、后台任务、定时清理；`inbox` 第一批只收候选，内容类巩固提案仍走 `consolidate --merge/--summarize/--promote`，不混进来冒充「可批准」。候选正文仍受单条 8KB 上限，批准时再受 400 字/200 token 闸门约束；候选归档是移动文件，不是签名，能写库的人仍可改。

### 索引：空库重建不再把根节点当叶子

- **修的问题**：空库执行 `status --rebuild-index` 会崩在 `buildIndexPlan()` —— 树里没有叶子时，根节点被当成叶子，`ids.length` 抛异常。新建库第一次建索引就会踩到。
- **做法**：`src/store/index-tree.js` 在 `tree.total === 0` 时直接给空叶子列表，不再从根节点推。
- **行为**：空库能正常写出路由层（「全库 0 条 / 0 组」），`status --rebuild-index` 退 0；新增一条回归测试。
- **边界**：只修空库这一种退化；非空库的分层/分页规则不变。

### 检索：`aliases` 不再被静默丢弃（仍只做身份核对）

- **修的问题**：笔记 frontmatter 里的 `aliases` 一直在 schema 之外，`validateFrontmatter()` 直接把它丢掉，`toDocs()` 也没把它传给索引。于是 `docs/06` 声称 aliases 参与共现/身份核对，实际是死字段——这也是 c04 卡在 `cooccurrence_required_pair_missing` 的原因之一。
- **做法**：`src/store/note.js` 把 `aliases` 收进 schema（支持 `[a, b]` 与 `a, b` 两种写法，空值不落盘），`NOTE_KEY_ORDER` 固定字段顺序，`src/core/recall.js` 的 `toDocs()` 透传 `aliases`。**只进 `identityTerms`，不进 postings、不改 BM25 打分**；没有把别名当同义词扩展，查询词项权重不变。
- **效果**：c04 的 gold 候选共现已通过（其自身原因从 `cooccurrence_required_pair_missing` 变成 `below_min_coverage`），但 coverage 仍 **0.595 < 0.6**；整次查询仍拒答（reason 仍报 `cooccurrence_required_pair_missing`，由其他候选决定）。c03 0.587、c07 0.415、k05 0.521，也仍不过覆盖率闸。零模型 `recall@5` 保持 **0.861（31/36）**，5 道空答案一个没救回。把 `min-coverage` 降到 0.55 能多救 2 道，但 zero-model `correct_refusal` 0.75→0.55、false answers 5→9，不采用。
- **边界**：aliases 只影响共现核对，不是检索同义词；不解决「自然改述导致覆盖率不足」。顺带修复 `bench/run-eval.mjs` 的 `parseArgs`：`--cli-args` 的值以 `--` 开头时不再被当成顶层参数校验。

### 评测：回答层注入计量修正，判据 2 成立；top-2 更省

- **修的问题**：`bench/run-eval.mjs` 把 CLI `search` 返回的 **top-8 候选预算**当成了实际注入成本，而 `buildContext` 只注入 top-5。旧报告 `2026-10-17-answer-56.md` 的 266 token / 1.611 因此是错误分母；同一批回答的实际注入是 166.2。
- **做法**：`search` 增加 `--costs` 诊断（默认 JSON 契约不变），把每条命中的 `cost` 透出；`run-eval` 增加 `--inject-k`（与 recall 的 `--k` 解耦）与 `countInjectedTokens()`，按实际注入的 chunk 逐条求和。对当前 56 题（36 可答 + 20 拒答）用 deepseek-flash 跑 3 轮：top-5 报告 `bench/core-30-v1/runs/2026-10-18-answer-56-k5.md`，top-2 报告 `bench/core-30-v1/runs/2026-10-18-answer-56-k2.md`。
- **top-5 实测**：acc none **0.357** / new **0.786** / oracle **0.893**（三轮 0.875/0.911/0.893）；`negative_transfer = −0.429`；`oracle_gap = 0.107`；实际注入 **166.2 token/题**，`answer_token_efficiency = 2.579`（≥ 2.0，**判据 2 成立**）；`trap_fall_rate = 0/4`；三臂 444 次调用约 **$0.0205**。
- **top-2 裁剪**：new acc **0.792**（三轮 0.786/0.804/0.786）/ 注入 **70.3** / 效率 **6.182**，oracle 0.869，`oracle_gap = 0.077`，总成本约 **$0.0183**。注入少 57.7%，准确率只差 0.6 点（约 0.3 题），是更省的推荐运行点；默认值未改（`--inject-k` 不传仍等于 `--k`），要省成本需显式传。
- **旧数字的位置**：52 题、补别名前的 0.744 / 1.408 只作历史下界；2026-10-17 的 56 题 0.786 / 1.611 因上述计量错误作废，旧报告顶部已加口径警告。12 道错题（5 道检索没给 + 7 道 oracle 也错，k06 是题集 bug）仍解释 `oracle_gap`，但不再是判据 2 的算术障碍。
- **边界**：3 轮仍是同一天同一模型，不能当跨模型稳定性；陷阱分母只有 4，`trap_fall_rate=0` 不能写「判据 3 成立」；20% 人工抽检与 κ 仍未做；回答层不进 CI。

### 记忆回执：`recall` 现在能自证

- **修的问题**：`recall` 一直返回分数拆解、`budget.dropped` 与 `why`，但那次判断没有被留下来；事后问「为什么给了它 / 为什么没给」只能重跑，而库可能已经变了。`explain` / `verify` 在架构里一直是目标接口，实际没有。
- **做法**：新增 `src/core/receipt.js`（canonical JSON + hash + build/verify/explain）与 `src/store/receipt.js`（原子写 `runs/`、拒绝覆盖、读 id 或路径）。`recall --receipt` 只附带回执，`--save-receipt` 落盘；新增 `explain`（`--query` 现场解释 / `--receipt` 读回执）与 `verify`（回执 hash + 笔记正文 hash + 元数据）。回执不含正文，每一条只记 `noteSha256`；整张回执的 `hash` 覆盖全部字段。
- **行为**：`verify` 分 `verified` / `drifted`（库变了）/ `tampered`（回执被改）/ `invalid|unreadable`；只有 `verified` 退 0。`explain` 的未纳入原因固定为 `below_min_relevance` / `below_min_score` / `below_min_coverage` / `cooccurrence_missing` / `unknown`，不重跑检索、不调模型。
- **边界**：hash 是**防误改**，不是签名——能写文件的人可以改完重算 hash；要防伪造得等签名/密钥。`recall` 回执是**读取回执**，不含巩固操作（巩固回执与 `undo` 见下一节）；回执含查询原文与库的绝对路径，贴出去前先看一眼。

### 巩固：第一刀只动元数据，且可撤销

- **修的问题**：架构里的 `consolidate` + receipt + undo 一直是目标接口；库里 `superseded_by` 有值，但旧记录的 `valid_to` 没人写，检索仍把两条都当有效，历史 `as_of` 也没有关闭点。
- **做法**：新增 `src/core/consolidate.js`（纯决策 `planConsolidation`、回执 build/hash/integrity、5% 熔断）、`src/store/consolidate.js`（`runs/<run>.plan.json` / `.json` / `.undo.json` 原子写、拒绝覆盖）、`src/api.js` 的 `consolidate` / `undoConsolidation`、`bin/memory consolidate`。当时只实现 `invalidate`：B 显式 `supersedes` A，且 A 仍 `active`、无 `valid_to` / `superseded_by` 时，写 A 的 `valid_to` + `superseded_by`；正文逐字节不动。`merge` / `summarize` / `promote` / `archive` 当时未实现（archive 见下一节）。
- **行为**：默认 dry-run，不落盘、不改库；`--apply` 先写计划再改，**回执写不进去就回滚**；`--undo` 先全量预检，任何一条冲突就整单拒绝，二次撤销是 `already_undone`。保险丝 `allowed = max(1, floor(扫描 × 0.05))`，超限整单中止、一条不动。CLI 退出码：成功 0，`aborted` / `conflict` / `tampered` / `partial` 1，用法错 2。
- **边界**：巩固回执不含正文，只存前后元数据、正文 sha256 与整份文件 hash；hash 仍是**防误改**不是签名。undo 只恢复元数据；apply 之后正文被人改过会整单 `conflict`。replay、`diff.jsonl`、写入回执、后台自动巩固未做。

### 巩固：`archive` 只改状态，不伪造有效期

- **修的问题**：此前只有 `invalidate` 能关闭一条记录，但它要求先有一个「胜出方」；想表达「这条不再进默认检索面，但不是被谁取代」没有操作。若让 archive 顺手写 `valid_to`，等于伪造一个不存在的关闭原因，`as_of` 也会把「归档」误读成「失效」。
- **做法**：`src/core/consolidate.js` 增加 `CONSOLIDATE_OPERATIONS`（`invalidate` / `archive`）与 archive 分支；`planConsolidation` 接受 `archiveIds`（数组或逗号分隔字符串，去重）。只归档仍 `active`、无 `valid_to`、无 `superseded_by`、在 now 有效的记录，`after.status = 'archived'`，`valid_to` / `superseded_by` 保持为空，正文 hash 前后一致。API 透传 `archive` / `archiveIds`；CLI 新增可重复的 `--archive <id[,id]>`，默认仍是 dry-run，且不能和 `--undo` 同用。计划 / 回执 / undo 三类文件与 5% 保险丝全部复用；同一条同时被 invalidate 点名时 invalidate 优先，archive 报 `already_planned`。
- **行为**：`--apply` 只把 `status` 改成 `archived`，默认检索面与当前 `as_of` 路径都会排除它（这一点与 invalidate「`as_of` 仍可查」不同）；`--undo` 只把 `status` 恢复成 `active`。回执 stats 增加 `invalidate` / `archive` 条数；core / API / CLI 各自补了规划、落地与参数边界的测试。
- **边界**：archive 必须由人显式点名，不是自动衰减，也没有「到期自动归档」；因为不写 `valid_to`，它不提供历史关闭点，只能 `--undo` 或按 id 读回。`merge` / `summarize` / `promote` 的执行层（提案层见下一节）、replay、`diff.jsonl`、写入回执与后台自动巩固仍未做。

### 巩固：内容类操作先只出提案，不动库

- **修的问题**：`merge` / `summarize` / `promote` 一直只有架构里的目标接口。它们会新增或压缩事实，直接自动执行等于让程序替人决定「什么该合并、什么该提升」；而真实语料里又没有可自动发现的重复对（50 篇里 4-gram 重叠 >0.15 的笔记对为 0），先做自动发现只会产出一堆假候选。
- **做法**：新增纯决策模块 `src/core/propose.js`（`planContentConsolidation`，schema `tabellio.consolidate.proposal/1`）：由人显式给源 id，分别生成合并稿、抽取式摘要或候选规则脚手架；目标 note 只在返回对象里，路径是 `notes/<新 id>.md` 或 `notes/candidates/<新 id>.md`。`src/api.js` 加 `proposeConsolidation`（只读扫描、不 ensure、不写 run）；`bin/memory consolidate --merge/--summarize/--promote` 接入，默认就是提案。
- **行为**：merge 至少 2 条且同 scope、同 kind，按段落去重拼接；summarize 恰好 1 条且正文 ≥200 字，按段落取首句，草稿不更短时如实报 `draft_not_shorter`；promote 至少 3 条、同 scope、`valid_from` 跨至少 2 个日期，只产 `## 观察` + `## 待人工归纳` 脚手架。三种目标都是 `status:draft`、`requires_review:true`、`apply_supported:false`；任一源缺失/解析失败/非 active/已失效/已被取代/尚未生效，整单 `source_invalid`，不静默丢源。`--apply` 对内容类操作退 2，并明确「执行层未实现」。
- **边界**：没有自动发现、没有 LLM 摘要、没有真正写 note、没有归档源；因为不写库，也没有内容类 receipt 与 `--undo`。提案里的 `estimated_change_ratio` 只报警告，不触发 5% 熔断（熔断属于执行层）。summarize 是抽取式，不会替人改写或新增事实；promote 的「规则」仍需人工归纳。

### 评测：判分器先接住正确改述，再被 106 条对抗答案打一遍

- **修的问题**：判分器用 `expect` 逐字子串，模型答「400 行」而 `expect` 是「不超过 400 行」就判错；同时没有装置检验它会不会把「含糊但切题」或「编造值」收下。判据 2 的 1.408 因此是判分器压出来的下界，不是干净的结论。
- **做法**：`bench/scorer.mjs` 新增 `taskAnswerAliases()`，判分改判 `expect[] || answer_aliases[]`（别名只放宽 expect，不绕过 `forbid`）；32 道可答题各补 1–4 条别名。新增 `bench/core-30-v1/adversarial.json`（106 条：52 应接受、54 应拒绝）与零依赖 runner `bench/judge-adversarial.mjs`。20 道拒答题的 `forbid` 从占位值改成**语料库里可追的真实陷阱值**（测试会逐条验来源）。
- **行为**：对抗集误收率 **0.0000**（54 条应拒全拒）、正确接受率 **1.0000**（52/52），通过；门槛是误收 < 20%、正确接受 ≥ 95%。旧回答层数字 0.744 / 1.408 标为补丁前下界，**当时判据 2 未重测**（只查了环境变量，没查凭据文件）；后续已重测，见本节顶部。
- **边界**：打的是规则判分器，不是 LLM 裁判；别名是人工白名单，可能对题集过拟合，白名单外的改述仍会误判。20% 人工抽检与 Cohen's κ 未做；陷阱题 / `capability` 当时仍未落地（见下一节）。

### 评测：能力分层与陷阱题从「未测」变成有数

- **修的问题**：题集只有 `kind`（事实/偏好/纠错/流程/拒答）五类，多跳、时间推理、知识更新、陷阱题全挤在 `fact_recall` 里；`trap_fall_rate` 算不出来，判据 3 的陷阱项只能写「未测」。文档里的 `capability` 与 `negative_transfer_probe` 一直是目标 schema。
- **做法**：`bench/scorer.mjs` 加 `CAPABILITIES` / `taskCapability()`（显式优先，旧题按 `kind` 回退）、`taskNegativeTransferProbe()`、`taskExpectAll()`；`scoreTask` 输出 `capability` / `trap_fall` / `expect_all`，`forbid` 与 `fall_patterns` 都算「用了错值」。题集扩到 **56 题**：新增 2 道多跳（Harborlight 正式/预览构建目录、Orchid 生产/预发端口）与 2 道时间题（Kestrel 自动同步/失败补跑、Orchid 生产/预发缓存 TTL），4 道陷阱题带 `negative_transfer_probe`（f01/f02/f04/f07）。`bench/run-eval.mjs` 按 `capability` 分表，指标加 `trap_fall_rate`。
- **行为**：2026-10-17 实测（56 题 / 50 篇，`--same-corpus`）`new` 臂 `recall@5 = 0.8611`（31/36）、`correct_refusal_rate = 0.750`（15/20，**正好压线**）、`injected_tokens_mean = 266.0`、检索层 `token_efficiency = 2.081`；`multi_hop` 2/2、`temporal` 2/2 全中；`trap_tasks = 4`、`trap_falls = 1`、`trap_fall_rate = 0.25`（f01 答出预发端口 9443）。判据 1 仍成立，但拒答已无余量。
- **边界**：拒答从 0.800 降到 0.750 不是检索退化，是补真实 `forbid` 后 r01 暴露（echo 上下文里出现 `toml`）；r03/r07/r11/r12 仍是假命中。`negative_transfer` / `multi_hop` 各只有 4/2 题，陷阱率分母只有 4，只能当方向；`temporal` 测时间点/时长对齐，不测 `as_of` 回放。106 条判分器对抗集仍只覆盖原有 52 题。回答层当时没有重测；后续修正注入计量并重测（top-5 2.579、top-2 6.182），判据 2 成立，见本节顶部。

### 索引：从一屏平铺改成**分层路由 + 清单**

- **修的问题**：真实旧库导入 1321 篇后，200 行 / 25KB 的索引只列得下 **127 篇**
  （`status` 报 `indexHidden: 1194`）。检索面一直是好的（它全扫 `notes/`），
  坏的是「不检索直接读索引」这条路径 —— 翻开 `MEMORY.md` 会以为库里只有 127 篇。
- **做法**：`index/MEMORY.md` 变成**路由层**（一行一个主题组，组 = 笔记 id 里第一个
  `#` 之前的部分），每组一个 **清单文件** `index/groups/<序号>-<组名>.md`（一组一行指针，
  每文件 ≤ 400 行，超过分页**不截断**）。容量从「200 条」变成「约 190 组 × 400 条」。
- **实测**：`indexHidden` 1194 → **0**，`listed` 127 → **1321**，路由层 72 组 / 80 行 / 7.5KB。
- **没做**：架构文档原定的「consolidate 把碎片合成整篇」。真实库里 1164/1321 集中在
  7 个大组，它们是同主题的高频记录而不是同一件事的碎片；合并要改 `notes/`（真相源），
  为让索引好看去改写记忆内容不划算。理由与数字写在 `docs/06-architecture.md §3.1.1`。
- **新增命令 `memory index`**：`--json` 报 `listed` / `hidden` / `reachable` /
  `unreachable[]` / `stale` / `listFiles[]`；`--rebuild` 才写。**退出码**：
  `stale` 或有笔记走不到时是 1，干净时 0（`ok:true` 说的是「查询成功」，
  退出码说的是「索引健康吗」—— 分开表达，不然 CI 会把瞎掉的索引当绿的）。
- `status` 的警告文案随之改写：分清「索引还没生成」/「索引是旧的平铺形态」/
  「路由层装不下被削了」三种成因 —— 报同一句会让人去修错误的那一层。
- 重建**幂等**：叶组按 `(条数 desc, 组名 asc)` 显式排序，不依赖 `Map` 插入序。
  顺手修了一个真 bug：截断提示行 `- … 还有 N 条未列入索引` 自己以 `- ` 开头，
  被计数逻辑当成一条指针 ⇒ `indexHidden` 永远少 1；当列出的条数恰好等于总数时
  `truncated` 还会算成 `false`（索引少 1193 条而 `status` 报一切正常）。

### 切词：修掉跨词碎片造成的假命中

- **修的问题**：切词器把相邻二字一律生成，跨词边界会拼出并不存在的词 ——
  「闸门」+「的」→ `门的`，「闸门」+「的默认值」→ `的默`。真实库上问
  「量子色动力学里的胶子禁闭」，整条查询只有 `里的` 存在于语料，于是
  **92 条命中、coverage 全为 1.0、`refused:false`**（库里与量子色动力学毫无关系）。
- **做法**（全在切词层，打分层一个字没改）：结构助词 `{的, 了, 是, 在, 和, 与}` 处断开
  再取二元组（碎片不生成，而不是事后过滤）。另加一道证据性闸门
  `no_informative_term`（整条查询的词项都太常见 → 拒答；`INFORMATIVE_MIN_DOCS = 200`，
  语料小于 200 条时关闭，所以它在 51 篇的评测语料上**不生效**）。
- **为什么不在打分层打折**：M1 试过按 idf 给高频词项打折，真答案被一起压掉
  （`recall@5` 0.844 → 0.563），已回退。见 `docs/06-architecture.md §5.4`。
- **实测**（`node bench/run-eval.mjs --same-corpus`，同一语料前后对比）：

  | 指标 | 改前 | 改后 | 阈值 |
  |---|---|---|---|
  | `recall@5` | 0.844 | **0.844** | ≥ 0.80 |
  | `correct_refusal_rate` | 0.125 | **0.750** | ≥ 0.75 |
  | `injected_tokens_mean` | 299.9 | **310.0** | ≤ 500 |

  **判据 1 由「不达标」变为「成立」**（三件都达标）；判据 2 的
  `token_efficiency` 2.251 → 2.177（阈值 ≥ 2.0），仍在阈值内。

### 口径落纸

`docs/06-architecture.md` 新增/改写：§3.1.1（分层索引与「为什么没采用 consolidate」）、
§5.4（命中判定的完整口径：覆盖率闸门 + 证据性闸门 + 切词层修法 + 实测表 + 明确没做的事）、
§6.1（M2 实测基线与三条口径各自查什么）、§6.3（`memory index` 进 push 门禁、
索引重建幂等的两个具体不变量）、§8（M2 行的交付物与出口条件）。
`docs/07-usage.md` 新增 `index` 命令一节、重写 `status` 一节、补
`no_informative_term` 与「覆盖率闸门的洞」小节。

### 回答层：第一次用真模型测判据 2/3

- **修的问题**：`bench/run-eval.mjs` 的回答器一直是非模型的 `echo`，判据 2 的 `token_efficiency` 与判据 3 的
  `negative_transfer` 都定义在**答对率**上，零模型装置只能拿「gold 有没有进上下文」当代理。
  M3 报的 `token_efficiency = 2.037` 就是代理值，不是 `02-evaluation.md §4.5` 的口径。
- **做法**：新增 `bench/llm-answerer.mjs`（零依赖、OpenAI 兼容 `/chat/completions`，deepseek-flash 默认；
  超时/重试、token 成本估算、错误信息不含 key），`run-eval` 加 `--answerer llm`、`--runs`、`--concurrency` 与
  `oracle` 臂；`--dry` 强制回 `echo`，CI 不调网络。默认仍是零成本 `echo`。
- **实测**（2026-10-17，`core-30-v1` 52 题，3 轮，温度 0，max_tokens 256）：acc closed_book **0.385** /
  real **0.744** / oracle_gold **0.846**；`negative_transfer = −0.359` **窄口径达标**（阈值 ≤ 0.02，
  记忆净收益 35.9 点）；`oracle_gap = 0.103`；回答层 `token_efficiency = 1.408` **不达标**（阈值 ≥ 2.0）。
  **判据 3 只有窄口径达标，判据 2 不成立**：完整判据 3 还要求陷阱题 `trap_fall_rate ≤ 25%`，当前题集没有陷阱题，不能写「判据 3 成立」。
  三臂 468 次调用共 **$0.0187 / 约 2 分钟**。
- **口径修正**：此前「判据 2 达标」的结论作废——2.037 是检索层代理。回答层 1.408 是严格逐字判分下的**下界**；
  oracle 8 道错题里 7 道是语义正确的同义改写被逐字 `expect` 判错，1 道（k06）是题面问「包管理器」而 `expect`
  写「pnpm-lock.yaml」的题集 bug。修判分口径（`answer_aliases` / 判分器对抗集）是下一刀，不靠改题面迁就模型。
  （补记：2026-10-17 晚已完成，见本节顶部「评测：判分器先接住正确改述…」；回答层后续已修正计量并重测，见「评测：回答层注入计量修正，判据 2 成立；top-2 更省」。）
- **没做**：`bench/replay.mjs` 的 168 次时间回放还没接模型（`staleness_rate` 仍由回放认定，三档不搬过去）；
  人工 κ 抽检未做；回答层不进 CI。

## M6（未发布）

M6 是**生产行为变化**：M5 逐格指名了缺的那条机制（「判定命中之后再核一次『被问的实体 ×
被问的知识点号是否在同一篇里共现』」，`docs/06-architecture.md §5.5.2` 第 3 点），M6 把它
实现出来。**没有调常量** —— 覆盖率 / `df` 轴一个字没改，新增的是一条判定。

### 新增：组合级共现核对（`src/core/cooccurrence.js`，零依赖）

- **修的问题**：`coverage` 结构上区分不了「金标命中判别词」与「近邻命中了同一个判别词」——
  分母里每个证据词只算一次、分子单词命中可放大到 ≈2.2×，含孤例判别词的文档覆盖率被
  `Math.min(1, …)` 顶到 1.000，与金标逐位相同。于是「库里有近邻、事实不同」这类题
  覆盖率闸门看不见（M5 实测：`recall ≥ 0.80` 的 9807 格拒答率全 0.000）。
- **做法**：命中之后逐候选篇核「被问的几类东西是不是写在**同一篇**里」，只在词面层做，
  **不调模型**。四步：取锚点（`source === 'term'` 且切词长度 ≥ 2、`df/n ≤ 0.5`）→
  按词面分 `digit`/`han`/`latin`/`other` 四类 → 算**可核类数** → 每类都要在这一篇里命中。
- **要害（前两版都栽在这）**：可核类数按**「库里认不认识这个词项」**（`presentClasses()`，
  `df > 0`）算，**不是**按「它够不够稀罕、能不能当锚点」算。绑定是对称的、被问的两半不
  对称：50 篇档 `Quartzwell 的温升步幅 kp00002 是多少？` 里 `quartzwell`（df=17/50）
  算锚点却没有一篇把它和别的锚点类写在一起，于是掉出绑定集；按 `min(2, 绑定类数)` 数
  需求数就会放行 `lumenpath-kp00002`（一个字没提 Quartzwell）。**词项在库里存在就说明
  它可被问到，候选篇里没有它就是这一篇没写它** —— 这正是要拒答的情形。
- **笔记身份参与核对（判据 1 不掉的原因）**：真库答案笔记正文**不复述实体名**
  （`project-kestrel-retry-count.md` 正文只说「同步失败后重试 5 次」，`Kestrel` 只在文件名）。
  只核正文时真库 `recall@5` 0.844 → **0.750**（丢 c02/f03/k04）。修法：`buildIndex()` 的
  `metas` 多存一项 `identityTerms`（`id` + `title` + `tags` + `aliases` 切词后排序成数组，
  **不进 `postings`、不改 BM25 打分**），核对时并进候选篇的 present 集合。
- **新拒答理由** `cooccurrence_required_pair_missing`：仅当「非 `no_informative_term`、
  非 `only_external_low_trust`、`eligible` 为空、且确实有候选过了覆盖率闸却栽在共现上」
  时使用；防伪条件是「候选**每一篇都缺同一类**时不报这条」（那是「查的词不在库」，
  不是「组合没写过」）。`diagnostics.cooccurrence = {checked, blocked, blockedIds[]}`。

### 五档读数：五档**全部**同时满足 `recall ≥ 0.80` 且拒答 `≥ 0.75`

`node bench/sweep.mjs`（35 格 = 5 档 × 7 个覆盖率点，其余三轴钉成生产单点）：

| docs | 可答题 / 拒答题 | 满足格数 | `recall@k` | `correct_refusal_rate` |
|---|---|---|---|---|
| 50 | 24 / 24 | 7 / 7 | **1.000** | **1.000** |
| 200 | 34 / 34 | 7 / 7 | **1.000** | **1.000** |
| 500 | 42 / 42 | 7 / 7 | **1.000** | **1.000** |
| 1000 | 46 / 46 | 7 / 7 | **1.000** | **1.000** |
| 2000 | 48 / 48 | 7 / 7 | **1.000** | **1.000** |

生产口径那一格（`minCoverage 0.6`、`dfRatio 0.05`、`dfFloor 64`、`coocRatio 0.5`）就是
上表的数字：**不需要为扫描挑参数，生产默认值五档全达标**。`recommend()`：可行组合 7 个，
最优 key `-|0.05|64`、`worst_recall = 1`、`mean_refusal = 1`。
**防伪对照**：把 `coocRatio` 置 `null`（关掉共现核对）重跑同一格，五档拒答率**全部回到
0.000**（召回仍 1.000）—— 0→1 的位移完全由这条新机制承担。该对照已是回归断言。

### 判据 1 零回归

`node bench/run-eval.mjs --same-corpus --arms none,new`：`recall@5 = 0.844`（≥ 0.8）、
`correct_refusal_rate = 0.8`（≥ 0.75）、`answered_rate = 0.577` —— 与 M5 基线 `841b460`
**逐位相同**，真答案一条没丢。

### 扫描装置同步（`bench/sweep.mjs`，不是生产行为）

装置必须量生产的行为，否则读数是装置的读数。M6 在 `coveredIds()` 里修掉三处与生产不同口径
的 bug（审查时逐条抓出来的）：`hits` 返回了**没过闸**的候选列表（于是「拒答率」用 `eligible`
算、「召回了什么」用 `all` 算，两把尺子量同一格）、覆盖率分子公式与生产不一致、逐桶质量算在
错误的桶上。另加 `coocSuite` / `coocVerdict` 复刻生产判定（含 `identityTerms` 透传 ——
装置漏传身份会比生产**严**，两边读数就对不上），并把 `coveredIds` 的 `hits` 改成过闸后的
`eligible`（与生产 `items` 同源、被挡的进 `ignored`）。

### 诚实记录：小语料闸**没有**修（任务 M6-2 无解）

`isInformativeTerm` 的第一支 `df ≤ 64` 而 `df ≤ n`，所以 `n ≤ 64` 时任何词项都算证据词、
50 篇档闸门等于没开。既有断言（`test/core-bm25.test.mjs:238-253`）要求
`isInformativeTerm(51, 51) === true`（即 `n ≤ 64` 必须一律 true），与「50 篇档闸门真的能咬人」
直接冲突，没有同时满足的公式；改成纯比例会让 `(51, 51)` 变 false 而炸断言，改成
「`n ≥ 200` 之前一律 true」则 50 篇档闸门仍然关闭、等于没修。**保留原式不修**，理由是两条
可满足的改法都不解决任务要的那个问题（五档达标靠共现核对，关掉它 50 篇档拒答即 0.000）。
详见 `docs/06-architecture.md §5.5.3`。

## M5（未发布）

### 扫描装置的夹具整体重建（`bench/sweep-fixtures.mjs`，装置口径变化，不是生产行为变化）

M4 把「验收线无解」归因到夹具不可分，M5 把那台夹具换掉再问一次同一个问题。**生产代码一个字没动**
（`src/**` 常量是 M4 定稿的），变的是**量它的那台装置**。

- **旧夹具两处不真实，逐条拆掉**：
  1. **判别词 df 恒为 12**，与语料规模无关 —— 真实库里一个知识点会被越写越多篇。新夹具让服务名
     df 随规模长（2000 篇档 df=168，占 8.4%）、知识点号 df = 覆盖服务数（2→4），专门写了
     「不同取值 ≥ 4」的断言显式否定「恒为常数」。
  2. **不可答题是「服务名 + 一个通用词」**（`Lumenpath 的命中率目标是多少？`），难度靠「问的那个词
     库里压根没有」—— 判别词一被闸门放行，它就和可答题完全同形。新夹具改成**「近邻同服务、同词表，
     但那个事实没写过」**：`Lumenpath 的扩容台量 kp00022 是多少？`（服务在库、`kp00022` 在库、
     属性词的**切词结果**逐个在库，只有这个**组合**不在库），并断言两类题**题面同模板**。
- **装置接线**：`bench/sweep.mjs` 只留判分与扫描，语料/题面生成抽到 `bench/sweep-fixtures.mjs`；
  顺手补了 `sweep()` 里 `minDocsPoints` 那一维（以前只取数组第一个元素，`minDocs` 轴**扫了个寂寞**，
  5×7×7 的「1960 格」其实是 5×7 格重复算 8 遍）。
- **生产口径五档读数**：`recall@5` **1.000 / 1.000 / 1.000 / 1.000 / 1.000**，拒答率 **0.000** 五档。
  （旧夹具那个「五档恒为 80.0%」的上界是它的 `drop` 档人造出来的，新夹具没有这道人造成分。）
- **验收线仍然无解，但这次归因是逐格可证伪的**：5 档 × 7 覆盖率 × 8 df 比 × 5 `minDocs` × 8 地板
  = **9835 格**全扫，同时满足 `recall ≥ 0.80` 与拒答 `≥ 0.75` 的是 **0 格**；而 `recall ≥ 0.80`
  的格子有 **9807** 个，其中拒答率**全部为 0.000**；拒答率 > 0 的格子一共只有 **28 个**（全在
  50 篇档），而那 28 格的 `recall` **全是 0.000** —— 两个指标在这台装置上完全反相关，没有折中点，
  拒答只能靠把可答题一起拒掉来换。
- **缺的机制**（不是「阈值再严一点」）：判别词是孤例级稀罕词（df=2～4），它自己就过了证据性闸门；
  而 `coveredIds()` 的分母里每个证据词**只算一次**、分子里单词命中能放大到 ≈2.2×，所以**任何含判别词
  的文档覆盖率都被顶到 1.000** —— 实测 2000 篇档不可答题 top-1 是「另一个服务的同一知识点」，
  覆盖率 1.000，与金标逐位相同。覆盖率闸门看得见「这一篇有没有被问的判别词」，看不见
  「这一篇是不是被问的那**篇**」。缺的是**组合级共现核对**：命中之后再核「被问的服务 × 被问的知识点号
  是否在同一篇里共现」。这条机制现在不在 `src/core/` 里，按铁律 M5 没有动生产代码，也没有用调常量
  的办法伪造一个拒答率出来。数字、逐词项重放与 9835 格扫描写在 `docs/06-architecture.md §5.5.2`。
- **判据 1 不受影响**：`node bench/run-eval.mjs --same-corpus --arms none,new` 的 `recall@5` 0.844、
  `correct_refusal_rate` 0.800、`injected_tokens_mean` 254.9 三项**逐位不变**（`bench/core-30-v1`
  与 sweep 夹具互不相干）。
- **新增回归用例** `test/sweep-fixtures.test.mjs`（6 条）：判别词 df 随规模真实增长、可答题证据在库
  答案唯一、不可答题近邻在库但组合不在库、两类题同形、以及两条把归因钉死的用例（覆盖率饱和的钉子、
  闸门两条口径都在按设计工作）。`test/bench-sweep.test.mjs` 里两条**依赖旧夹具结构**的断言按新夹具
  重写：旧「1000 篇档拒答率 ≥ 0.50」之所以能过，靠的正是旧夹具的失真，留着就是把一条假成绩留在仓库里。

## M4（未发布）

### 证据性闸门：判据从「比例」改成「绝对词频 **或** 比例」（行为变化）

- **修的问题（M3 扫描发现，`af04ed6`）**：`INFORMATIVE_DF_RATIO = 0.05` +
  `INFORMATIVE_MIN_DOCS = 200` 只在两个点上验过。扫描发现**刚过 200 篇的语料上闸门是坏的** ——
  200 篇时生产值把可答题**全部拒掉**（`recall@5` 0.0%、拒答率 87.5%），到 2000 篇才回到
  80.0% / 62.5%。真实库 1321 篇恰在安全区，**离悬崖只有两倍距离**。
- **根因不是「太严」，是判据随语料规模漂移**：`df/n` 的分母是库的大小，而「一个词项算不算证据」
  本该由**它自己在库里出现的绝对次数**决定。判别词（服务 × 事实的名词）的 df 由「这个知识点
  被写了多少篇」决定，与库总量无关 —— 在合成语料上它恒为 12，于是 n=200 时 `12/200 = 0.06 > 0.05`
  被整批判成「没有信息量」，分母塌成 0，全部笔记覆盖率归零。
- **做法**：新增 `INFORMATIVE_DF_FLOOR_DOCS = 64`，判据改成**或**关系
  —— `df ≤ 64`（绝对词频，与语料规模无关）**或** `df/n ≤ 0.05`（比例，管大库）。
  `INFORMATIVE_MIN_DOCS` 那个「按语料规模开关闸门」的常量**取消**（`src/core/bm25.js` 仍导出，
  只为兼容旧引用）。地板取 64 而不是别的数：它在真库尺度（1321 篇）上**低于**比例线的分界
  `0.05 × 1321 = 66.05`，所以**真库行为逐字不变**；两条线正好在 **1280 篇**交叉，
  比它小的库由地板接管，于是小库不再整条拒答。
- **没采纳 M3 的建议值**（`MIN_DOCS 200 → 1000`、`RATIO 0.05 → 0.02`）：那只是把悬崖推远
  没拆掉它 —— 判据仍然是 `df/n`，换个规模（用户把 1321 篇清到 999 篇）会再撞一次。
- **五档实测**（`node bench/sweep.mjs`，每格 = 可答题 `recall@5` / 不可答题拒答率）：

  | 语料 | 修复前（比例 0.05，n≥200 才启用） | 修复后（比例 0.05 **或** df ≤ 64） |
  |---|---|---|
  | 50 篇 | 0.0% / 100.0%（闸门没启用） | 80.0% / 0.0% |
  | 200 篇 | **0.0% / 87.5%**（可答题全被拒） | **80.0% / 0.0%** |
  | 500 篇 | 80.0% / 62.5% | 80.0% / 0.0% |
  | 1000 篇 | 80.0% / 62.5% | 80.0% / 62.5% |
  | 2000 篇 | 80.0% / 62.5% | 80.0% / 62.5% |

  **召回这一半五档全过**（0.0% → 80.0% 的那一档就是被修掉的缺陷）；**拒答这一半一档都没过**
  （0.0 / 0.0 / 0.0 / 62.5 / 62.5%，验收线 ≥ 75%）：8 条不可答题每题占 12.5%，
  差的是**一条题**，而且这套夹具上**无解** —— 全网格 1960 格（5 档 × 7 覆盖率 × 7 df 比 ×
  7 地板）里同时满足 `recall ≥ 0.80` 与拒答 `≥ 0.75` 的是 **0 格**。夹具的两类题在覆盖率上
  完全相同（逐题量：8 条不可答题的 maxCov 五档**全是 1.000**，120 条可答题里最小的 12 条
  **也全是 1.000**），只剩证据性闸门一条路可走，而那条路会把形状相同的 36 道 `drop` 档
  可答题一起拒掉。数字与证明写在 `docs/06-architecture.md §5.5.1`。
- **判据 1 不受影响**：`node bench/run-eval.mjs --same-corpus` 的 `recall@5` 0.844、
  `correct_refusal_rate` 0.800、`injected_tokens_mean` 254.9 与改前**逐位相同**；
  52 道题里没有一道落到 `no_informative_term`（逐题查过，52/52 都有证据词）。
- **回归用例**：`test/bench-sweep.test.mjs` 新增「小语料不许全拒」（五档逐档跑生产口径，
  200 篇档必须还能答题、`recall@5 ≥ 0.70`）、「真库尺度上闸门仍然咬人」（1000 篇档拒答率 ≥ 0.50）、
  「装置量的是生产的行为」（与 `recall()` 逐题对账）。原「装置真的会动」一条的旧断言
  （生产值在 200 篇上拒答）**正是**被修掉的缺陷，改成量「纯比例口径 vs 加地板」这一对。

### 扫描装置 `bench/sweep.mjs`：修掉覆盖率算法与生产的偏差（口径变化）

- **问题**：装置自己重写的覆盖率有两处与生产不符 —— ① 分子按 `Σ 命中词权重`（**不乘词项 idf**），
  生产的 `massOf` 是 idf 量级；② 只取**分数最高**那个桶的覆盖率，生产的 `aggregateByNote()`
  取同一篇笔记各桶的**最大**覆盖率。两处叠起来让装置**系统性低估覆盖率**：产物检查抓到
  `Cinderbay 的连接池最多几个？` 装置判「无合格命中」（`eligible=0`）而生产判 12 条合格；
  50 篇档逐题对账有 **25/68** 道题判定不同。
- **做法**：按生产公式重写（`qWeight = weight × idf`、`mass = Σ qWeight·tf(k1+1)/(tf+k1·norm)`、
  分母 = 证据词的 idf×权重之和、笔记层取各桶最大值），并新增**逐题对账**用例。
  修好之后 50 / 200 / 500 / 1000 / 2000 五档合计 **580/580 道题判定与 `recall()` 逐题相同**
  （修前 1/580）。
- **影响**：M3 那两张曲线表的「拒答率」那一列整体偏低（召回列是准的），
  `docs/06-architecture.md §5.5` / `§5.5.1` 已加注说明并给出修正后的数字；
  「闸门一开就在 200 篇上全拒」这个主发现两版装置都能复现，结论不变。
- **新增扫描轴**：`dfFloorPoints`（绝对词频地板，`0` = 修复前的纯比例口径，
  `3200` = 比任何一档都大 = 闸门关掉），所以修复前的曲线能在同一台装置上重现；
  `--json` 的 `production` 段一并报出地板值。

## M3（未发布）

M3 的既定内容是三宿主实机验证与分发；这一版先补**判据 3 的测量装置**、
**常量在中间量级上的曲线**、以及**拒答余量** —— 三件都是「判据说达标了、
但换个量级就不知道还成不成立」的补课。

### 判据 3 的测量装置 `bench/replay.mjs`（新增）

- **它是什么**：合成时钟模拟 4 周使用（28 个使用日 × 6 次召回 = 168 次召回），
  32 件事、写入 44 条笔记（含 12 条被取代的旧值），语料是另造的 12 个虚构服务，
  与 `core-30-v1` 的 Orchid / Kestrel / Harborlight 不重叠。**零模型调用、零依赖**，
  `--seed` 固定随机源（同种子两次输出逐字一致，有单测钉住），`--json` 出机器可读。
- **实测**：`staleness_rate` **0/168**（阈值 ≤ 0.05）、`negative_transfer` **0/168**
  （阈值 ≤ 0.02）。**判据 3（窄口径）成立**；完整判据还要求陷阱题，当时没有构造，见下条口径偏离。
- **为什么这三个 0 不是「测不出来」**：同一次回放跑一条消融对照 —— 把被取代的旧值改回
  「看起来还有效」（清掉 `valid_to` / `superseded_by`），同一批会话重跑，**35 次机会里
  35 次把旧值排到了第一**。指标是灵敏的，全 0 是 `isValidAt` 这道有效性过滤在起作用。
- **口径偏离（记账）**：`negative_transfer` 这里是**窄口径**（没有旧值被当成答案），
  不是文档要求的 `closed_book` / `oracle_gold` / `real` 三档对照 —— 三档要有会答题的
  回答器，本装置零模型调用。M4 接模型回答器后补。理由写在 `docs/06-architecture.md §6.1`。

### 常量扫描 `bench/sweep.mjs`（新增）

- **它是什么**：在 **50 / 200 / 500 / 1000 / 2000 篇**合成语料 × 多组查询上扫
  `MIN_COVERAGE` 与 `INFORMATIVE_DF_RATIO` / `INFORMATIVE_MIN_DOCS`，每格出
  「可答题 `recall@5` / 不可答题拒答率」。`--json`、约 20 秒跑全五档。
  它**不判判据**，只出曲线与「在召回 ≥ 0.95 约束下有没有可行解」。
- **主要发现（改口径）**：证据性闸门在**刚过 200 篇**的语料上是坏的 —— 200 篇上生产值
  （df/n ≤ 0.05）把**可答题全部拒掉**（`recall@5` 0.0%、拒答率 87.5%），保守到 0.01 也一样；
  到 2000 篇才回到「可答题一条不丢 + 拒答 62.5%」。真实库 1321 篇恰好在安全区里，
  **但离悬崖只有两倍距离**（语料掉到 500 篇就进全拒区间）。
- **建议值（M3 没动生产常量）**：启用阈值 `INFORMATIVE_MIN_DOCS` 由 200 抬到 **1000**，
  `INFORMATIVE_DF_RATIO` 由 0.05 收到 **0.02**。理由不是「更严格」，是**在安全区里取中位**：
  0.02 在 1000 篇上仍保住 70% 召回、2000 篇上 80%，而 0.05 在 500 篇上已经把可答题全拒。
- **没测出来的**：覆盖率闸门在这套合成语料上**完全不动**（每档每阈值都是 80.0% / 0.0%），
  因为查询词与 gold 笔记逐字同源、gold 的 coverage 中位数在三档上都是 1.00 ——
  这个夹具分不开两类题，**不能**用来给 `MIN_COVERAGE` 定值。要定值得用换词更狠的查询，
  M4 的活。曲线与结论写在 `docs/06-architecture.md §5.5`。

### 拒答余量：题集从 40 题加到 52 题（拒答题 8 → 20）

- **修的问题**：M2 的 `correct_refusal_rate = 0.750` 正好压在阈值线上，**少对一题就不达标**。
- **做法**：只加**拒答题**（`source: []`，问的都是库里确实没有的值），
  既有 40 题的题面、判分逻辑、语料一个字没改；没有动检索算法或任何阈值。
- **实测**（`node bench/run-eval.mjs --same-corpus`，同一语料）：

  | 指标 | M2（40 题） | **M3（52 题）** | 阈值 |
  |---|---|---|---|
  | `recall@5` | 0.844（27/32） | **0.844（27/32）** | ≥ 0.80 |
  | `correct_refusal_rate` | 0.750（6/8） | **0.800（16/20）** | ≥ 0.75 |
  | `injected_tokens_mean` | 310.0 | **254.9** | ≤ 500 |
  | `token_efficiency` | 2.177 | **2.037** | ≥ 2.0 |

  **硬约束「真答案一条不许丢」成立**：`recall@5` 逐题不变（27/32），
  新增 12 题全是拒答题、按 `bench/scorer.mjs` 的口径不进 `recall@5` 分母。
  余量从 0 变成 1/20。`token_efficiency` 从 2.177 降到 2.037（仍达标）——
  降的原因不是系统变差，是**题集构成变了**（拒答题不注入上下文，把每题的均值拉低）。
- **仍然该拒没拒的 4 题**（`r03` / `r07` / `r11` / `r12`）：全是假命中，
  top 命中的 coverage 实测 0.613 / 0.659 / 0.677 / 1.000，靠跨词碎片或话题相关笔记顶过 0.6。
  这一期**没有改算法**（扫描给不出可信的替代阈值），把它们如实留在题集里当负例 ——
  一个只由「已经能拒的题」组成的题集会自己给自己记功。

### 口径落纸（M3）

`docs/06-architecture.md`：新增 §5.5（常量扫描的两张曲线表、四条读法、建议值与「没测出来的东西」）、
§6.1 增补 M3 实测基线表（52 题口径 + 判据 3 的四行实测）与两段记账
（`negative_transfer` 窄口径、`--traps` 没构造出对抗情形）。
`docs/08-eval-runbook.md`：§6 的「当前状态」表**整张是旧的**（还停在 M1 的
`recall@5 = 1` / `correct_refusal_rate = 0.125`），已按当次输出重写并注明；
新增 §6.1（判据 3 怎么跑）与 §6.2（常量扫描怎么跑）。

