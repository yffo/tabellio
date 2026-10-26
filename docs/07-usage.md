# 07 · 用法

`tabellio` 当前（M1 + M2：读取回执 / 巩固 / 撤销 / 候选闭环 / 自动发现提案 / 可选定时任务）是**命令行 + MCP**，没有常驻后台进程、没有数据库、没有网络调用。macOS 可选装 launchd 定时任务，它到点跑一次扫描就退出，只写待批准提案。
零运行时依赖：`node bin/memory` 直接就能跑，不需要 `npm install`。

- 要求：Node ≥ 20.11（实测 Node 25.8）。
- 库（store）就是一个目录：笔记是普通 `.md` 文件，`index/` 全是生成物、可删可重建。
- 默认库路径：`$MEMORY_STORE` / `$TABELLIO_STORE`，否则 `~/memory/tabellio`（改名前的 `~/memory/memory-service` 若已存在则继续沿用，stderr 会提一句）。

```bash
git clone https://github.com/yffo/tabellio.git && cd tabellio   # 仓库名与 npm 包名都是 tabellio
node bin/memory status                 # 建库 + 看一眼
node --test 'test/**/*.test.mjs'       # 全绿才继续（521 条）
```

## 一条事实一个文件

```markdown
---
kind: semantic          # core | semantic | episodic | procedural
trust: user_stated      # user_stated | system_derived | external
tags: [preference, tooling]
aliases: [acme-editor, 编辑器]  # 可选：作者给的同义说法，只参与身份核对
---

# 编辑器偏好

偏好用 acme-editor 写代码，缩进统一 2 空格。
```

`kind` / `trust` / `tags` / `aliases` 都可以不写（默认 `semantic` / `user_stated` / 无标签 / 无别名）。`aliases` 只参与身份核对（共现），**不是**检索的同义词扩展，不进 BM25 postings、不改打分。
正文上限 **400 字 / 200 token** —— 超了闸门会拒，并且告诉你超了多少。
超过一条事实该有的量，说明该拆成多条（`tabellio import` 会自动切）。

## 十七个命令

`setup` / `doctor` / `health` / `status` / `index` / `search` / `recall` / `explain` / `verify` / `consolidate` / `read` / `remember` / `capture` / `inbox` / `hook` / `schedule` / `import`（另有 `paths` 查路径）。

`setup` 只写宿主的 MCP 配置，不碰记忆库；`hook` 把 Claude Code 的会话结束事件接到候选箱（默认不装）；`capture` / `inbox` 是候选的**写入与批准**两端。`explain` / `verify` 是**回执（receipt）的读取端**：`recall` 可以把一次判断落成可核验的回执，之后再解释或复核，不需要重跑检索、不需要模型。`consolidate` 是**批量改库的入口**：默认只出计划，`--apply` 才动；元数据操作只改字段，内容类操作会写目标并关闭源，两者都能 `--undo`。`--merge` / `--summarize` / `--promote` 默认只出**内容类提案**，`--apply` 才执行；`--auto` 自动发现近似重复，但只写待批准提案，不直接改库。`schedule` 在 macOS 上给这条发现加一个可选的 launchd 定时器，仍然只产提案。`doctor` 是只读体检：把库、宿主配置、钩子和定时任务的状态收成一份报告，不修任何东西。

`search` 与 `recall` 的分工：前者给**指针**（pull，读哪条由调用方决定），后者一步给出
**可直接进上下文**的正文（按 token 预算裁剪、带拒答）；两者都零模型调用。

### 1. `status` —— 先看账，再看库

```bash
$ node bin/memory status
库：/Users/you/memory/tabellio
笔记：1321 条（core 0）  |  索引：80 行 / 7529 字节（上限 200 行 / 25600 字节）
单条上限：400 字 / 200 token  |  库上限：20000 条
候选（notes/candidates）：0  |  账本：1325 条事件
解析失败：0  |  超长：11 条超 400 字、0 条超 200 token
⚠️  11 条笔记超过 400 字（检索按 400 字切桶）
```

`--json` 给机器读（冻结字段 `{store, notes, indexLines, caps}`，其余全是账）：

```bash
$ node bin/memory status --json
{"ok":true,"store":"<库路径>","notes":1321,"indexLines":80,
 "caps":{"notes":20000,"noteBytes":524288,"noteChars":400,"noteTokens":200,"indexLines":200,"indexBytes":25600},
 "indexBytes":7529,"indexExists":true,"indexTruncated":false,"indexHidden":0, ... ,"warnings":[...]}
```

**这里最重要的两个字段是 `indexTruncated` / `indexHidden`。** M1 时代索引是一屏平铺的清单，
200 行 / 25KB 装不下 1321 条 —— 实测只列得出 **127 条**，`indexHidden: 1194`。也就是说
「读索引」这条路**九成是瞎的**：翻开 `MEMORY.md` 的人会以为库里只有 127 篇。

M2 把索引改成**分层**（路由 `index/MEMORY.md` + 清单 `index/groups/*.md`），
一行从「一条笔记」变成「一个主题组」，于是同样 1321 条全部列得下：

```bash
$ node bin/memory index
库：<库路径>
索引：80 行 / 7529 字节（上限 200 行 / 25600 字节）  |  层级 2（路由 + 清单）
路由：72 组  |  清单文件：72 个  |  笔记：1321 条
列出的条数：1321/1321（走得到 1321）
```

无论哪一层，账都必须**如实报**：列不出来就报 `indexHidden` / `unreachable`，
不许静默截断（旧项目为此付过代价）。

`status` 默认只读。`--rebuild-index` 才会写 `index/`（且要过索引闸门）。
`--rebuild-index --json` 会额外给出 `indexWrite:{listed,hidden,truncated,reason}`。

### 2. `index` —— 索引这条路还瞎不瞎（M2 新增）

```bash
$ node bin/memory index --json
{"ok":true,"notes":1321,"exists":true,"lines":80,"bytes":7529,
 "caps":{"lines":200,"bytes":25600,"listLines":400},
 "levels":2,"groups":72,
 "routes":[{"name":"<组名>","rel":"groups/001-<组名>.md","count":200}, ...],
 "listFiles":[{"name":"001-<组名>.md","count":200,"bytes":58343}, ...],
 "listed":1321,"hidden":0,"reachable":1321,"unreachable":[],"unreachableCount":0,
 "missingFiles":[],"stale":false, "warnings":[]}
```

字段就三组账：

- **列了多少** —— `listed`（被列进清单的条数）/ `hidden`（没列进去的）。
- **走得到多少** —— `reachable`（能从 `MEMORY.md` 顺着走到正文的条数）/
  `unreachable[]`（走不到的 id，最多列 50 个）/ `unreachableCount`。
  `listed` 说的是「写进文件了吗」，`reachable` 说的是「路通吗」—— 路由层指向的清单文件
  被删掉时 `listed` 仍然好看而 `reachable` 才是真相，所以两个都要看。
- **索引是不是旧的** —— `stale`：`true` 表示路由层记的条数和库里的对不上（真相源改过没重建）。

退出码：**`stale` 或 `unreachableCount > 0` 时退出 1**，干净时 0。CI 里直接
`tabellio index --json > /dev/null` 就能当门禁用（索引健康是可机检的，
不该靠人记得去跑 `status`）。

`--rebuild` 重建索引并顺带报出写入账；默认只读。
索引是 `notes/` 的纯函数，删掉 `index/` 只损失时间不损失事实 —— 真出问题就重建。
**重建幂等**是可机检的不变量：删掉 `index/` 重建两次，结果必须一致（组按
`条数 desc, 组名 asc` 显式排序，不依赖 `Map` 插入序）。

### 3. `search` —— 检索（永远只读）

```bash
$ node bin/memory search --query "索引上限是多少行" --json
{"hits":[{"id":"reference-index-cap-lesson#150","title":"**教训第四十一条 · 「砍了多少」不等于「砍得疼不疼」** …","score":0.7128},
         {"id":"reference-index-cap-lesson#192","title":"**教训第七十四条 · 上限类护栏要三档 …","score":0.708}],
 "tokens":448,"refused":false,"reason":null}
```

- `hits[].id` 就是**笔记文件名**（`read --id` 直接吃；评测的 `source`（旧 schema 叫 `gold_notes`）也是这个名字）。
- `hits` 只有指针（id / title / score），正文要用 `read` 取 —— 这是「pull 优先」：
  召回不替你决定要看什么。
- `tokens` 是这次结果**实际占的预算**；`refused` 是正常结果不是错误：
  `{"hits":[],"tokens":0,"refused":true,"reason":"top_score_below_threshold"}` 表示
  「库里没有能支撑回答的东西」，此时**不要**退化成「列几条最像的」。
  另外五个 `reason`：`only_external_low_trust`（只有外部资料）/ `all_hits_expired`
  （都过期了，试 `--as-of`）/ `no_index` / `no_informative_term`（整条查询全是常用词，
  见下）/ `cooccurrence_required_pair_missing`（命中的近邻**只写了被问的一半** ——
  比如问了「Kestrel 的重试次数」，库里只有「同步失败重试 5 次」而 Kestrel 是另一家的，
  被问的那两样从没写在**同一篇**里；见 `06-architecture.md §5.5.3`）。
- 常用开关：`--budget-tokens N`（默认 500）/ `--kinds core,semantic` / `--trusts user_stated`
  / `--min-relevance F` / `--min-score F` / `--min-coverage F` / `--as-of YYYY-MM-DD` / `--ledger`
  / `--no-refuse`（检索口径：覆盖率不参与准入、只保留硬拒答，由调用方判断要不要答；默认是问答口径）。
  阈值可调是**评测纪律**要求的：不许在计分集上调参，所以要能把参数摆到命令行上。
  这些阈值传 `null`/空值一律**退回默认**，不会把闸门悄悄关掉（fail-closed）。

#### 为什么拒答能拦得住「沾边但不答」的问题

只靠 BM25 分拦不住这类问题：问「代理节点的数据库连接池上限是多少」，库里那篇
讲代理节点端口的笔记会因为 `代理 / 节点` 命中而拿到很高的分（实测 relevance 0.93），
于是系统一本正经地给出一条**答非所问**的「最像的」。真正拦住它的是**覆盖率**：

> 覆盖率 = 这句查询的信息量（按 idf × 词权重算）里，这篇笔记的某一个段落覆盖了多少。

实测 50 篇语料上：8 条拒答题覆盖率 0.34–0.64（均值 0.50），32 条可答题 0.48–1.00（均值 0.72），
默认闸门 `--min-coverage 0.6` 落在两组之间。两个设计细节：

- **分母取全库的 idf**，不取过滤后的语料。否则「库里恰好有一批笔记今天过期」就会
  改变同一句查询的结论 —— 表现是「昨天答得出来，今天同一句说没证据」。
- 语料不足 20 篇时改用保底闸 `0.25`：5 篇的库上 idf 没有统计意义，
  一个通用词就占 1/5 的 df，拿它判死会变成「小库什么都搜不到」。
- `search` / `read` 默认**什么都不写**（只读挂载、别人的库、评测跑批都必须无副作用）。
  想把这次检索记进账本（`index/ledger.jsonl`）就加 `--ledger`。

#### 覆盖率闸门有一个洞，M2 把它堵在**切词层**

覆盖率闸门假定「整条查询里至少有真词」。当查询里**一个真词都没有**时这个假定就塌了：
分母里活下来的只有常用词，于是「命中了任何一个常用词」就能把覆盖率顶到 1.0。真实库上
（1321 篇）的实测：

```bash
$ node bin/memory search --query "量子色动力学里的胶子禁闭" --json
# 切词：量子 子色 色动 动力 力学 学里 [里的] 的胶 胶子 子禁 禁闭
# 只有「里的」存在于语料（df 96/1321）⇒ 所有含「里的」的笔记 coverage = 1.000
# 结果：92 条命中、refused:false —— 库里没有任何一条与量子色动力学有关
```

根因在**切词器**：它把相邻二字一律生成，跨词边界就会拼出并不存在的词
（「闸门」+「的」→ `门的`；「闸门」+「的默认值」→ `的默`）。这些碎片是高频的，
存在感反而很强。M2 的修法是把它们**从源头掐掉**，不是事后打折：

- 结构助词（`CJK_BOUNDARY_CHARS = {的, 了, 是, 在, 和, 与}`）处把 CJK 串断开再取二元组 ——
  `门的` / `里的` / `的数` 这类碎片**根本不生成**（不是事后过滤，是不生成）。
  实测：`闸门的默认值是什么` 改前切出 `[闸门, 门的, 的默, 默认, 认值, 是什, 什么]`，
  改后是 `[闸门, 默认, 认值, 什么]`。

外加一道**证据性闸门**（`no_informative_term`）：整条查询的词项全都太常见
（每个词项的 df/语料条数都 > `INFORMATIVE_DF_RATIO = 0.05`）就拒答。
语料小于 `INFORMATIVE_MIN_DOCS = 200` 条时这道闸门**关闭** —— df/n 在 51 篇语料上
没有统计意义（一个普通词轻松占 1/5），拿它判死会变成「小库什么都搜不到」；
而拒答是破坏性的（「它说不知道，可我明明记过」）。所以它只在真实量级的库上生效。

**为什么不在打分层打折**：M1 试过按 idf 给高频词项打折，结果是真答案被一起压掉 ——
`recall@5` 从 0.844 掉到 0.563，已回退。教训是「这个词项是不是证据」是二值的、属于切词与
词表；「这个词项有多重要」才是权重。混成一个连续折扣，两者一起坏。

实测（`node bench/run-eval.mjs --same-corpus`，同一语料前后对比）：
`recall@5` 0.844 → **0.844**（真答案一条没掉）、`correct_refusal_rate` 0.125 → **0.750**
（刚好达标）、`injected_tokens_mean` 299.9 → **310.0**（阈值 500）。

### 4. `read` —— 取正文

```bash
$ node bin/memory read --id reference-index-cap-lesson#150 --json
{"id":"reference-index-cap-lesson#150","title":"**教训第四十一条 · …","body":"…"}
```

`{"id","title","body"}` 是冻结形状；后面还跟着 `ok`、`note`（完整 frontmatter）、
`warnings`、`path`。`--with-text` 会给原始文件全文。
找不到 / id 越界（`../../etc/passwd`、`notes/../index/MEMORY.md`）都是 `ok:false` + 非零退出码，
不会去读库外的东西。

### 5. `remember` —— 写入（过闸门）

```bash
$ node bin/memory remember --file /tmp/pref.md --json
{"ok":true,"verdict":"allow","reason":"ok","id":"01M5347ZHE2VPG2J95TZVV5BN8",
 "gate":"allow","status":"stored","path":"<库路径>/notes/01M5347ZHE2VPG2J95TZVV5BN8.md",
 "details":{"chars":39,"tokens":14,"mode":"create","fingerprint":"0923b399caa13f94"}}

$ node bin/memory remember --file /tmp/pref.md --dry --json
{"ok":false,"verdict":"deny","reason":"duplicate", ...,"details":{"existing_id":"01M5347ZHE2VPG2J95TZVV5BN8"}}
```

`--dry` 走**同一条判定**，只是不落盘（否则「先 dry 看看」就是骗人的）。
拒绝是正常结果（`ok:false` + 退出码 1），可能的 `reason`：

| reason | 含义 | 怎么办 |
| --- | --- | --- |
| `duplicate` | 同 scope 下已有几乎一样的笔记（8-gram 重叠） | 用 `details.existing_id` 去更新那条 |
| `too_long` / `too_many_tokens` | 超 400 字 / 200 token | 拆成多条；或改成**更短**的重写（缩小的重写永远放行） |
| `scope_forbidden` | 跨 scope 改写别人的笔记 | 换 id 或换 scope |
| `trust_violation` / `would_promote_external_to_instruction` | 外部资料想当事实/当规则 | 补本地验证，或改 `trust` |
| `destructive_rewrite` | 重写把一条事实改成了别的东西 | 新建一条 + `supersedes`，别覆盖 |
| `skip: too_short` / `chitchat` / `no_durable_content` | 不值得记 | 正常，接着干 |

**「缩小的重写永远放行」** 是闸门的第一条规则：只要新正文不比旧的字节数多，
长度/破坏性判定全部跳过。理由不是开后门 —— 一旦库超限，如果连「改小一点」都被拒，
就再也没有任何一次写入能把它降回来，闸门会把自己锁死。

### 6. `import` —— 从旧 Engramory 库导入

```bash
$ node bin/memory import --from ~/memory/engramory --dry --json
{"ok":false,"planned":1322,"sourceFiles":72,"imported":0,"updated":0,"skipped":0,
 "denied":0,"failures":1,"fragmentsDropped":8,"fragmentsChars":12,
 "not_imported":[{"file":"reference-some-note.md","code":"E_FRONTMATTER_MISSING"}]}
```

- 先 `--dry`：**一个字都不写**，只报计划。
- 旧库是「一个主题一大篇」，这里是「一条事实一个文件」：超过 400 字的长文按
  空行 → 行 → 句末标点自动切片，一篇变多条（实测 72 篇 → 1322 条）。
- **单向只读**：永远不写源库（旧插件可能还在跑）。
- **可重入**：`legacy.source_file` + `legacy.rev` 记着来源与内容指纹，
  重跑时没变就 `skipped`、变了就 `updated`，不会把同一条事实变成两份。
- **不猜**：没有 frontmatter 的旧文件不收（给它套默认元数据等于替用户认领一句
  他没说过的话），记进 `not_imported` 让人看一眼。
- 碎片（< 8 字的行）不送闸门（否则 `denied` 里全是本来就没打算要的东西），
  但**有账**：`fragmentsDropped` / `fragmentsChars`。

### 7. `recall` —— 一步取回可用上下文

```bash
$ node bin/memory recall --query "索引上限是多少行" --budget-tokens 500
```

`search` 返回指针（id / title / score），正文还要再 `read` 一次；`recall` 是**给回答层
用的那一步**：候选过滤 → BM25 → 拒答判定 → 预算裁剪，一次返回可直接拼进上下文的正文。
四步全确定性、零模型调用。

```bash
$ node bin/memory recall --query "索引上限是多少行" --budget-tokens 500 --json
{"ok":true,"status":"ok","refused":false,"reason":null,
 "items":[{"id":"...","title":"...","content":"<正文>","kind":"semantic","trust":"user_stated",
           "scope":"user","score":{"total":0.71,"relevance":0.79,"coverage":0.29,...},
           "why":"词法命中 …"}],
 "nearest":null,"tokens":341,"chars":767,
 "budget":{"requested":500,"used":341,"maxNotes":8,"dropped":[...]},
 "split":{"pull":2,"push":0},"truncated":true,"dropped":[…],"droppedCount":1,
 "skipped":{...},"candidates":137,"thresholds":{...},"scores":[...],"diagnostics":{...}}
```

- **`refused:true` 是正常回答，不是错误**：此时 `items` 为空、`reason` 说明为什么拒
  （`top_score_below_threshold` / `only_external_low_trust` / `all_hits_expired` /
  `no_index` / `no_informative_term` / `cooccurrence_required_pair_missing`），
  `nearest` 给几条「最接近但不作为证据」的候选，供人放宽阈值，**不许自动塞进上下文**。
- `tokens` 是这次实际占用的预算，不是请求值；`budget.dropped[]` 逐条记谁被裁、
  为什么（`low_trust` / `expired` / `maxTokens` 等），`truncated` 说的是有没有裁过。
- `items[].content` 已经是正文（不是指针）；`scores[]` 保留全部候选分数，便于归因
  「是没召回，还是召回了被裁」。
- 阈值可用 `--min-relevance` / `--min-score` / `--min-coverage` 覆盖；**调参是评测纪律问题**，
  默认值不允许在跑分集上动（见 `02-evaluation.md §6`）。

#### 回执：这次判断能不能被复核

`recall` 默认只返回结果；加 `--receipt` 会把这次的完整判断过程做成一张**回执**挂到返回值的 `receipt` 字段里（不写盘），加 `--save-receipt` 则同时原子写到 `<store>/runs/<receiptId>.json`（已存在同 id 时拒绝覆盖）。

回执里**没有正文**，每一条只记 `noteSha256`（正文含标题的 sha256 前 16 位）、元数据、分数与 `why`；查询原文、阈值、`coverageGate`、拒答决定、预算裁掉了谁、被忽略的候选及原因都在。整张回执的 `hash` 覆盖除自己以外的全部字段。所以回执可以贴进 issue / 日志 / 交接件，不复制笔记正文，但能证明「当时库是这个样子、检索是这样判的」。

> 回执里还有库的绝对路径（`verify` 用它提示「库不一致」）和查询原文；贴到 issue 前先看一眼。
>
> `hash` 是**防误改**，不是签名：能写这个文件的人可以改完重算 hash。要防伪造得等签名/密钥那一层。

```bash
$ node bin/memory recall --query "索引上限是多少行" --save-receipt --json
{..., "receipt": {"schema":"tabellio.receipt/1","receiptId":"rcp_...", ...},
 "receiptPath":"/path/to/store/runs/rcp_....json"}
```

回执是**读取回执**：它证明某次 recall 的输入与判断，不改库。巩固操作的 receipt 见下一节：`--apply` 落 `runs/<run>.json`，`--undo` 落 `.undo.json`。

### 8. `explain` —— 为什么给了它 / 为什么没给

两种用法，都只读：

```bash
node bin/memory explain --query "索引上限是多少行"        # 现场跑一次 recall，解释完就丢
node bin/memory explain --receipt rcp_...                # 读已保存的回执，不重跑检索
```

`--query` 模式会现场做一次 recall（不落盘，账本也不写），返回 `mode:"query"`、`explanation` 与 `verification`；`--receipt` 模式返回 `mode:"receipt"`、该回执的解释与核验结果。`--json` 的 `explanation` 形状：

- `summary`：纳入 / 未纳入 / 预算丢弃 / 最近候选 / 被忽略候选各多少条；
- `recalled`：纳入的条目，带分数拆解与 `why`；
- `notRecalled`：未纳入的候选，`reason` 是 `below_min_relevance` / `below_min_score` / `below_min_coverage` / `cooccurrence_missing` / `unknown` 之一；
- `dropped`：进了候选但被 token 预算裁掉的条目与原因；
- `nearest`：拒答时给人类看的最近候选（不是证据，不许自动进上下文）；
- `skipped` / `coverageGate` / `thresholds`：这次判断用的闸门参数。

`explain` 不调用模型，也不重新计算分数：它解释的是回执里已经记下的那次判断。若回执被改过，`verification.status` 会是 `tampered`；若笔记正文或元数据在回执之后变了，会是 `drifted`。

### 9. `verify` —— 回执有没有被改、库有没有漂

```bash
node bin/memory verify --receipt rcp_...
node bin/memory verify --receipt runs/rcp_....json --json
```

`verify` 做两层核对：

1. **回执自身**：按 `hash` 重算，确认字段没被改过；
2. **回执与当前库**：逐条比对 `noteSha256` 与元数据（`kind` / `trust` / `scope` / `status` / `valid_from` / `valid_to` / `superseded_by`）。

`status` 有四种：

| status | 含义 | 退出码 |
|---|---|---|
| `verified` | 回执未被改，引用到的笔记正文与元数据全部一致 | 0 |
| `drifted` | 回执本身没被改，但库变了（笔记被改 / 元数据变了 / 笔记被删） | 1 |
| `tampered` | 回执文件被改过，`hash` 对不上 | 1 |
| `invalid` / `unreadable` | JSON 坏了 / schema 不认识 / 文件读不到 | 1 |

`--json` 返回 `{ok,status,receiptId,checked,itemsChecked,nearestChecked,matched,changed[],missing[],problems[]}`。`changed[]` 里带 `fields` 与 `expected` / `actual`；`missing[]` 是回执引用了、但库里已经找不到的 id。`verify` 同 `explain` 一样不重跑检索、不调模型。

### 10. `consolidate` —— 巩固：默认只出计划，改了账，能撤销

巩固是**唯一的「改」入口**，但热路径永远不调用它。当前实现两种**元数据**操作，正文一个字不改；另有三种内容类操作（merge / summarize / promote）：默认只出提案，`--apply` 才写目标（merge / summarize 还会关闭源）；`--auto` 则只自动发现近似重复、写待批准提案，不执行。见本节后半。

- `invalidate`：B 的 frontmatter 里有 `supersedes: [A]`，A 还 `active`、没有 `valid_to`、没有 `superseded_by`、
  且在 now 之前已生效 → 把 A 的 `valid_to` 写成当前时间、`superseded_by` 写成 B 的 id。**正文一个字不改**；
  历史 `as_of` 查询仍能查到 A，所以既可追溯也可撤销。
- `archive`：显式点名 `--archive <id>`（可重复，也可用逗号分隔，自动去重），把一条仍然 `active`、
  没有 `valid_to`、没有 `superseded_by`、且在 now 有效的笔记的 `status` 改成 `archived`。
  **不写 `valid_to` / `superseded_by`**，正文也一个字不改。它不依赖 `supersedes`，不是自动衰减；
  默认检索面会排除 `archived`，`as_of` 也不会把它翻回来（这一点与 invalidate 不同），
  只能用 `--undo` 恢复，或按 id 读回。

```bash
node bin/memory consolidate                       # 默认 dry-run：只打计划，不写文件、不改库
node bin/memory consolidate --json                # 计划 JSON
node bin/memory consolidate --apply               # 真改：先写计划，再改元数据，最后写回执
node bin/memory consolidate --apply --max-change-ratio 0.1
node bin/memory consolidate --scope project:... --kinds semantic,procedural
node bin/memory consolidate --archive <id>        # 只归档指定笔记，默认仍是 dry-run
node bin/memory consolidate --archive a,b --apply # 可逗号分隔；重复 --archive 会去重
node bin/memory consolidate --undo run_...        # 撤销某个 run
```

**5% 保险丝**：`allowed = max(1, floor(扫描条数 × max_change_ratio))`，默认 0.05。
invalidate 与 archive 共用这个上限，一起算；超过就整单中止，一条都不动
（小库至少允许 1 条，否则 10 条库上永远改不动）。
`--dry-run` 与 `--apply` 互斥；`--undo` 也不能和它们或 `--archive` 同用。

同一条笔记同时被 `supersedes` 和 `--archive` 点名时，invalidate 优先，archive 报 `already_planned`。
目标不存在、解析失败、非 `active`、已有 `valid_to` / `superseded_by`、在 now 尚无效，
或已被 `--scope` / `--kinds` 过滤掉（`target_out_of_scope`），都会跳过并在 `skipped[]` 里报原因。

`--json` 的主要字段：

- dry-run / aborted：`{ok,status,run_id,dry_run,operations[],skipped[],stats:{scanned,planned,invalidate,archive,allowed,change_ratio,est_tokens},options}`；
- apply 成功：`{ok,status:"applied",run_id,plan_path,receipt_path,applied,skipped,reversible:true,operations[],receipt,stats}`；
- 保险丝中止：`{ok:false,status:"aborted",reason:"change_ratio_exceeded"|"plan_write_failed"|"receipt_write_failed",...}`；
  `receipt_write_failed` 会把已经改掉的元数据回滚，并报 `rolled_back`。

每次 `--apply` 在 `runs/` 下留两个文件：`<run>.plan.json`（决策）与 `<run>.json`（巩固回执，
含前后元数据与正文 hash，**不含正文**）；撤销成功后再多一个 `<run>.undo.json`。
回执写不进去时本次 apply 视为失败并回滚 —— 「改了但没账」是不允许的状态。

`--undo` 先全量预检再动手：只要有一条笔记的正文 hash 对不上，或当前字段既不是回执里的 `before`
也不是 `after`，就整单拒绝，不做部分撤销。状态：

| status | 含义 | 退出码 |
|---|---|---|
| `undone` | 全部恢复，并写撤销记录 | 0 |
| `already_undone` | 之前撤过，本次什么都不做 | 0 |
| `conflict` | 库在 apply 之后又被改过，整单不恢复 | 1 |
| `tampered` | 回执被改过，拒绝执行 | 1 |
| `partial` / `undo_record_write_failed` | 恢复中途写失败，如实报已恢复的条目 | 1 |
| `unreadable` | run 找不到 / JSON 坏 / schema 不认识 | 1 |

archive 的 undo 只把 `status` 恢复成 `active`；它本来就没写过 `valid_to` / `superseded_by`，
所以不需要（也不应该）动这两个字段。

#### 内容类执行层：`--merge` / `--summarize` / `--promote` + `--apply`

这三种操作会新增或压缩事实，所以默认仍只出**显式源 id 的提案**：读库、出草稿，不写任何文件。
人审阅后加 `--apply` 才落盘。执行层只接受人点名的源；自动发现是另一条路径（`--auto`），
只产合并提案，批准后仍复用这里的执行层。

```bash
node bin/memory consolidate --merge <id>,<id>          # 至少 2 条；同 scope、同 kind；默认 dry-run
node bin/memory consolidate --summarize <id>           # 恰好 1 条；正文至少 200 字
node bin/memory consolidate --promote <id>,<id>,<id>   # 至少 3 条；同一 scope，valid_from 跨至少 2 个日期
node bin/memory consolidate --merge <id>,<id> --apply  # 执行：写目标 + 关闭源 + 写内容回执
node bin/memory consolidate --merge <id>,<id> --apply --max-change-ratio 1
node bin/memory consolidate --undo run_...             # 内容类 run 也用同一个入口撤销
```

- **merge**：把各源正文按段落去重后拼接，目标标题是 `# 合并：...`；目标 `status:active`、
  `requires_review:false`，`supersedes` 指回源 id。
- **summarize**：按段落取首句（每句最多 160 字），目标标题是 `# 摘要：...`；同样直接落成
  `active`。如果源本来就是一句一段，草稿不会更短，会报 `draft_not_shorter`。
- **promote**：产出「候选规则」脚手架（`## 观察` + `## 待人工归纳`），**不是规则**；
  只写 `notes/candidates/<新 id>.md`（`status:draft`、`requires_review:true`），
  **不关闭源**，批准仍走 `inbox --accept`。

merge / summarize 执行后，源笔记只改两个字段：`valid_to` 写成当前时间、`superseded_by` 写成目标 id；
**正文一个字不改**，历史 `as_of` 仍能查到源。promote 不动源，只新增一条候选。
任一源缺失、解析失败、非 `active`、已有 `valid_to` / `superseded_by`，或在 now 尚无效，整单
`source_invalid`，不会静默丢掉坏源。

**5% 保险丝按「动到多少条现有笔记」算，不按写文件次数算**：merge 的 `touched_sources` = 源数，
summarize = 1，promote = 0；`estimated_write_ops` 另算（merge 源数+1、summarize 2、promote 1）。
否则两条库上 merge 写三个文件会被算成 150%，永远过不了默认上限。超过上限整单
`change_ratio_exceeded`，一条都不写；小库用 `--max-change-ratio 1` 显式放开。

dry-run 的 `--json` 返回：
`{ok:true,status:"proposed",proposal_id,run_id,mode,dry_run:true,apply_supported:true,would_write:false,target_id,source_ids,sources,skipped,target,warnings,stats,next_action}`。
`target.body` 仍带「提案」字样，因为还没写。apply 成功返回：
`{ok:true,status:"applied",run_id,plan_path,receipt_path,target:{id,path,bucket,status,chars,tokens},sources,stats,applied,reversible:true,receipt}`。
拒绝 / 中止返回 `{ok:false,status:"rejected"|"aborted",reason,...}`；apply 的 reason 可能是
`change_ratio_exceeded`、`target_exists`、`source_changed`、`plan_write_failed`、
`target_write_failed`、`source_write_failed`（会回滚目标与已改源）、`receipt_write_failed`（回滚）。
改动率超限时 `dry_run:false`，但**不写任何文件**。

内容类 run 在 `runs/` 下留三个可能文件：`<run>.plan.json`（schema
`tabellio.consolidate.content.plan/1`）、`<run>.json`（schema `tabellio.consolidate.content/1`）、
`<run>.undo.json`（撤销记录）。回执不存正文，只存目标正文 hash、目标文件 hash、源正文 hash 与
源字段前后值；hash 是防误改，不是签名。

`--undo` 对内容类 run **先全量预检再动手**，与元数据 undo 同一入口：

- 目标全文 hash 必须等于回执里的 `target.text_sha256`，否则 `target_changed`；目标已不在则
  `target_missing`。
- 每个源正文 hash 必须是回执里的值，且当前字段必须等于回执的 `after`（或已经是 `before`，
  视为 `already_restored`）；任一冲突整单拒绝，不做部分撤销。
- 预检通过后，先把源字段恢复成 `before`，再删除目标。顺序是刻意的：即使删除失败，也不会出现
  「目标没了、源还关着」。

内容类 undo 的状态与元数据 undo 相同（`undone` / `already_undone` / `conflict` / `tampered` /
`partial` / `unreadable`），区别是 `undone` 还会 `target_deleted:true`。

**边界**：`--apply` 不能和 `--archive` / `--undo` / 其他内容模式同用；仍不接受
`--scope` / `--kinds`。这是显式选源路径，不会自动挑源；自动发现见下一小节，且只产提案。
没有 LLM 摘要（merge 是去重拼接、summarize 是抽取式首句、promote 是脚手架）。promote 的候选一旦被 `inbox --accept` 批准，候选文件会移到
`notes/candidates/decided/` 并生成一条正式 note；此时内容回执指向的候选 id 已不在候选目录，
再 `--undo` 会按 `target_missing` 拒绝。回执 hash 不是签名，能写库的人仍可改文件与回执。

#### 自动发现：`--auto` 只产提案，批准后才合并

`--auto` 解决「谁来找重复」：它扫描 active、未过期、未被取代、正文至少 40 字的笔记，
按 `scope` / `kind` / `trust` 分组，用 8-gram 字符 n-gram 的 Jaccard 相似度找近似重复。
**只写待批准提案，不改笔记、不建索引、不进检索面。**

```bash
node bin/memory consolidate --auto                  # 默认 dry-run：只报告发现了几组
node bin/memory consolidate --auto --write          # 写 runs/proposals/<proposal_id>.json
node bin/memory consolidate --auto --write --min-similarity 0.7 --max-proposals 10
node bin/memory inbox                               # 候选与自动巩固提案一起列
node bin/memory inbox --accept prop_...             # 批准：走内容类执行层合并
node bin/memory inbox --reject prop_...             # 拒绝：归档，不改库
node bin/memory consolidate --undo run_...          # 合并后可撤销
```

- 默认阈值 **0.62**，每组最多 **4 条**，每次最多 **20 组**；`--min-similarity` 取 0..1，
  `--max-proposals` 取正整数，越界退 2。
- 默认 **dry-run**；`--write` 才落提案。重复扫描同一组会复用已有提案（`existing`），
  不会重复创建；同一组的 `proposal_id` 由排序后的源 id 决定，可复现。
- 提案只写 `runs/proposals/<proposal_id>.json`（schema `tabellio.consolidate.auto.proposal/1`），
  `status` 固定 `pending`；批准/拒绝后分别移到 `runs/proposals/accepted/` 与
  `runs/proposals/rejected/`，不覆盖已有决策。
- `inbox --accept prop_...` 不是简单改状态：它先逐源比对提案里的正文 hash，源被改过就整单
  `proposal_stale`，不写任何文件；通过后调用与 `--merge --apply` 相同的内容执行层，
  写目标、把源写成 `valid_to` + `superseded_by`、写内容回执。因为人已经逐条看过固定清单，
  批准路径显式把 5% 保险丝放开为 `maxChangeRatio:1`；执行层的 hash、字段与目标检查一条不少。
- 候选 id 与提案 id 可以在同一次 `inbox` 调用里混批；`--dry` 只返回 `planned`。
- `--auto` 与 `--apply` / `--dry-run` / `--merge` / `--summarize` / `--promote` /
  `--archive` / `--undo` / `--scope` / `--kinds` 互斥。
- **边界**：只做 merge 近似重复，不做自动 summarize / promote，不自动执行；相似度是字面
  8-gram，不是语义模型，跨语言或改写较大的重复会漏。默认没有定时触发——要么显式跑
  `consolidate --auto`，要么用下一节的 Claude 钩子 `--auto-consolidate`，要么在 macOS 上装
  §15 的 launchd 定时任务；三者都只产提案，不自动批准。

**还没做**：replay、forget、写入回执、自动执行/自动巩固、`diff.jsonl`；
自动发现本身已可用（显式 `--auto`、Claude 钩子或 macOS launchd 定时任务触发），但只产提案、执行仍要人批准。

### 11. `setup` —— 一条命令给宿主写 MCP 配置

```bash
$ node bin/memory setup                          # 默认 dry-run：只打印会改哪些文件
$ node bin/memory setup --write                  # 真写；写前备份
$ node bin/memory setup --write --verify         # 写完用宿主自己的命令验证
$ node bin/memory setup --verify                 # 只验证现状，不改配置
$ node bin/memory setup --host cursor --read-only --write
```

支持三家，路径固定：

| host | 文件 | 写法 |
| --- | --- | --- |
| `claude` | `~/.claude.json` | 顶层 `mcpServers.tabellio` |
| `cursor` | `~/.cursor/mcp.json` | 顶层 `mcpServers.tabellio` |
| `codex` | `~/.codex/config.toml` | `[mcp_servers.tabellio]` 段 |

- `--host` 可重复/逗号分隔，默认 `all`。`all` 只处理**已安装**的宿主（配置文件或父目录存在）；显式点名可以创建不存在的文件。一个都没检测到返回 `no_host_detected`，退 1。
- 生成的 server 是 `{command: <当前 node>, args: [<bin/memory-mcp 绝对路径>, "--store", <库路径>, "--allow-write"]}`；不依赖 PATH，宿主从任意目录都能起。`--read-only` 去掉 `--allow-write`。
- **默认 dry-run**；`--write` 才落盘。JSON 原子写，TOML 只替换 `[mcp_servers.tabellio]` 及其子表，其他段和注释保留。
- 写入前备份成 `<文件>.tabellio-backup-<紧凑 ISO 时间戳>`；已经是同一份配置则 `unchanged`，不重复备份。
- 已有**不同**的 `tabellio` 配置：默认整单 `conflict`、一份都不写；`--force` 才覆盖。JSON/TOML 解析失败也是整单 `invalid_config`，不写半份。
- 退出码：成功/已存在 0；冲突、无宿主、解析失败、写失败、`--verify` 明确失败 1；参数缺值 2。

`--json` 的计划里有 `{ok, reason, dry_run:true, hosts:[{host,label,path,kind,action,ok,exists,current,desired,read_only,would_write,backup}], server, store, mcp_bin, command}`；`action` 是 `create|append|update|unchanged|conflict|invalid`。**没有 `preview`**：计划内部用完整文件文本落盘，但宿主配置可能含 `env` 凭据，所以它不参与 JSON 序列化。`--write` 后额外有 `{dry_run:false, applied:[{host,path,action,written,backup}], failed:[]}`。

**`--verify`：让宿主自己回答「连上了吗」**

配置写对不等于宿主连上。

- Claude Code：跑 `claude mcp list`，只有宿主输出 `✓ Connected` 才是 `connected`；报 `Failed to connect` 是 `failed`。
- Codex：跑 `codex mcp list`，看到 `tabellio ... enabled` 只算 `configured`——这条命令不 spawn server，不能冒充「已连接」。
- Cursor：没有无头 MCP 健康检查，固定报 `unverified`，请到 Cursor 的 MCP 设置里确认。
- 宿主 CLI 没装/不在 PATH：`unavailable`，**不算配置失败**，退出码仍是 0。
- `failed` / `missing` 才让退出码变 1；`--verify` 失败**不会回滚**已经写入的配置。
- 验证时用配置文件的临时副本（Claude Code 的 `mcp list` 会写备份），不碰用户的真实配置。

JSON 里额外多出：

```json
{
  "verification": {
    "ok": true,
    "checked": 1,
    "hosts": [
      {
        "host": "claude",
        "label": "Claude Code",
        "config_path": "~/.claude.json",
        "level": "connected",
        "ok": true,
        "detail": "claude mcp list：✓ Connected",
        "binary": "/opt/homebrew/bin/claude",
        "connection_checked": true
      }
    ]
  }
}
```

`level` 取值：`connected` / `configured` / `unverified` / `unavailable` / `failed` / `missing`。

> DSH 的 `~/.dsh/cordis.patch.yml` 是 YAML loader patch，零依赖改写的风险高于收益，`setup` 不碰它；要接 DSH 请按 `docs/03` 手工加片段。

### 12. `capture` —— 把线索收成候选（不静默入库）

```bash
$ printf '%s\n' '# 发布流程' '' '发版前跑 npm test 和 node bench/run-eval.mjs。' \
  | node bin/memory capture --file - --source "session:2026-10-18" --json
{"ok":true,"id":"01M...","title":"发布流程","created":"2026-10-18T...","source":"session:2026-10-18",
 "chars":38,"kind":"semantic","trust":"system_derived","scope":"user",
 "path":"<库>/notes/candidates/01M....md","written":true}
```

- `--file <path|->` 必填，`-` 从 stdin 读。`--source` 记进 `provenance.source_ref`，`--kind` / `--tags` / `--id` 可覆盖默认值；`--dry` 走同一套检查但不落盘；`--force` 跳过重复检查。
- 候选强制 `status:draft`、`trust:system_derived`、`provenance.written_by:capture:cli`——输入里写 `active` / `user_stated` 也不会改变这个身份。**不重建主索引**，默认检索面看不到它。
- 正文上限 **8KB**；空文本、非法 id、主库或候选里已有同 id、内容指纹重复都会拒（重复可用 `--force` 绕过；`id_exists` 不行）。拒绝是正常结果，`ok:false` + 退 1；参数缺值退 2。
- `reason` 固定为 `empty|too_large|invalid_id|id_exists|duplicate|store_write_failed`；重复时附 `duplicate_of:{id,kind}`。
- **它本身不监听会话**：`capture` 是显式原语，宿主或脚本要自己调用。自动候选来自下一节的 `hook install`——只支持 Claude Code、默认不装、只抓用户发言里的显式线索，且只写候选。

### 13. `inbox` —— 人批准后才进主库

```bash
$ node bin/memory inbox                          # 只读列表：候选 + 自动巩固提案
候选 2 条（notes/candidates，默认不进检索面）：
  [01M...] 发布流程 — session:2026-10-18 / 38 字 / 2026-10-18T...
自动巩固提案 1 条（runs/proposals，未批准不进检索面）：
  [prop_...] 2 条近似笔记 / 相似度 0.79 / 预计省 120 token
批准：tabellio inbox --accept <id>   拒绝：--reject <id>

$ node bin/memory inbox --accept 01M... --json    # 候选：走 remember 同一条闸门
$ node bin/memory inbox --accept prop_... --json  # 提案：走内容类执行层合并
$ node bin/memory inbox --reject prop_...,01N... --dry  # 两类 id 可混批，只预览
```

**候选**与**自动巩固提案**共用这个闸门，但批准后的动作不同：

- 不带 `--accept` / `--reject` 时只读列出两类待办，各按创建时间倒序。JSON 是
  `{ok:true,count,candidates:[...],proposal_count,proposals:[...],proposal_failures}`；
  提案字段是 `{id,mode,created,source_count,source_ids,source_titles,similarity,target_id,estimated_saved_tokens,estimated_saved_chars,warnings}`。
- `--accept` / `--reject` 可重复或逗号分隔；同一 id 同时出现在两边时整单拒绝
  （`accept_reject_overlap`）。`prop_` 前缀的 id 走提案，其余走候选，可在同一次调用里混批。
- **批准候选**：把候选改成 `active`，走与 `remember` **同一条写入闸门**
  （去重/400 字/200 token/信任分级），通过后写 `notes/<id>.md`、候选移到
  `notes/candidates/decided/`；拒绝只移到 `notes/candidates/rejected/`。两边都保留审计，不删文件。
- **批准提案**：先逐源比对提案里的正文 hash，任一源被改过就整单 `proposal_stale`，
  不写任何文件；通过后调用内容类执行层写合并目标、把源写成 `valid_to` +
  `superseded_by`、写内容回执，提案移到 `runs/proposals/accepted/`。返回里有
  `run_id` / `receipt_path` / `target`，可用 `consolidate --undo run_...` 撤销。
  因为人已逐条看过固定清单，批准路径把 5% 保险丝显式放开为 `maxChangeRatio:1`；
  执行层自己的检查不变。拒绝只把提案移到 `runs/proposals/rejected/`，不动笔记。
- 批量里的失败**不中断**其余项；只要有失败就 `ok:false`、退 1，并在 `failed` 里给
  `{id,action,reason,details?,note_stored?}`。`note_stored:true` 表示「笔记已入库，但候选归档失败」，
  重试会走出覆盖更新，不会产生第二份。
- `--dry` 只返回 `planned`：候选不写 note、不移文件；提案不合并、不移文件。
- 合并结果的 JSON 是 `{ok,dry_run,accepted,rejected,failed,accepted_count,rejected_count,failed_count}`；
  候选 `accepted[]` 的 `status` 是 `stored|planned`，提案是 `applied|planned` 并带
  `run_id` / `receipt_path`；`rejected[]` 是 `rejected|planned`。
- 索引只在真有候选批准写入时重建一次；只拒绝或只处理提案不重建。`status` 的「候选」
  「提案」计数与对应警告读的就是这两个目录。

### 14. `hook` —— Claude Code 会话结束时生成候选、会话开始时提示待批准（默认不装）

```bash
$ node bin/memory hook install --host claude            # 默认 dry-run：只打印会改哪个文件
$ node bin/memory hook install --host claude --write    # 写入 ~/.claude/settings.json（只装 SessionEnd）
$ node bin/memory hook install --host claude --session-start --write  # 再加 SessionStart 待批准提示
$ node bin/memory hook install --host claude --auto-consolidate --write  # 再加自动发现提案（隐含 SessionStart）
$ node bin/memory hook uninstall --host claude --write  # 移除 tabellio 自己的两个钩子
```

它解决的是「每次都要用户提醒它沉淀」：Claude Code 退出/结束时，宿主把 `SessionEnd` 事件
（含 `transcript_path`）交给 `tabellio hook claude-session-end`，后者从**本次会话的用户发言**
里找显式线索，生成候选。**不写正式库**，批准仍在 `inbox`。

加 `--auto-consolidate` 时，SessionEnd 在收完候选后再跑一次 `consolidate --auto` 的扫描，
把近似重复写成 `runs/proposals/` 的待批准提案；同样**不改笔记**，批准后才走内容类执行层。
它隐含 `--session-start`——否则新提案没人提示。

`--session-start` 是可选的通知环：下次会话开始时，宿主调用
`tabellio hook claude-session-start`，它**只读**候选数与自动巩固提案数，把「有 N 条候选、
M 条提案待确认，用 `tabellio inbox` 查看」注入会话上下文。不写库、不批准、不删除，
也不改变批准权。

- **只支持 Claude Code**（本机 2.1.142 实测）。Cursor 没有等价的无头会话结束钩子，Codex 也没有；
  不伪造支持，装其他宿主会退 1。
- **默认不装、默认 dry-run**；默认只改 `<home>/.claude/settings.json` 的 `hooks.SessionEnd`，
  加 `--session-start` 才同时写 `hooks.SessionStart`；`--auto-consolidate` 也会写它。
保留用户的其他钩子、`env` 和其他字段。写前备份成
  `settings.json.tabellio-backup-<紧凑 ISO 时间戳>`；JSON 原子写；新文件 mode `0600`。
- 钩子用 exec form：`{type:"command", command:<当前 node>, args:[<bin/memory>, "hook",
  "claude-session-end" | "claude-session-start", "--store", <库>], timeout:15}`。
  不依赖 shell 引号，也不依赖 PATH。
- 已有指向**别的 store**的 tabellio 钩子时默认 `conflict`、一份不写；确认替换加 `--force`。
  坏 JSON / 不认识的 `hooks.SessionEnd` / `hooks.SessionStart` 结构整份不写。
- `uninstall` 会同时清掉两个事件里的 tabellio 钩子；用户自己的 SessionStart 钩子保留。
  关闭 `--auto-consolidate` 只把 SessionEnd 改回不带该参数的命令，**不删除**已装的
  SessionStart——已经产生的提案还需要提示；要彻底移除用 `uninstall`。
- `--json` 输出计划/结果；**不会输出整份 settings**（里面可能有宿主 env 凭据）。
  `action` 取值：`create|append|update|unchanged|uninstall|conflict|invalid|unsupported`。

**抓什么、不抓什么**

- 只读 `transcript_path` 指向的当前会话 JSONL；只取 `type:"user"`、`message.role:"user"`、
  非 sidechain / meta / compact-summary 的真实用户文本；跳过 `tool_result`、队列事件和
  `<system-reminder>` / 本地命令注入。
- 只抓**显式线索**：`记住/帮我记/别忘了`、`以后/今后都…`、`我/我们 + 喜欢/偏好/习惯/讨厌`、
  `我/我们 + 决定/约定/说好`、`始终/总是/一律/默认 + 用/按/不要`、`改用/别再/不要用`，
  以及英文 `remember / from now on / I prefer / we decided / please always / never`。
- 跳过问句和假设句（「要不要」「是否」「吗」）、太短的句子，以及命中密钥模式的整句
  （`sk-…`、`ghp_…`、`AKIA…`、私钥、Bearer、`password/token/密码: …` 等）。
  这是**尽力而为的过滤，不是 DLP**；候选里仍可能有敏感内容，装之前先想清楚。
- 每会话最多 **3 条**；同一句去重；候选正文带一个 `# 会话记忆：…` 标题，正文是原句。
  `source` 为 `claude:session-end:<session_id>`，`written_by` 为 `capture:hook`。
- 不调用模型、不联网、不做摘要、不自动合并；漏报和误报都会有。它只负责把候选放进
  `notes/candidates/`，不重建主索引。

**内部命令与失败语义**

两个内部命令都是给宿主调用的，不面向日常使用：

- `tabellio hook claude-session-end`：从 stdin 读 `SessionEnd` 事件，读 transcript、生成候选；
  带 `--auto-consolidate` 时再扫描一次近似重复、只写提案。只有 `--json` 才输出调试结果，
  默认静默。自动发现失败只记在 `proposal_error`，不阻塞已收候选，命令仍退 0。
- `tabellio hook claude-session-start`：从 stdin 读 `SessionStart` 事件；候选数与提案数
  任一 > 0 时向 stdout 输出 Claude 的 hook 协议 JSON
  （`hookSpecificOutput.hookEventName=SessionStart` + `additionalContext`），都为 0 时静默。
  **只读计数**，不写库、不改变候选或提案状态。
- 事件坏、没有 `transcript_path`、文件不存在/读不了、库读不了：`ok:false` + `reason`，
  **始终退 0**——钩子不能阻塞宿主退出或开始；用法错误才退 2。
- 有候选时才打开库并逐条 `addCandidate`；重复/超长是正常 `rejected`，不算命令失败。
- 安装/卸载的退出码：成功/dry-run/`unchanged` 0；冲突、坏配置、写失败、未知宿主 1；参数缺值 2。

**真实宿主证据**

`test/hook-claude-e2e.test.mjs` 用真实 `claude`（`TABELLIO_HOOK_E2E=1` 才跑）在临时
`settings.json` 上验证：钩子被调用、exec form 被接受、候选落盘、主库 `notes=0`；
SessionStart 用一条并排的 marker 钩子证明宿主确实触发了事件，并确认提示没有写库。
本机在 Claude Code 2.1.142 的 `-p` 会话里实测通过（未登录时 API 会报错，但两个事件
仍触发——这恰好说明钩子不依赖模型回答）。**不能**用无头测试证明 additionalContext
真的被模型看到——那需要已登录会话，不伪造。测试不碰真实 `~/.claude/settings.json`。

**边界**

只有 Claude Code；钩子本身没有定时/常驻触发（要定时见 §15 的 macOS launchd），没有跨会话批量重放；`--auto-consolidate` 只在
SessionEnd 时扫描一次、只产提案，不会自动执行合并；它不是「自动记住一切」，
只是把「会话结束该问要不要记」变成候选箱里的一条待审记录，并在下次会话开始时提醒一次。
提示只在候选数 > 0 时出现，不是每次会话都打扰；卸载只移除 tabellio 的钩子，不删候选、
不删已有记忆。

### 15. `schedule` —— macOS launchd 定时自动发现（只产提案）

```bash
node bin/memory schedule status                  # 只读：文件在不在、launchd 里有没有加载
node bin/memory schedule install                 # 默认 dry-run：只打印会写什么
node bin/memory schedule install --write         # 写 plist 并加载；默认每 6 小时
node bin/memory schedule install --write --interval 12h
node bin/memory schedule install --write --force # 已有不同配置时替换（先备份）
node bin/memory schedule uninstall               # 默认 dry-run
node bin/memory schedule uninstall --write       # 从 launchd 卸载并删除 plist
```

它解决「谁定期来找重复」：不用常驻进程，也不要求用户记得敲命令。macOS 的 launchd
到点叫醒一次 `tabellio consolidate --auto --write`，跑完就退出。**它只写
`runs/proposals/` 的待批准提案，不合并、不批准、不写正式笔记、不重建索引。**

- **只支持 macOS**。launchd 的 `gui/<uid>` 会话、plist 位置和 `launchctl` 语义不能
  假装搬到 Linux/Windows；其他平台 `schedule status` 返回 `supported:false`，
  `install` 退 1。Linux 可先用 cron 手动跑同一条命令。
- **间隔**：默认 **360 分钟（6 小时）**，范围 **15 分钟–7 天**；写法 `30m` / `6h` /
  `1d` / 裸数字（按分钟算）。越界或格式错退 2。
- **写什么**：`~/Library/LaunchAgents/io.github.yffo.tabellio.sweep.plist`。
  `RunAtLoad=false`，`StartInterval` 是秒数；日志重定向到
  `~/Library/Logs/tabellio/sweep.log` 与 `sweep.err.log`；`WorkingDirectory` 是
  home。命令使用当前 Node 与 `bin/memory` 的**绝对路径**，不依赖 shell 的 PATH。
- **默认 dry-run**：不加 `--write` 只返回计划，不写 plist、不调用 `launchctl`。
  `--write` 时先建日志目录（0700），临时文件 + rename 原子写 plist（0644），
  执行 `launchctl bootout gui/<uid>/<label>` 再 `launchctl bootstrap gui/<uid> <plist>`。
  update 会先把旧 plist 备份成 `.tabellio-backup-<时间戳>`。
- **加载失败不回滚文件**：如果 plist 已写但 `bootstrap` 失败（比如没有 GUI 会话），
  命令退 1，并明确说「plist 已写入，但没有加载」；文件保留，可在桌面会话里重试。
  `schedule status` 区分「已安装」与「已加载」，不会把文件存在当成任务在跑。
- **冲突**：已有指向别的 store 或别的参数的 tabellio plist 时默认 `conflict`，不写；
  `--force` 才备份并替换。它只碰自己的 label，不删、不改用户别的 LaunchAgent。
- **卸载**：`schedule uninstall --write` 先 `bootout` 再删除 plist；本来没装则
  `unchanged` 退 0。dry-run 不碰 launchctl。
- **状态**：`schedule status` 只读；从 plist 解析间隔与 `--store`，用
  `launchctl print gui/<uid>/<label>` 判断是否加载。`launchctl` 不可用时
  `checked:false` + `error:'launchctl_unavailable'`，不伪造「已加载」。
- **边界**：不是常驻 daemon，没有「错过的每一次都补跑」；`StartInterval` 是间隔
  不是日历，机器睡眠/关机期间不会运行，唤醒后由 launchd 决定下一次。Node 被 nvm
  挪走后任务会失败，`schedule status` 会显示未加载；重装即可。它仍只产提案，
  **不会自动批准或自动执行合并**；批准入口始终是 `inbox`。
- **JSON 形状**（开发用）：install dry-run 返回
  `{ok,platform,label,action,path,interval_minutes,program_arguments,preview,dry_run:true}`；
  `--write` 追加 `{written,loaded,backup?}`；uninstall dry-run 返回
  `{action:'uninstall',path,removed:true,dry_run:true}`；status 返回
  `{supported,installed,loaded,checked,path,interval_minutes,store}`。`preview` 是完整 plist。
- **退出码**：成功 / dry-run / `unchanged` 0；平台不支持、冲突、写失败、加载失败 1；
  参数缺值或非法退 2。

**真实证据**：`test/schedule-launchd-e2e.test.mjs` 在 macOS 上（`TABELLIO_SCHEDULE_E2E=1`
才跑）用临时 HOME、唯一 label 与临时 store 执行 plan → apply → status，断言
`launchctl print` 能看到任务已加载，最后在 `finally` 里卸载；实测通过且
`~/Library/LaunchAgents` 无残留。单元测试用可注入的 `run` 覆盖 apply 顺序、
冲突、加载失败、卸载与 XML 转义，不依赖真实 launchd。

### 16. `doctor` —— 只读体检，不替你修

```bash
node bin/memory doctor                     # 人读报告
node bin/memory doctor --json              # 机器可读（形状见下）
node bin/memory doctor --verify            # 额外让宿主 CLI 自查连接（Claude 才会真连）
```

它回答「现在到底哪一环没接上」，不要求你先读一堆文档：

- **库**：有没有内容、核心档条数、索引是否生成/陈旧、解析失败数、超长条数、待批准候选/提案数。
- **宿主**：检测到哪些宿主；每个宿主的 MCP 配置是已配置、待写、冲突还是读不了；还会检查配置里的 Node 与 MCP 入口绝对路径是否还在（nvm 升级/仓库搬走后常见），不存在时是 `error`，不让 `unchanged` 伪装健康。不会输出配置正文。
- **Claude 钩子**：SessionEnd / SessionStart / `--auto-consolidate` 各自装没装，是否与当前 bin/store 匹配。
- **定时发现**：plist 在不在、launchd 加载没有；`launchctl` 不可用时只说无法确认，不猜。
- **建议**：按 `error` / `warn` / `info` 列出要处理的事和可直接复制的下一步命令。

**只读**：不 `ensure`、不重建索引、不写宿主配置、不写提案、不批准候选。空库跑完仍然没有目录；只有 `--verify` 会调用宿主 CLI（用配置临时副本，见 §11 的 `--verify`），而且只在该宿主的配置已经指向当前 bin/store 时才真正验证——否则宿主验的是旧配置，`connected` 会误导。

**退出码**：没有 `error` 级问题退 0（待批准候选、索引陈旧、未装钩子都只是 warn/info，不会让脚本失败）；库解析失败、宿主配置冲突/损坏、配置里的 Node/MCP 入口不存在、钩子或 plist 读不了退 1；`--home` 等参数缺值退 2。

**JSON 形状**（开发用）：

```json
{
  "ok": true,
  "store": {"path":"…","exists":true,"notes":12,"core":2,"index_exists":true,"index_stale":false,
            "parse_failures":0,"failures":[],"oversize_chars":0,"oversize_tokens":0,"candidates":1,"proposals":0},
  "hosts": {"detected":["claude"],"items":[{"host":"claude","action":"unchanged","ok":true,
            "checks":{"command":"…","command_exists":true,"mcp_bin":"…","mcp_bin_exists":true}}],
            "setup_ok":true,"setup_reason":null},
  "hook": {"ok":true,"session_end":true,"session_start":false,"auto_consolidate":false,"matches_current":true},
  "schedule": {"ok":true,"supported":true,"installed":false,"loaded":false,"checked":false},
  "actions": [{"id":"inbox:pending","severity":"warn","title":"…","detail":"…","command":"tabellio inbox"}]
}
```

`hosts.items` 不包含 `preview` / 配置正文；`--verify` 时多一个 `hosts.verification`，沿用 `connected` / `configured` / `unverified` / `unavailable` / `failed` / `missing` 六级。**边界**：它不是修复器，也不会替你看 Cursor 的 GUI；`setup` / `hook install` / `schedule install` 仍要你确认后自己跑。

### 17. `health` —— 最近用得怎么样

```bash
node bin/memory health                 # 最近 7 天
node bin/memory health --days 30       # 换窗口
node bin/memory health --json          # 机器读（趋势脚本用这个）
```

它只做一件事：把散在 `runs/*.jsonl` 里的使用证据聚合成一张表，让「要不要调参、哪条路在浪费」
用数字回答。零模型、只读、不写任何文件。

```text
tabellio health — 最近 7 天（2026-10-19 → 2026-10-26）
库：/Users/you/memory/tabellio
规模：1414 条笔记（窗口内新增 620）· 候选待批 0 · 解析失败 0
召回：200 次 → 注入 105（53%）· 意图闸拦 68 · 拒答 11 · 裁决丢弃 14
注入：每次 2.54 条 · 760 字（p90 1234，≈380 token）
延迟：p50 1583ms · p90 3235ms · 慢轮(≥1.5s) 64/105 · 冷启动(≥2s) 34
judge：窗口内调用 11 次 · p50 1864ms · 语义命中 47 轮
反馈：3 条（corrected 3）
```

口径（读之前先知道，免得拿数字下错判断）：

- **召回审计来自宿主插件**（`runs/recall-audit-YYYY-MM.jsonl`）；CLI 单独用、没有插件的库
  只有规模/候选/反馈，其余整块缺席并在 `warnings` 里说明。缺日志就写缺，不编 0。
- **延迟只统计真正注入了记忆的轮次**：被意图闸/拒答挡掉的轮次本来就快，混在一起会把
  中位数稀释得好看但没用。
- **token 是估算**：审计只记注入块字符数，按中文约 2 字/token 折算。
- **窗口内新增**按文件 mtime 或 `valid_from` 判断，导入会一次性抬高这个数，不是「日常写入」。
- `judge` 的调用次数来自 `runs/usage.jsonl`；`语义命中` 是开了语义补充的轮次。

JSON 形状（窗口、六个分组、`warnings` 字符串数组）：

```json
{
  "store": "…", "generatedAt": 0, "window": {"days": 7, "since": 0, "until": 0},
  "notes": {"total": 0, "added": 0, "candidates": 0, "parseFailures": 0, "bytes": 0},
  "recall": {"turns": 0, "injected": 0, "suppressed": 0, "refused": 0, "judgedOut": 0,
             "notice": 0, "deduped": 0, "other": 0, "injectRate": 0},
  "injection": {"notesMean": 0, "charsP50": 0, "charsP90": 0, "charsMax": 0,
                "tokensApproxP50": 0, "tokensApproxP90": 0},
  "latency": {"samples": 0, "p50": 0, "p90": 0, "max": 0, "slow": 0, "slowRate": 0, "cold": 0},
  "judge": {"calls": 0, "msP50": 0, "msP90": 0, "semanticTurns": 0},
  "feedback": {"total": 0, "bySignal": {}},
  "warnings": []
}
```

退出码：0；库里有解析失败时退 1（和 `status` 一致，让 CI/脚本能发现）。它是**观察器**，
不修库、不重建索引、不调模型——修复仍走 `doctor` 给的建议命令。

## 评测（开发用，可零模型）


```bash
node bench/run-eval.mjs --same-corpus            # 判据 1：三臂同语料，零模型
node bench/run-eval.mjs --dry                    # 只验评分路径，不调 CLI
node bench/judge-adversarial.mjs                 # 判分器对抗集 106 条，零模型
```

- 判据 1 用默认的 `echo` 回答器即可；判据 2/3 的回答层必须显式加 `--answerer llm` 并提供
  `EVAL_LLM_API_KEY` 或 `DEEPSEEK_API_KEY`，结果不进 CI。
- 判分器支持题级 `answer_aliases`（原 32 道可答题已补）；对抗集用来确认它「该收的收、该拒的拒」，
  通过门槛是误收率 < 20%、正确接受率 ≥ 95%。详细口径见 `docs/02-evaluation.md §4.6.2` 与
  `docs/08-eval-runbook.md §6.4`。
- 题集 56 题已标 `capability`（六类），其中 4 道 `negative_transfer` 陷阱题带 `negative_transfer_probe`；
  `run-eval` 会按能力分表并报 `trap_fall_rate`。零模型 `echo` 口径当前 4 题里 1 题落入（0.25，压线），真模型回答层是 0/4；分母太小，只当方向。
- 2026-10-18 修正注入计量后用真实模型重测（56 题 / deepseek-flash / 3 轮，top-5）：acc closed_book **0.357** / real **0.786** / oracle **0.893**；`negative_transfer = −0.429`；实际注入 **166.2 token/题**，回答层 `token_efficiency = 2.579`，**判据 2 成立**。报告 `bench/core-30-v1/runs/2026-10-18-answer-56-k5.md`。`--inject-k 2` 裁到 top-2 后 real **0.792** / 注入 **70.3** / 效率 **6.182**，报告 `bench/core-30-v1/runs/2026-10-18-answer-56-k2.md`，是更省的运行点；默认仍 top-5。旧 1.611 是把 CLI top-8 候选预算当实际注入的计量错误，已作废；1.408 是补别名前 52 题下界。

## MCP（给 Agent 用）

```bash
node bin/memory-mcp --store ~/memory/tabellio                  # 只读
node bin/memory-mcp --store ~/memory/tabellio --allow-write
```

stdio、一行一个 JSON-RPC 消息、stdout 只有协议字节（日志走 stderr）。
同时实现两代协议：**现代** `server/discover`（2026-07-28，无握手、无会话）与
**传统** `initialize`（2025-11-25）。两代客户端都能连。

```bash
$ printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"server/discover"}' \
                '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node bin/memory-mcp | python3 -c 'import json,sys
for l in sys.stdin:
    d=json.loads(l)
    if d.get("id")==2: print([t["name"] for t in d["result"]["tools"]])'
['recall', 'search', 'read', 'list', 'status']
```

- 工具面：`recall` / `search` / `read` / `list` / `status`（默认只读，五个都带
  `annotations.readOnlyHint:true`）；加 `--allow-write` 才多出 `remember` 与 `capture`
  （共 7 条，仍在「5±2」预算内）。
- `recall` 是给 agent 的主读接口：一次调用返回预算内的**记忆正文**（不是指针），
  默认 500 token，可传 `budget_tokens`；证据不足时 `refused:true`、`items:[]`，
  仍是正常返回，不是错误。文本结果里有每条的 id / kind / trust 和正文；
  `structuredContent` 里只放元数据（不重复正文），避免宿主把同一段内容算两遍 token。
  要审计分数或拿单篇完整正文，再用 `search` + `read`。
- `remember` 直接写正式记忆；`capture` **只写候选**，不重建主索引、不进检索面，
  返回候选 id 并提示人运行 `tabellio inbox` 批准。Agent 可以主动丢候选，但批准权不交给它。
- `search` 只回指针（不含 `body`），正文用 `read` 取 —— 与 CLI 同一套语义。
- `list` 用 `limit` + `cursor` 翻页，`structuredContent` 回 `{items, total, next_cursor}`，
  正文里还会写一句人话「共 N 条，本次 M 条，下一页 cursor=…」。
  **游标由服务端给**（就是「下一条的 id」）：宿主会截断大 payload，所以「还剩多少、
  下一页从哪开始」必须由我们说，不能靠客户端自己数。没有 `next_cursor` 就是到头了。
- 参数不合规（缺 `query`、id 越界）返回 `result.isError:true`，不是 JSON-RPC 错误 ——
  协议错误会让客户端重试或放弃，工具错误才是「这次调用没成功」。

## 库的布局

```
<store>/
  notes/<id>.md              # 唯一真相源（手写、git 管、备份都只针对它）
  notes/candidates/          # 待审的候选（不参与默认检索）
  index/MEMORY.md            # 生成物：路由层，一行一个主题组（受 200 行 / 25KB 限制）
  index/MEMORY.md.bak        # 上一次的索引
  index/groups/<序号>-<组名>.md  # 生成物：清单层，一组一行指针（每文件 ≤ 400 行，超过分页不截断）
  index/stats.json           # 上次扫描的统计（读不完/解析不了的东西都在这）
  index/ledger.jsonl         # 追加型事件账本（写入/跳过/拒绝/索引闸门）
  runs/                      # recall 回执 runs/rcp_....json；巩固 run 的 .plan.json / .json / .undo.json
```

`index/` 全是 `notes/` 的纯函数：删掉它只损失时间，不损失事实。

```bash
rm -rf ~/memory/tabellio/index && node bin/memory status --rebuild-index
```

**组是什么**：笔记 id 里第一个 `#` 之前的部分（`reference-x#137` → 组 `reference-x`）。
真实库 1321 篇落在 72 个组里，所以路由层 72 行就装得下 —— 一行一个组、
一行一条笔记的旧形态装不下 1321 条。为什么按 id 而不是按 `kind`/`tag`：`kind` 只有
4 个组、每组几百条，路由层装得下但清单层一个文件装不下，等于把问题往下推一层；
id 前缀是人写文件时形成的天然主题，组数与组内条数都在「人扫得动」的量级。

## 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 成功（拒绝也是成功的回答 —— `search` 的 `refused`、`remember` 的 `deny`、`inbox --reject` 的成功拒绝都算；`setup` 的 dry-run / `unchanged`、`doctor` 没有 `error` 级问题、`hook` 的 dry-run / `unchanged`、内部 SessionEnd / SessionStart 命令的错误也都算） |
| 1 | 判定拒绝 / 库不健康 / 回执或巩固失败（`read` 找不到、`remember` deny、`capture` 拒收、`inbox` 有失败项、`index` 有笔记走不到或 `stale`、`verify` 不是 `verified`、`recall --save-receipt` 落盘失败、`consolidate` 中止或 `undo` 冲突/被篡改、`setup` 冲突/无宿主/解析失败、`doctor` 发现解析失败/宿主冲突/钩子或 plist 读不了、`hook install` 冲突/坏配置/未知宿主） |
| 2 | 用法错误（缺参数、命令不认识） |

`remember --json` 的 `ok` 与退出码一致：脚本里既可以读 JSON，也可以直接 `if`。
`explain` 只要回执/查询能解析就退 0（漂移写在 `verification` 里）；参数互斥或缺失才是 2。`verify` 只有 `verified` 退 0，`drifted` / `tampered` / `unreadable` 一律 1 —— 这样 CI 里 `verify` 可以直接当断言用。
`index` 是**唯一**「状态正常但退出码可能非 0」的命令：`ok:true` 说的是「这次查询本身
成功了」，退出码说的是「索引健康吗」—— 这两件事分开表达是有意的，不然 CI 会把
一个瞎掉的索引当绿的。
