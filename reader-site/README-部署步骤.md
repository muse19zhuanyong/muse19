# 在线朗读工作台（公开版）· 部署步骤

> 架构照 muse6 盘前站：Cloudflare Pages 托管静态前端（public/），Cloudflare Functions 跑服务端接口（functions/）。
> 网站完全公开：任何人打开链接就能用脚本提取、清洗和 Edge 朗读；
> Fish 朗读和小兵精炼这两个花额度的功能要输访问口令才能用（口令在服务端校验，前端只在本次会话里暂存）。

## 一、目录说明

本站代码在仓库里放一个子目录 `reader-site/`，结构如下：

```
reader-site/
  public/
    index.html     首页（全部界面）
    app.js         前端逻辑：本地解析文件、清洗、脚本提取、数字校验、逐句播放器
    style.css      样式
  functions/
    _lib/gate.js   口令校验（Fish 与小兵共用）
    api/health.js  GET /api/health，只返回各功能是否已配置（布尔值）
    api/tts.js     POST /api/tts，Fish 合成（需口令）
    api/refine.js  POST /api/refine，小兵精炼（需口令，三选一）
  README-部署步骤.md  本文件
```

注意：包里不含任何密钥、口令和真实数据。所有密钥只填 Cloudflare 环境变量，绝不写进代码、仓库和聊天记录。

## 二、从零上线，4 步

### 第 1 步：推到你自己的 GitHub 仓库

把 `reader-site/` 整个目录推到你自己的仓库（放根目录下的子目录即可）。不要去改别人的仓库。

### 第 2 步：Cloudflare Pages 建站

Cloudflare Pages → Create → Pages → Connect to Git，选上一步的仓库，构建设置照抄：

- Production branch：`main`
- Root directory：`reader-site`
- Framework preset：None
- Build command：留空
- Build output directory：`public`

### 第 3 步：填环境变量（Settings → Variables and Secrets）

| 变量名 | 必填 | 说明 |
|---|---|---|
| `ACCESS_PASSWORD` | **必填** | Fish / 小兵的访问口令，自己定一个。不填的话这两个功能会被服务端直接禁用（返回明确错误） |
| `FISH_API_KEY` | 用 Fish 才填 | Fish Audio 的 API Key |
| `FISH_MODEL` | 可选 | 默认 `s2.1-pro-free`（免费期到 2026-11-30）；之后改成付费版 `s2.1-pro` |
| `GROQ_API_KEY` | 小兵三选一 | Groq 的 API Key |
| `GROQ_MODEL` | 可选 | 默认 `llama-3.1-8b-instant` |
| `OPENROUTER_API_KEY` | 小兵三选一 | OpenRouter 的 API Key |
| `OPENROUTER_MODEL` | 可选 | 默认 `deepseek/deepseek-chat` |
| `GEMINI_API_KEY` | 小兵三选一 | Gemini 的 API Key |
| `GEMINI_MODEL` | 可选 | 不用填：Gemini 自动轮换——优先 `gemini-2.5-flash-lite` → `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-2.0-flash-lite`，某个失败自动换下一个；填了则它排最前面先试 |

小兵至少配一家（三选一即可），没配的那两家在页面上会显示「站长未配置」并置灰。
密钥建议用 Secret 类型填，不要用 Text。

### 第 4 步：重新部署（最容易漏的一步）

**填完或改完环境变量，必须点 Retry deployment / 重新部署一次**，否则新变量不生效，接口会报旧错（muse6 原站就踩过这个坑）。

## 三、上线验证清单（逐项打勾再交付）

1. 首页能打开，标题是「在线朗读工作台」，界面无错位。
2. 打开 `/api/health`，返回 JSON 布尔值（如 `{"fish":true,"groq":false,...,"gate":true}`），里面没有任何密钥内容；页面顶部徽章与之对得上。
3. 粘贴一段研报文字 → 处理模式选「提取投研要点」→ 流水线选「仅脚本」→ 生成文字稿：能出一句话结论 / 核心要点 / 关键数据 / 风险栏目，数字和原文一致，观点句带「观点：」。
4. 处理模式选「清洗乱码全文」：页码、重复页眉被去掉，断行接成整句，数字没被改动。
4b. 处理模式选「小牛会议纪要」：流水线选「仅脚本」时出 T1 两段式纪要草稿（首行是脚本粗判的材料类型，预测类原句带「观点转述：」，材料没给预测时写「材料未给盈利预测与评级」）；流水线选「脚本 + 小兵精炼」时，成稿第一行标明所用模板（如「本篇按小牛会议纪要 T1 模板整理（材料类型：财报会议）」），且 Groq/OpenRouter/Gemini 三家都走同一套纪要提示词（服务端按 mode 选定后分发）。
5. 选 Edge 来源 → 播放：能出声，读到的句子高亮，点任意一句能跳读，暂停/上下句可用；界面显示实际用的语音名（匹配不到晓晓/云扬时如实显示别的语音）。Edge 模式下「下载 MP3」按钮是禁用状态。
6. 选 Fish 来源 → 不输口令或输错口令播放：应被拒（401），页面清掉口令并重新弹框，不出声、不假装成功。
7. 输对口令 → Fish 播放：能出声，预合成后面句子时不卡顿；点「下载整篇 MP3」能得到拼接后的整篇音频。
8. 流水线选「脚本 + 小兵精炼」→ 选已配置的小兵：能出精炼稿，数字被改动的地方标了「待核对」；选未配置的小兵或故意断网：页面明确提示并回落「仅脚本版」，不卡死。
9. 上传一个电子版 PDF 和一个 DOCX：能解析出文字；上传扫描版 PDF：明确提示「未提取到文字层、暂不支持 OCR」。
10. 换一台没登录过任何东西的设备/浏览器打开网址，重复 3、5 两项：公开可用，不需要任何账号。

## 四、注意事项

1. **密钥只进 Cloudflare，不进代码、不进仓库、不进聊天。** 页面前端代码里永远不出现任何 Key；`/api/health` 只报布尔值。
2. **口令等于额度门锁**：拿到链接的人都能打开网站，但没口令用不了 Fish 和小兵。口令别用弱口令，泄露了就去 Cloudflare 改 `ACCESS_PASSWORD` 并重新部署。
3. **改环境变量后必须重新部署**（见第 4 步），只保存不部署等于没改。
4. **Root directory 必须填 `reader-site`、Build output 必须是 `public`**，填错了首页会 404 或空白。
5. Fish 音色在服务端是白名单映射（7 个音色：温柔治愈女声 + 6 个研报/听书音色），前端传任意 id 无效，这是防滥用设计，不要改成透传。
6. 单句合成上限 800 字（服务端校验），前端切句已按 220 字左右再切，正常不会触发。
7. 小兵只发阶段一的短草稿，不发原文全文；精炼稿的数字前端还会再和原文比对一遍，对不上标「待核对」，不要绕过这道校验。
