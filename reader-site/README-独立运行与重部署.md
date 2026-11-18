# 在线朗读工作台 · 独立运行与重部署说明

> 本篇是《README-部署步骤.md》的姊妹篇：部署步骤讲「怎么上线」，本篇讲「脱离 Muse 也能活」——
> 万一 Muse 账号 / 这台机器哪天没了，网站怎么独立存续、怎么从零拼回来。
> 规矩（Lee 2026-11-07 定）：站点代码与数据只沉淀在 Lee 自己的 GitHub 与 Supabase、运行在 Lee 自己的
> Cloudflare 上，不把家当只放在 Meta / Muse 的机房里；每次站点改动以推 GitHub 为准，不许只部署不推仓。

## 一、总图（一句话）

**代码 = GitHub 仓 `west4angle/muse19`**（`reader-site/` 站点本体 + `reader-pipeline/` 本地喂料流水线备份）；
**数据 = Supabase**（Lee 自己的项目，ref `seyniwiufhrfrklliusw`）；
**运行 = Cloudflare Pages**（项目 `muse19-reader`，域名 muse19-reader.pages.dev，连仓自动部署）；
**钥匙 = Cloudflare 环境变量**（只在 Lee 的 Cloudflare 后台里，仓里、代码里、本文里都只有变量名、没有值）。

数据面细节：

| 存哪 | 内容 | 说明 |
|---|---|---|
| Supabase 表 `reader_inbox` | 飞书待听的朗读稿（标题、成稿全文、模式、音色标记、到期时间、已听状态） | 网站待听列表的唯一数据来源，服务端接口用 `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` 访问 |
| Supabase 桶 `reader-audio` | 协作提交预生成的 MP3 | 文件名 = 待听行 id；随待听行一起 12 小时到期清理 |
| Supabase 桶 `collab-inbox` | 协作提交的收件箱（文档 / 朗读稿 + 清单） | 喂料流水线取走处理后即删原件 |
| 待听时效规矩 | 入库满 **12 小时自动删**（不管听没听），可手动删 | 本就是短存设计，不作长期归档（长期沉淀去向见第五节） |

## 二、Muse 失效时，什么还活着、什么会停

**还活着（站本身，靠仓 + Supabase + Cloudflare + env 即可，不依赖 Muse）：**

- 打开网站、上传文档 / 粘贴文字、脚本提炼与清洗、文字稿编辑；
- 逐句朗读：Edge（浏览器自带）与 Fish（走 Cloudflare 里 Lee 自己填的 Key）；
- 小兵精炼（Groq / OpenRouter / Gemini，同样走 Cloudflare env 的 Key）；
- 飞书待听列表的展示与播放（数据已在 Supabase）、协作提交页 `/submit` 收件入库；
- 管理员登录、访问口令校验。

**会停（飞书自动喂料，跑在 Muse 这台机器上）：**

- 从飞书各源头群自动捞日报（musegmail / muse1 / muse2 群、朗读群）；
- 协作提交的本地取件处理、MP3 预生成与待补自动补录；
- 晚上补充解析版等定时生成。
  原因：这套流水线由 Muse 的 hook 定时驱动、凭证走 Muse 的连接器安全存储——这些不在仓里、
  也不在 Cloudflare 里。停的只是「自动有人喂」，站本身和已入库的待听数据不受影响；
  恢复办法见第四节。

## 三、从零重部署（五步，口径同《README-部署步骤.md》，不另发明填法）

1. **连仓建 Pages 项目**：Cloudflare Pages → Create → Pages → Connect to Git，选仓库 `west4angle/muse19`，
   Production branch 选 `main`。
2. **填构建设置**：Root directory = `reader-site`；Framework preset = None；Build command 留空；
   Build output directory = `public`。
3. **填环境变量**（Settings → Variables and Secrets，建议 Secret 类型；**只列名，值由 Lee 本人填**）：

   | 变量名 | 用途 |
   |---|---|
   | `ACCESS_PASSWORD` | 访问口令（Fish 朗读与小兵精炼的服务端闸门，必填） |
   | `SUPABASE_URL` | Supabase 项目地址（待听数据） |
   | `SUPABASE_SERVICE_KEY` | Supabase 服务端密钥（接口读写 reader_inbox / 桶） |
   | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 管理员登录账号 / 口令（登录后免输共享口令） |
   | `ADMIN_SECRET` | 管理员登录 Cookie 的签名密钥 |
   | `FISH_API_KEY` | Fish Audio 合成（网站朗读） |
   | `FISH_MODEL` | 可选，Fish 模型名（站点代码有默认） |
   | `GROQ_API_KEY` / `GROQ_MODEL` | 小兵精炼·Groq（模型名可选） |
   | `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | 小兵精炼·OpenRouter（模型名可选） |
   | `GEMINI_API_KEY` / `GEMINI_MODEL` | 小兵精炼·Gemini（模型名可选） |

4. **部署**：保存后触发部署；**填完或改完环境变量必须再重新部署一次**（Retry deployment），
   否则新变量不生效——这是部署步骤里已记过的坑。
5. **验收**：打开 `/api/health`，`fish / groq / openrouter / gemini / gate / inbox` 应全为 `true`
   （哪家小兵没配 Key，对应项就是 false、页面上置灰，配了哪家验哪家）；
   再随手上传一篇文档跑通提炼 → 朗读，待听列表能出条目，即算恢复。

## 四、喂料流水线恢复办法

1. 从仓 `reader-pipeline/` 取回全部脚本（各文件职责见该目录 `README.md`），放到新机器同一相对位置；
   另需备齐目录外的飞书基础模块 `feishu-bot/config.py` 与 `feishu_api.py`（不在本仓备份内，
   飞书凭证从环境变量读）。
2. **重建连接器凭证**（凭证从来不进仓，必须由 Lee 在新环境重新录入 / 授权）：
   飞书应用、Supabase 数据面（`custom.supabase-data`）、Fish 三账号（`custom.fish-audio` / `2` / `3`）、
   Gemini（`custom.gemini-reader`、朗读群本地版 `custom.gemini-local`）、Groq（`custom.groq`）、
   OpenRouter（`custom.openrouter2`）、协作信箱 Supabase（`custom.supabase-collab`）。
   脚本本身不存明文密钥，一律经凭证替身（dynamic_credentials）按连接器名取
...[truncated 1583 chars]