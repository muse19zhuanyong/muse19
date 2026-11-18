"use strict";
/* muse19在线朗读网站 · 前端逻辑（纯脚本，无构建）
   流水线：本地解析文件 -> 清洗 -> 阶段一脚本提取 ->（可选）小兵精炼 -> 切句逐句朗读 */

// ---------- 小工具 ----------
function $(id) { return document.getElementById(id); }
function setStatus(id, msg) { $(id).textContent = msg || ""; }

var PW_KEY = "reader_access_pw";
function getPassword() { return sessionStorage.getItem(PW_KEY) || ""; }
var adminMode = false;
function ensurePassword(force) {
  if (adminMode) return "__admin__";
  var pw = getPassword();
  if (!pw || force) {
    pw = window.prompt("该功能需要访问口令，请输入：", "") || "";
    if (pw) sessionStorage.setItem(PW_KEY, pw);
  }
  return pw;
}
function clearPassword() { sessionStorage.removeItem(PW_KEY); }

// ---------- 配置状态（/api/health） ----------
var health = { fish: false, groq: false, openrouter: false, gemini: false, gate: false };

function renderHealth() {
  var items = [
    ["Fish 朗读", health.fish && health.gate],
    ["Groq 小兵", health.groq && health.gate],
    ["OpenRouter 小兵", health.openrouter && health.gate],
    ["Gemini 小兵", health.gemini && health.gate],
    ["访问口令", health.gate],
  ];
  $("healthBadges").innerHTML = items.map(function (it) {
    return '<span class="badge ' + (it[1] ? "ok" : "off") + '">' +
      it[0] + (it[1] ? "：已配置" : "：站长未配置") + "</span>";
  }).join("");
  // 未配置的选项置灰
  var fishRadio = document.querySelector('input[name="source"][value="fish"]');
  fishRadio.disabled = !(health.fish && health.gate);
  $("fishRadioLabel").classList.toggle("disabled", fishRadio.disabled);
  var prov = $("providerSelect");
  ["groq", "openrouter", "gemini"].forEach(function (p) {
    var opt = prov.querySelector('option[value="' + p + '"]');
    if (opt) {
      var ok = health[p] && health.gate;
      opt.disabled = !ok;
      opt.textContent = opt.textContent.replace(/（站长未配置）$/, "") + (ok ? "" : "（站长未配置）");
    }
  });
}

function loadHealth() {
  fetch("/api/health").then(function (r) { return r.json(); }).then(function (h) {
    health = h; renderHealth();
  }).catch(function () {
    $("healthBadges").innerHTML = '<span class="badge off">配置状态读取失败（/api/health 不可用，可能是本地直接打开了页面）</span>';
  });
}

// ---------- 文件解析（全在本地） ----------
function readFile(file) {
  var name = file.name || "";
  var ext = name.split(".").pop().toLowerCase();
  $("fileName").textContent = name;
  setStatus("inputStatus", "正在本地解析 " + name + " …");
  if (ext === "pdf") return readPdf(file);
  if (ext === "docx") return readDocx(file);
  return file.text().then(function (t) {
    if (ext === "html" || ext === "htm") { window.__lastHtml = t; t = stripHtml(t); }
    return t;
  });
}

function stripHtml(html) {
  // 先给块级元素与表格单元格加边界，避免 textContent 把表格压成一团碎片
  var marked = String(html || "")
    .replace(/<\/td\s*>/gi, "｜")
    .replace(/<\/(tr|p|div|li|h[1-6]|table|thead|tbody|section|article)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  var doc = new DOMParser().parseFromString(marked, "text/html");
  return (doc.body && doc.body.textContent) || "";
}

function readPdf(file) {
  if (typeof window.pdfjsLib === "undefined") {
    return Promise.reject(new Error("pdf.js 库加载失败（CDN 不可用），请检查网络后重试，或改粘贴文字"));
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return file.arrayBuffer().then(function (buf) {
    return window.pdfjsLib.getDocument({ data: buf }).promise;
  }).then(function (pdf) {
    var pages = [];
    var chain = Promise.resolve();
    var collect = function (i) {
      chain = chain.then(function () {
        return pdf.getPage(i).then(function (page) {
          return page.getTextContent();
        }).then(function (tc) {
          pages.push(tc.items.map(function (it) { return it.str; }).join(" "));
        });
      });
    };
    for (var i = 1; i <= pdf.numPages; i++) collect(i);
    return chain.then(function () { return pages.join("\n"); });
  });
}

function readDocx(file) {
  if (typeof window.mammoth === "undefined") {
    return Promise.reject(new Error("mammoth 库加载失败（CDN 不可用），请检查网络后重试，或改粘贴文字"));
  }
  return file.arrayBuffer().then(function (buf) {
    return window.mammoth.convertToHtml({ arrayBuffer: buf });
  }).then(function (res) { return stripHtml(res.value || ""); });
}

$("fileInput").addEventListener("change", function (e) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  readFile(file).then(function (text) {
    if (!text || text.replace(/\s/g, "").length < 20) {
      setStatus("inputStatus", "未提取到文字层，可能是扫描版 PDF（图片型），第一版暂不支持 OCR。请换电子版文档或直接粘贴文字。");
      return;
    }
    $("rawText").value = text;
    setStatus("inputStatus", "解析完成，共约 " + text.length + " 字，已填入文本框。");
  }).catch(function (err) {
    setStatus("inputStatus", "解析失败：" + err.message);
  });
});

// ---------- 清洗（纯规则，数字与代码保护：不改动任何数字序列） ----------
function cleanText(raw) {
  var text = String(raw || "").replace(/\r\n?/g, "\n");
  // 删控制字符与明显乱码符号（保留中文、英数、常用标点）
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  text = text.replace(/[\ufffd\u25a1\u25a0\u25c6\u25cf\u25b2\u25bc\u2605\u2606\u203b]/g, "");
  var lines = text.split("\n").map(function (l) { return l.replace(/[ \t]+/g, " ").trim(); });
  // 统计重复短行（页眉页脚特征：短、重复出现 3 次以上）
  var freq = {};
  lines.forEach(function (l) { if (l && l.length <= 40) freq[l] = (freq[l] || 0) + 1; });
  lines = lines.filter(function (l) {
    if (!l) return false;
    if (/^第?\s*\d+\s*页(\s*\/\s*共?\s*\d+\s*页)?$/.test(l)) return false;   // 页码行
    if (/^\d{1,4}$/.test(l)) return false;                                    // 独行页码
    if (l.length <= 40 && freq[l] >= 3) return false;                         // 重复页眉页脚
    return true;
  });
  // 断行接句：上一行不以句末标点结尾、下一行不是新标题时合并
  var merged = [];
  lines.forEach(function (l) {
    if (merged.length) {
      var prev = merged[merged.length - 1];
      var prevEnd = /[。！？!?；;：:…」』）)]$/.test(prev);
      var looksHeading = l.length <= 22 && !/[，。；]/.test(l);
      if (!prevEnd && !looksHeading) {
        // 中英/数字交界处补逗号，避免「增长Coherent」式粘连
        var sep = /[一-龥]$/.test(prev) && /^[A-Za-z0-9]/.test(l) ? "，" : "";
        merged[merged.length - 1] = prev + sep + l; return;
      }
    }
    merged.push(l);
  });
  text = merged.join("\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{2,}/g, "\n");
  text = text.replace(/([。！？；：，、])\s+/g, "$1");
  return text.trim();
}

// ---------- 切句 ----------
function splitSentences(text) {
  var out = [];
  String(text || "").split("\n").forEach(function (line) {
    line = line.trim();
    if (!line) return;
    var parts = line.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [line];
    parts.forEach(function (p) {
      p = p.trim();
      if (!p) return;
      // 过长句按逗号再切，保证逐句合成不超限
      while (p.length > 220) {
        var cut = p.lastIndexOf("，", 220);
        if (cut < 60) cut = 220;
        out.push(p.slice(0, cut + 1).trim());
        p = p.slice(cut + 1).trim();
      }
      if (p) out.push(p);
    });
  });
  return out;
}

// ---------- 碎片过滤与近重复去重（表格单元格残片、同一新闻多处复述） ----------
function isFragment(s) {
  var t = String(s || "").replace(/\s/g, "");
  if (t.length < 8) return true;                                    // 太短：多为表格残格
  if (/^[\d%％+\-.,，、:：()（）/·—-]+$/.test(t)) return true;        // 纯数字符号
  var digits = (t.match(/\d/g) || []).length;
  if (t.length < 40 && digits / t.length > 0.55) return true;        // 数字占比过高的短片
  if (!/[一-龥]{2,}/.test(t) && t.length < 24) return true;          // 无实义汉字的短英文/符号片
  return false;
}

function ngramSet(s) {
  var t = String(s || "").replace(/[\s，。；：、,.%:：%％()（）「」“”‘’·—-]/g, "");
  var set = {};
  for (var i = 0; i + 3 <= t.length; i++) set[t.slice(i, i + 3)] = 1;
  return set;
}
function tooSimilar(a, b) {
  var sa = ngramSet(a), sb = ngramSet(b);
  var ka = Object.keys(sa), kb = Object.keys(sb);
  if (!ka.length || !kb.length) return false;
  var inter = 0;
  ka.forEach(function (k) { if (sb[k]) inter++; });
  return inter / Math.min(ka.length, kb.length) > 0.62;
}

function usableSentences(text) {
  var kept = [];
  splitSentences(text).forEach(function (s) {
    // 表格行先按单元格拆开：整行是多个股票/指标的拼接，只有带完整信息的单元格才算句子
    var segs = s.indexOf("｜") >= 0 ? s.split("｜") : [s];
    segs.forEach(function (seg) {
      seg = seg.trim();
      if (!seg || isFragment(seg)) return;
      for (var i = 0; i < kept.length; i++) { if (tooSimilar(seg, kept[i])) return; }
      kept.push(seg);
    });
  });
  return kept;
}

// ---------- 阶段一：脚本抽取（0 token，摘原句） ----------
var SCORE_WORDS = ["结论", "预计", "预期", "增长", "同比", "环比", "目标价", "评级", "买入", "增持",
  "订单", "产能", "出货", "收入", "营收", "利润", "毛利", "市场份额", "供不应求", "放量", "突破"];
var RISK_WORDS = ["风险", "下滑", "不及预期", "压力", "下降", "亏损", "波动", "不确定", "担忧", "放缓"];
var OPINION_WORDS = ["认为", "判断", "看好", "分析师", "机构", "观点", "有望"];

function hasDigit(s) { return /\d/.test(s); }

function scoreSentence(s) {
  var score = 0;
  SCORE_WORDS.forEach(function (w) { if (s.indexOf(w) >= 0) score += 2; });
  if (hasDigit(s)) score += 3;
  if (/%|％|亿元|万元|亿美元|倍|元\/|美元/.test(s)) score += 2;
  if (s.length >= 12 && s.length <= 120) score += 1;
  if (s.length > 220) score -= 2;
  return score;
}

function extractByScript(text) {
  var sentences = usableSentences(text);
  var scored = sentences.map(function (s, i) { return { s: s, i: i, score: scoreSentence(s) }; });
  var sorted = scored.slice().sort(function (a, b) { return b.score - a.score || a.i - b.i; });

  var conclusionPool = sorted.filter(function (x) { return x.s.length <= 180; });
  var conclusion = (conclusionPool.length ? conclusionPool[0] : sorted[0]) ? (conclusionPool.length ? conclusionPool[0].s : sorted[0].s) : "";
  var risks = sentences.filter(function (s) {
    if (s.indexOf("风险偏好") >= 0) return false;   // 「风险偏好修复」是 risk-on，不是风险提示
    return RISK_WORDS.some(function (w) { return s.indexOf(w) >= 0; });
  }).slice(0, 6);
  var riskSet = {}; risks.forEach(function (s) { riskSet[s] = 1; });

  var data = sentences.filter(function (s) {
    return s.length >= 14 && s.length <= 160 && hasDigit(s) && /%|％|亿|万|美元|元|倍|家|个百分点/.test(s) && !riskSet[s];
  }).slice(0, 14);
  var dataSet = {}; data.forEach(function (s) { dataSet[s] = 1; });

  var core = sorted.filter(function (x) {
    return x.s !== conclusion && !riskSet[x.s] && !dataSet[x.s];
  }).slice(0, 14).sort(function (a, b) { return a.i - b.i; }).map(function (x) { return x.s; });

  function markOpinion(s) {
    var isOpinion = OPINION_WORDS.some(function (w) { return s.indexOf(w) >= 0; });
    return isOpinion && s.indexOf("观点") !== 0 ? "观点：" + s : s;
  }

  var out = [];
  if (conclusion) out.push("一句话结论：" + markOpinion(conclusion));
  if (core.length) {
    out.push("核心要点：");
    core.forEach(function (s) { out.push(markOpinion(s)); });
  }
  if (data.length) {
    out.push("关键数据：");
    data.forEach(function (s) { out.push(s); });
  }
  if (risks.length) {
    out.push("风险与待核对项：");
    risks.forEach(function (s) { out.push(s); });
  }
  if (!out.length) out = sentences.slice(0, 16);
  return out.join("\n");
}

// ---------- 阶段一：小牛会议纪要脚本草稿（0 token，摘原句，按 T1 两段式骨架组装） ----------
var FORECAST_WORDS = ["预计", "预测", "净利润", "净利", "PE", "市盈率", "评级", "目标价"];
var LOGIC_WORDS = ["主营", "业务", "经营", "战略", "布局", "核心竞争力", "优势", "增长点", "市场地位", "商业模式"];

function containsAny(s, words) {
  return words.some(function (w) { return s.indexOf(w) >= 0; });
}

// 材料类型粗判（关键词命中顺序即优先级，与小牛技能的六类对齐）
function detectMaterialType(text) {
  var t = String(text || "");
  if (containsAny(t, ["业绩", "财报", "季报", "年报", "中报", "指引", "业绩会"])) return "财报会议";
  if (containsAny(t, ["调研", "走访"])) return "调研纪要";
  if (containsAny(t, ["公告", "政策", "突发"])) return "事件点评";
  if (containsAny(t, ["公众号", "文章"])) return "公众号文章";
  if (containsAny(t, ["交流", "路演"])) return "上市公司交流";
  return "电话会议";
}

function extractMinutesByScript(text) {
  var sentences = usableSentences(text);
  var type = detectMaterialType(text);
  var used = {};   // 已被核心要点摘走的句序号（按序号去重，避免纪要整理里重复）

  function pickIdx(pred, limit) {
    var idx = [];
    sentences.forEach(function (s, i) {
      if (!used[i] && pred(s)) { idx.push(i); used[i] = 1; }
    });
    return idx.slice(0, limit);
  }

  // 【盈利预测及投资建议】只摘预测类原句
  var forecastIdx = pickIdx(function (s) { return containsAny(s, FORECAST_WORDS); }, 10);
  // 【风险提示】风险关键词句（排除「风险偏好」这类 risk-on 表述）
  var riskIdx = pickIdx(function (s) { return s.indexOf("风险偏好") < 0 && containsAny(s, RISK_WORDS); }, 6);
  // 【公司逻辑】打分最高的逻辑/经营句（复用 scoreSentence，逻辑词加分）
  var logicScored = sentences.map(function (s, i) {
    if (used[i]) return null;
    var bonus = containsAny(s, LOGIC_WORDS) ? 3 : 0;
    return { s: s, i: i, score: scoreSentence(s) + bonus };
  }).filter(Boolean).sort(function (a, b) { return b.score - a.score || a.i - b.i; });
  var logicIdx = logicScored.slice(0, 4).map(function (x) { used[x.i] = 1; return x.i; })
    .sort(function (a, b) { return a - b; });

  var out = [];
  out.push("材料类型（脚本粗判）：" + type);
  out.push("一、核心要点");
  out.push("【公司逻辑】");
  if (logicIdx.length) logicIdx.forEach(function (i) { out.push(sentences[i]); });
  else out.push("材料未明确");
  out.push("【盈利预测及投资建议】");
  if (forecastIdx.length) forecastIdx.forEach(function (i) { out.push("观点转述：" + sentences[i]); });
  else out.push("材料未给盈利预测与评级");
  out.push("【风险提示】");
  if (riskIdx.length) riskIdx.forEach(function (i) { out.push(sentences[i]); });
  else out.push("材料未明确");
  out.push("二、纪要整理");

  // 纪要整理：其余句子按原文顺序，总量控制在约 8000 字内
  var total = out.join("\n").length;
  var truncated = false;
  var restCount = 0;
  sentences.forEach(function (s, i) {
    if (used[i]) return;
    if (total + s.length + 1 > 8000) { truncated = true; return; }
    out.push(s);
    total += s.length + 1;
    restCount++;
  });
  if (!restCount && !truncated) out.push("（其余内容已在上方核心要点中摘录）");
  if (truncated) out.push("（纪要整理已按约 8000 字截断，余下内容见原文）");
  return out.join("\n");
}

// ---------- 数字校验（小兵成稿 vs 草稿） ----------
function extractNumbers(text) {
  var m = String(text || "").match(/\d+(?:\.\d+)?%?/g) || [];
  var dates = String(text || "").match(/\d{4}[-/年]\d{1,2}([-/月]\d{1,2}日?)?/g) || [];
  var codes = String(text || "").match(/\b\d{6}\b/g) || [];
  return m.concat(dates, codes);
}

function checkNumbers(refined, source) {
  var srcSet = {};
  extractNumbers(source).forEach(function (n) { srcSet[n] = 1; });
  var lines = String(refined || "").split("\n").map(function (line) {
    var bad = [];
    extractNumbers(line).forEach(function (n) { if (!srcSet[n]) bad.push(n); });
    if (bad.length) return line + "〔数字待核对：" + bad.join("、") + "〕";
    return line;
  });
  return lines.join("\n");
}

// ---------- 处理（生成文字稿） ----------
var lastRefineNote = "";

function callRefine(provider, draft, retry, mode, direct) {
  var pw = ensurePassword(false);
  if (!pw) return Promise.reject(new Error(direct ? "未输入口令" : "未输入口令，已回落仅脚本版"));
  return fetch("/api/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Access-Password": pw },
    body: JSON.stringify({ provider: provider, draft: draft, mode: mode || "digest", direct: !!direct }),
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (data) {
      if (r.status === 401 && !retry) {
        clearPassword();
        setStatus("processStatus", "口令错误，请重新输入…");
        return callRefine(provider, draft, true, mode, direct);
      }
      if (!r.ok) throw new Error(data.error || ("精炼接口返回 " + r.status));
      if (!data.text) throw new Error("精炼未返回文本");
      return { text: data.text, model: data.model || "" };
    });
  });
}

// ---------- 默认选项（Lee 2026-11-07 定） ----------
// 1: 提炼要点+原文直送+Gemini+新闻男 / 2: 提炼要点+原文直送+Groq+CCTV13女
// 3: 会议纪要+原文直送+OpenRouter+齐静春 / 4: 清洗全文+仅脚本+温柔治愈
// 5: 清洗全文+仅脚本+于琳-专家（Lee 2026-11-09 定；语速不锁定，保持页面所选，默认 1.0）
// 6: 提炼要点+原文直送+Groq+祁老师（Lee 2026-11-09 定，与默认2同路、只换音色；语速同样不锁定）
// 7: 清洗全文+仅脚本+Edge朗读（Lee 2026-11-11 定；Edge 音色按当天音色轮换自动配：女声日晓晓、男声日云扬；
//    语速同样不锁定；只作用于网站手动处理这一步，不影响飞书流水线/协作提交/待听自动合成）
var PRESETS = {
  1: { mode: "extract", pipeline: "direct", provider: "gemini", voice: "xinwen-nan", label: "默认1（Gemini 提炼要点＋新闻男）" },
  2: { mode: "extract", pipeline: "direct", provider: "groq", voice: "cctv13-nv", label: "默认2（Groq 提炼要点＋CCTV13女）" },
  3: { mode: "minutes", pipeline: "direct", provider: "openrouter", voice: "qijingchun", label: "默认3（OpenRouter 纪要＋齐静春）" },
  4: { mode: "clean", pipeline: "script", provider: "", voice: "wenrou-zhiyu", label: "默认4（脚本清洗全文＋温柔治愈）" },
  5: { mode: "clean", pipeline: "script", provider: "", voice: "yulin-zhuanjia", label: "默认5（脚本清洗全文＋于琳-专家）" },
  6: { mode: "extract", pipeline: "direct", provider: "groq", voice: "qi-laoshi", label: "默认6（Groq 提取要点＋祁老师）" },
  7: { mode: "clean", pipeline: "script", provider: "", source: "edge", voice: "", label: "默认7（脚本清洗全文＋Edge朗读）" },
  // 8: 清洗全文+仅脚本+Fish 央视配音+0.95 倍速（Lee 2026-11-11 定：原定 Meta 男声 Helio，网站调不到 Meta 语音，
  //    Lee 选定网站版用 Fish 男声代替；央视配音是 Lee 定的听书男声、与 Helio 听书定位同路；与其他预设不同，本预设点选时把语速设为 0.95）
  8: { mode: "clean", pipeline: "script", provider: "", voice: "yangshi-peiyin", speed: "0.95", label: "默认8（脚本清洗全文＋央视配音＋0.95倍速）" },
};
// 当天 Edge 音色：复用当日 Fish 默认音色的性别（defaultVoiceKey：周六赵阳女/周日齐静春男/平日单双男新闻男·女CCTV13女）
function edgeVoiceForToday() {
  var femaleKeys = ["wenrou-zhiyu", "yulin-zhuanjia", "cctv13-nv", "zhaoyang", "changfa-nv", "yangshi-boyin"];
  return femaleKeys.indexOf(defaultVoiceKey()) >= 0 ? "xiaoxiao" : "yunyang";
}
function setEdgeVoice(key) {
  var edge = document.querySelector('input[name="source"][value="edge"]');
  if (edge) { edge.checked = true; renderVoiceOptions(); }
  var vs = $("voiceSelect");
  for (var i = 0; i < vs.options.length; i++) { if (vs.options[i].value === key) { vs.value = key; break; } }
}
window.__activePreset = 0;
var __applyingPreset = false;
function setRadio(name, value) {
  var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
  if (el) el.checked = true;
}
function setFishVoice(key) {
  var fish = document.querySelector('input[name="source"][value="fish"]');
  if (fish) { fish.checked = true; renderVoiceOptions(); }
  var vs = $("voiceSelect");
  for (var i = 0; i < vs.options.length; i++) { if (vs.options[i].value === key) { vs.value = key; break; } }
}
function applyPreset(n) {
  var p = PRESETS[n];
  if (!p) return;
  __applyingPreset = true;
  setRadio("mode", p.mode);
  setRadio("pipeline", p.pipeline);
  if (p.provider) $("providerSelect").value = p.provider;
  var displayLabel = p.label;
  if (p.source === "edge") {
    var edgeKey = edgeVoiceForToday();
    setEdgeVoice(edgeKey);
    displayLabel = "默认7（脚本清洗全文＋Edge " + (edgeKey === "yunyang" ? "云扬" : "晓晓") + "）";
  } else {
    setFishVoice(p.voice);
  }
  if (p.speed) $("speedSelect").value = p.speed;
  window.__activePreset = n;
  __applyingPreset = false;
  setStatus("processStatus", "已套用" + displayLabel + "，设置已就位，点「生成文字稿」执行。");
}
[1, 2, 3, 4, 5, 6, 7, 8].forEach(function (n) {
  $("preset" + n + "Btn").addEventListener("click", function () { applyPreset(n); });
});
document.querySelectorAll('input[name="mode"], input[name="pipeline"]').forEach(function (el) {
  el.addEventListener("change", function () { if (!__applyingPreset) window.__activePreset = 0; });
});
$("providerSelect").addEventListener("change", function () { if (!__applyingPreset) window.__activePreset = 0; });

// 默认1 的 Gemini 不可用时自动切换默认2 重试一次（Lee 2026-11-07 定）
function callRefineWithFallback(provider, draft, mode, direct) {
  return callRefine(provider, draft, false, mode, direct).catch(function (err) {
    if (window.__activePreset === 1 && provider === "gemini") {
      setStatus("processStatus", "Gemini 调用失败（" + err.message + "），已自动切换默认2（Groq＋CCTV13女）重试…");
      applyPreset(2);
      return callRefine("groq", draft, false, mode, direct).then(function (r) { r.usedProvider = "groq"; return r; });
    }
    throw err;
  });
}

$("processBtn").addEventListener("click", function () {
  var raw = $("rawText").value.trim();
  if (!raw) { setStatus("processStatus", "先上传文件或粘贴文字。"); return; }
  var mode = document.querySelector('input[name="mode"]:checked').value;
  var cleaned = cleanText(raw);
  lastRefineNote = "";
  introPending = docNameFromSources(raw);  // 本次生成定稿后由 buildSentences 统一加第一句报名

  if (mode === "clean") {
    $("draftText").value = cleaned;
    $("refineInfo").textContent = "清洗模式：纯脚本规则清洗，未调用任何模型。清洗后约 " + cleaned.length + " 字。";
    setStatus("processStatus", "清洗完成。");
    buildSentences();
    return;
  }

  if (mode === "limitup") { buildLimitup(); return; }

  if (mode === "usmapping" || mode === "morning") {
    // 专用朗读模式（简化版）：原文直送小兵按专用提示词提炼成 10 分钟稿；完整版（脚本对账）在飞书自动通道
    var spLabel = mode === "usmapping" ? "美股映射朗读" : "早盘事件挖掘朗读";
    var spProvider = $("providerSelect").value;
    var SP_LIMIT = 26000;
    var spText = cleaned;
    var spTrunc = false;
    if (spText.length > SP_LIMIT) { spText = spText.slice(0, SP_LIMIT); spTrunc = true; }
    $("refineInfo").textContent = spLabel + "：原文直送小兵按专用规则提炼（目标 10 分钟内），清洗后原文约 " + cleaned.length + " 字" + (spTrunc ? "（过长，已截取前 " + SP_LIMIT + " 字）" : "") + "。";
    setStatus("processStatus", spLabel + "提炼中…");
    callRefineWithFallback(spProvider, spText, mode, true).then(function (refined) {
      var checked = checkNumbers(refined.text, cleaned);
      $("draftText").value = checked;
      lastRefineNote = spLabel + "完成（" + (refined.usedProvider || spProvider) + (refined.model ? " · 实际模型 " + refined.model : "") + "），数字已与原文比对，对不上的已标「待核对」。";
      $("refineInfo").textContent = lastRefineNote;
      setStatus("processStatus", "提炼完成。");
      buildSentences();
    }).catch(function (err) {
      $("draftText").value = cleaned;
      lastRefineNote = spLabel + "未成功（" + err.message + "），已回落清洗后原文。";
      $("refineInfo").textContent = lastRefineNote;
      setStatus("processStatus", "已回落清洗后原文。");
      buildSentences();
    });
    return;
  }

  var isMinutes = mode === "minutes";
  var modeLabel = isMinutes ? "小牛会议纪要模式" : "提取投研要点模式";
  var draft = isMinutes ? extractMinutesByScript(cleaned) : extractByScript(cleaned);
  var pipeline = document.querySelector('input[name="pipeline"]:checked').value;
  if (pipeline === "script") {
    $("draftText").value = draft;
    $("refineInfo").textContent = isMinutes
      ? "小牛会议纪要模式：阶段一脚本纪要草稿完成（0 token，按 T1 两段式骨架摘句组装、数字未改）。"
      : "阶段一脚本提取完成（0 token，原句摘录、数字未改）。";
    setStatus("processStatus", isMinutes ? "脚本纪要草稿完成。" : "脚本提取完成。");
    buildSentences();
    return;
  }

  if (pipeline === "direct") {
    var dProvider = $("providerSelect").value;
    var DIRECT_LIMIT = 20000;
    var directText = cleaned;
    var dTruncated = false;
    if (directText.length > DIRECT_LIMIT) { directText = directText.slice(0, DIRECT_LIMIT); dTruncated = true; }
    $("refineInfo").textContent = modeLabel + "：原文直送模式，不经脚本摘句，清洗后原文约 " + cleaned.length + " 字" +
      (dTruncated ? "（过长，已截取前 " + DIRECT_LIMIT + " 字）" : "") + "，直接发给小兵（" + dProvider + "）按" +
      (isMinutes ? "小牛会议纪要" : "投研要点提炼") + "技能整理。";
    setStatus("processStatus", "原文直送小兵整理中…");
    callRefineWithFallback(dProvider, directText, isMinutes ? "minutes" : "digest", true).then(function (refined) {
      var checked = checkNumbers(refined.text, cleaned);
      $("draftText").value = checked;
      lastRefineNote = "原文直送整理完成（" + (refined.usedProvider || dProvider) + (refined.model ? " · 实际模型 " + refined.model : "") + "），数字已与原文比对，对不上的已标「待核对」。";
      $("refineInfo").textContent = lastRefineNote;
      setStatus("processStatus", "直送整理完成。");
      buildSentences();
    }).catch(function (err) {
      $("draftText").value = cleaned;
      lastRefineNote = "原文直送整理未成功（" + err.message + "），已回落清洗后原文，未生成提炼/纪要稿。";
      $("refineInfo").textContent = lastRefineNote;
      setStatus("processStatus", "已回落清洗后原文。");
      buildSentences();
    });
    return;
  }

  var provider = $("providerSelect").value;
  $("refineInfo").textContent = modeLabel + "：阶段一脚本草稿约 " + draft.length + " 字，将只把这份短草稿发给小兵（" +
    provider + "）精炼，约发 " + draft.length + " 字符。";
  setStatus("processStatus", "脚本草稿已生成，正在调小兵精炼…");
  callRefineWithFallback(provider, draft, isMinutes ? "minutes" : "digest", false).then(function (refined) {
    var checked = checkNumbers(refined.text, cleaned + "\n" + draft);
    $("draftText").value = checked;
    lastRefineNote = (isMinutes ? "小牛会议纪要精炼完成" : "小兵精炼完成") + "（" + (refined.usedProvider || provider) + (refined.model ? " · 实际模型 " + refined.model : "") + "），数字已与原文比对，对不上的已标「待核对」。";
    $("refineInfo").textContent = lastRefineNote;
    setStatus("processStatus", "精炼完成。");
    buildSentences();
  }).catch(function (err) {
    $("draftText").value = draft;
    lastRefineNote = (isMinutes ? "小牛会议纪要精炼未成功" : "小兵精炼未成功") + "（" + err.message + "），已回落仅脚本版。";
    $("refineInfo").textContent = lastRefineNote;
    setStatus("processStatus", "已回落仅脚本版。");
    buildSentences();
  });
});

// ---------- 声音选项 ----------
var FISH_VOICES = [
  ["wenrou-zhiyu", "温柔治愈女声（女 · 舒缓）"],
  ["yulin-zhuanjia", "于琳-专家（女 · 温柔 · 知识/健康）"],
  ["qi-laoshi", "祁老师（男）"],
  ["xinwen-nan", "新闻男（男 · 新闻播报）"],
  ["cctv13-nv", "CCTV13播报女（女 · 新闻播报）"],
  ["zhaoyang", "赵阳（女 · 讲座学术）"],
  ["qijingchun", "齐静春（男 · 讲座学术）"],
  ["yangshi-peiyin", "央视配音（男 · 纪录片/新闻）"],
  ["changfa-nv", "长发新闻女（女 · 评论员）"],
  ["shuaishuai", "帅帅的我2（男 · 评论员）"],
  ["yangshi-boyin", "央视播音腔1（女 · 标准播音）"],
];
function currentSource() {
  return document.querySelector('input[name="source"]:checked').value;
}

function renderVoiceOptions() {
  var sel = $("voiceSelect");
  sel.innerHTML = "";
  if (currentSource() === "fish") {
    FISH_VOICES.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v[0]; o.textContent = v[1];
      sel.appendChild(o);
    });
  } else {
    [["xiaoxiao", "晓晓 Xiaoxiao（女）"], ["yunyang", "云扬 Yunyang（男 · 新闻播报）"]].forEach(function (v) {
      var o = document.createElement("option");
      o.value = v[0]; o.textContent = v[1];
      sel.appendChild(o);
    });
  }
  $("downloadBtn").disabled = currentSource() !== "fish";
  $("downloadBtn").title = currentSource() !== "fish" ? "Edge 是浏览器实时语音，无法导出 MP3" : "";
  $("actualVoice").textContent = "";
}
document.querySelectorAll('input[name="source"]').forEach(function (r) {
  r.addEventListener("change", function () { stopPlay(); renderVoiceOptions(); });
});

// ---------- 逐句播放器 ----------
var sentences = [];
var curIdx = -1;
var playing = false;
var paused = false;
var fishFailStage = 0;   // Fish 失败切换级数（startAt 时复位）
var fishCache = {};   // idx -> objectURL
var fishBlobs = {};   // idx -> Blob（供下载拼接）
var currentAudio = null;
var playToken = 0;    // 防止旧的异步回调串台
var sentRetries = 0;   // 当前句已自动重试次数（单句失败先重试再跳过，Lee 2026-11-09 定）
var skipStreak = 0;    // 连续跳过句数（成功播完清零；连续 5 句失败才整篇停）
var playTitle = "";        // 当前朗读标题（锁屏 Media Session 显示用）
var fetchStartedAt = 0;    // 当前句 Fish 合成开始时刻（0 = 不在合成中），看门狗判卡用
var sentStartedAt = 0;     // 当前句开始出声时刻，看门狗判卡用
var lastRecoverAt = 0;     // 上次自动续播时刻（节流，防重复恢复）
var lastProgressTime = -1; // 上次看门狗看到的音频进度（秒），判进度卡住用
var lastProgressAt = 0;    // 进度最后一次前进的时刻

// ---------- 成稿第一句：先报文档名（Lee 2026-11-07 定版） ----------
// 与本地流水线 read_common.prepend_doc_intro 同口径：新生成的文稿第一句固定
// 「本文是《文档名》文档。」，脚本统一加、幂等去重，原有点题句保留在后。
// 文档名：优先文件名（上传）/粘贴文本首行短标题；文件名清理 = 去扩展名、
// 去【提交者】前缀标签、下划线转空格、YYYYMMDD / YYYY-MM-DD 转「YYYY年M月D日」。
// 只对新生成稿生效：点「生成文字稿」时置位 introPending，buildSentences 消费
// 一次；待听存量稿播放不置位、不回头改。
var introPending = null;
function cleanDocNameJS(fileName) {
  var name = String(fileName || "").trim();
  name = name.replace(/^【[^】]*】/, "").trim();
  name = name.replace(/\.[A-Za-z0-9]{2,5}$/, "");
  var ymd = function (m, y, mo, d) {
    mo = parseInt(mo, 10); d = parseInt(d, 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return m;
    return y + "年" + mo + "月" + d + "日";
  };
  name = name.replace(/(20\d{2})-(\d{2})-(\d{2})/g, ymd);
  name = name.replace(/(20\d{2})(\d{2})(\d{2})/g, ymd);
  name = name.replace(/_+/g, " ").replace(/\s+/g, " ").replace(/^[ .·]+|[ .·]+$/g, "");
  return name;
}
function prependDocIntroJS(text, docName) {
  var body = String(text || "");
  if (/^本文是《[^》]*》文档。/.test(body.replace(/^\s+/, ""))) return text;
  var name = String(docName || "").replace(/^[《]+|[》]+$/g, "").trim();
  if (!name) return text;
  return "本文是《" + name + "》文档。\n\n" + body.replace(/^\s+/, "");
}
// 与本地流水线 read_common.scrub_reading_marks 同口径（Lee 2026-11-07 定版）：
// 正文里连续 ≥2 个星号的加粗标记（**、***）全删只留文字，单个星号不动；
// 带圈数字（①-⑳、㉑-㉟、㊱-㊿、⓪）只删符号——符号前已是标点/括号引号
// 收尾、或在句首/行首时直接删，前是普通文字且删后会粘连的补一个「；」。
// ★ 等其他符号一律不动。定稿时先洗符号、再加第一句（与 finalize 顺序一致）。
function scrubReadingMarksJS(text) {
  var t = String(text || "").replace(/\*{2,}/g, "");
  var NO_STICK = "。；，：、！？…）)】》」』\"”'’（(【《「『·—";
  function isCircled(ch) {
    var o = ch.charCodeAt(0);
    return (o >= 0x2460 && o <= 0x2473) || (o >= 0x3251 && o <= 0x325F) ||
           (o >= 0x32B1 && o <= 0x32BF) || o === 0x24EA;
  }
  function isWs(ch) { return /\s/.test(ch); }
  var chars = t.split("");
  var out = [];
  var i = 0;
  while (i < chars.length) {
    var ch = chars[i];
    if (!isCircled(ch)) { out.push(ch); i++; continue; }
    var j = out.length - 1, gapNL = false;
    while (j >= 0 && isWs(out[j])) { if (out[j] === "\n") gapNL = true; j--; }
    var prev = j >= 0 ? out[j] : "";
    var k = i + 1, gapAfterNL = false;
    while (k < chars.length && isWs(chars[k])) { if (chars[k] === "\n") gapAfterNL = true; k++; }
    var hasNext = k < chars.length;
    if (!prev || gapNL || gapAfterNL || NO_STICK.indexOf(prev) >= 0 || !hasNext) { i++; continue; }
    out.length = j + 1;
    out.push("；");
    i = k;
  }
  return out.join("");
}
function docNameFromSources(raw) {
  var fn = ($("fileName").textContent || "").trim();
  if (fn) return cleanDocNameJS(fn);
  var lines = String(raw || "").split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  var first = lines.length ? lines[0] : "";
  return first.length <= 60 ? first : "";
}

function buildSentences() {
  stopPlay();
  if (introPending !== null) {
    $("draftText").value = prependDocIntroJS(scrubReadingMarksJS($("draftText").value), introPending);
    introPending = null;
  }
  sentences = splitSentences($("draftText").value);
  playTitle = docNameFromSources($("draftText").value) || "muse19 在线听报告";
  curIdx = -1;
  fishCache = {}; fishBlobs = {};
  var ol = $("sentenceList");
  ol.innerHTML = "";
  sentences.forEach(function (s, i) {
    var li = document.createElement("li");
    li.textContent = s;
    li.addEventListener("click", function () { startAt(i); });
    ol.appendChild(li);
  });
  updateProgress();
  setStatus("playStatus", sentences.length ? "共 " + sentences.length + " 句，点任意一句可从该句开始读。" : "暂无可朗读的句子。");
}
$("buildSentencesBtn").addEventListener("click", buildSentences);

function updateProgress() {
  var total = sentences.length;
  var done = curIdx < 0 ? 0 : curIdx + (playing ? 0 : 1);
  $("progressBar").style.width = total ? Math.round((Math.max(0, curIdx) / total) * 100) + "%" : "0%";
  if (total) setStatus("playStatus",
    (playing ? "正在朗读" : "已定位") + "：第 " + (curIdx + 1) + " / " + total + " 句（共完成约 " + done + " 句定位）");
  var lis = $("sentenceList").children;
  for (var i = 0; i < lis.length; i++) {
    lis[i].classList.toggle("active", i === curIdx);
    lis[i].classList.toggle("done", curIdx >= 0 && i < curIdx);
  }
  var active = lis[curIdx];
  if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  syncFloatBtn();
}

function pickEdgeVoice() {
  var want = $("voiceSelect").value === "yunyang" ? "Yunyang" : "Xiaoxiao";
  var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  var v = voices.filter(function (x) { return x.name.indexOf(want) >= 0; })[0];
  if (!v) v = voices.filter(function (x) { return /^zh/i.test(x.lang || ""); })[0];
  if (!v) v = voices[0];
  if (v) $("actualVoice").textContent = "实际语音：" + v.name + (v.name.indexOf(want) < 0 ? "（浏览器未提供所选音色，已自动改用此语音）" : "");
  return v || null;
}

function speakEdge(idx, token) {
  var u = new SpeechSynthesisUtterance(sentences[idx]);
  var v = pickEdgeVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "zh-CN"; }
  u.rate = Number($("speedSelect").value) || 1;
  u.onend = function () { if (token === playToken && playing && !paused) { sentRetries = 0; skipStreak = 0; nextSentence(token); } };
  u.onerror = function (ev) {
    if (token !== playToken || !playing) return;
    var code = ev && ev.error ? ev.error : "";
    if (code === "interrupted" || code === "canceled") return; // 暂停/切句引起的误报，不算失败
    skipSentence(idx, token);
  };
  sentStartedAt = Date.now();
  window.speechSynthesis.speak(u);
}

function fetchFish(idx, retry) {
  if (fishCache[idx]) return Promise.resolve(fishCache[idx]);
  var pw = ensurePassword(false);
  if (!pw) return Promise.reject(new Error("未输入口令"));
  return fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Access-Password": pw },
    body: JSON.stringify({
      text: sentences[idx],
      voice: $("voiceSelect").value,
      speed: Number($("speedSelect").value) || 1,
    }),
  }).then(function (r) {
    if (r.status === 401 && !retry) {
      clearPassword();
      return fetchFish(idx, true);
    }
    if (!r.ok) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        throw new Error(d.error || ("Fish 接口返回 " + r.status));
      });
    }
    return r.blob();
  }).then(function (blob) {
    fishBlobs[idx] = blob;
    fishCache[idx] = URL.createObjectURL(blob);
    return fishCache[idx];
  });
}

function prefetchFish(fromIdx) {
  [fromIdx + 1, fromIdx + 2].forEach(function (i) {
    if (i < sentences.length && !fishCache[i]) fetchFish(i, false).catch(function () { /* 预合成失败不打断播放 */ });
  });
}

function speakFish(idx, token) {
  fetchStartedAt = Date.now();
  setStatus("playStatus", "正在合成第 " + (idx + 1) + " 句（Fish）…");
  fetchFish(idx, false).then(function (url) {
    if (token !== playToken || !playing) return;
    fetchStartedAt = 0;
    var au = new Audio(url);
    currentAudio = au;
    au.onended = function () { if (au._wdAdvanced) return; if (token === playToken && playing && !paused) { sentRetries = 0; skipStreak = 0; nextSentence(token); } };
    au.onerror = function () {
      if (token !== playToken || !playing) return;
      if (sentRetries < 1) {
        sentRetries++;
        delete fishCache[idx]; delete fishBlobs[idx]; // 坏缓存丢掉，重新合成这一句
        setStatus("playStatus", "第 " + (idx + 1) + " 句音频出错，正在重新合成重试…");
        setTimeout(function () { if (token === playToken && playing) speakFish(idx, token); }, 500);
        return;
      }
      sentRetries = 0;
      skipSentence(idx, token);
    };
    sentStartedAt = Date.now();
    lastProgressTime = -1; lastProgressAt = Date.now();
    var playPromise = au.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(function () {
        // 盲区修复（Lee 2026-11-09）：play() 被系统拒绝（锁屏/来电打断/iOS 拦截）不再
        // 整篇结束——旧代码在这里置 playing=false，看门狗从此不再管、永久停。
        // 改为保留朗读会话，把当前句交给看门狗：先原地重试一次，还不行就由
        // 看门狗按「被系统暂停」路径续播/重读本句；用户主动暂停/停止时 token 与
        // paused/playing 状态都会变，下面的重试会自动作废，不会跟用户抢。
        if (token !== playToken || !playing || paused) return;
        setStatus("playStatus", "第 " + (idx + 1) + " 句播放被系统打断，正在自动重试…");
        setTimeout(function () {
          if (token !== playToken || !playing || paused) return;
          if (currentAudio === au && au.paused && !au.ended) {
            var p2 = au.play();
            if (p2 && p2.catch) p2.catch(function () { /* 再失败交给看门狗 */ });
            sentStartedAt = Date.now();
          }
        }, 800);
      });
    }
    updateProgress();
    prefetchFish(idx);
  }).catch(function (err) {
    if (token !== playToken || !playing) return;
    if (sentRetries < 2) {
      sentRetries++;
      setStatus("playStatus", "第 " + (idx + 1) + " 句合成失败，自动重试（" + sentRetries + "/2）…");
      setTimeout(function () { if (token === playToken && playing) speakFish(idx, token); }, 800);
      return;
    }
    sentRetries = 0;
    var cur = $("voiceSelect").value;
    if (fishFailStage === 0 && (cur === "zhaoyang" || cur === "qijingchun")) {
      fishFailStage = 1;
      setStatus("playStatus", "Fish 该音色合成失败，自动切换到今日单双备选音色继续…");
      fishCache = {}; fishBlobs = {};
      setFishVoice(limitupVoiceKey());
      speakFish(idx, token);
      return;
    }
    if (fishFailStage <= 1) {
      fishFailStage = 2;
      var female = ["wenrou-zhiyu", "yulin-zhuanjia", "cctv13-nv", "zhaoyang", "changfa-nv", "yangshi-boyin"].indexOf(cur) >= 0;
      var edgeRadio = document.querySelector('input[name="source"][value="edge"]');
      if (edgeRadio) { edgeRadio.checked = true; renderVoiceOptions(); }
      $("voiceSelect").value = female ? "xiaoxiao" : "yunyang";
      setStatus("playStatus", "Fish 合成失败，已自动切换到 Edge 语音继续朗读。");
      speakEdge(idx, token);
      return;
    }
    skipSentence(idx, token);
  });
}

function skipSentence(idx, token) {
  if (token !== playToken || !playing) return;
  skipStreak++;
  sentRetries = 0;
  if (skipStreak >= 5) {
    playing = false;
    setStatus("playStatus", "连续 5 句朗读失败，已停止（可能是网络或语音服务异常）。停在第 " + (idx + 1) + " 句，点播放可从这里继续。");
    updateProgress();
    return;
  }
  setStatus("playStatus", "第 " + (idx + 1) + " 句朗读失败，已自动跳过，继续下一句。");
  nextSentence(token);
}

function startAt(idx) {
  if (!sentences.length) { setStatus("playStatus", "先生成文字稿。"); return; }
  fishFailStage = 0;
  sentRetries = 0; skipStreak = 0;
  if (idx < 0 || idx >= sentences.length) { stopPlay(); return; }
  haltCurrent();
  pauseMp3Player();
  mp3Active = false;
  playToken++;
  curIdx = idx;
  playing = true; paused = false;
  setupMediaSession("sentences");
  updateMediaMetadata();
  setMediaState("playing");
  updateProgress();
  if (currentSource() === "fish") speakFish(idx, playToken);
  else speakEdge(idx, playToken);
}

function nextSentence(token) {
  sentRetries = 0;
  if (curIdx + 1 >= sentences.length) {
    playing = false;
    setMediaState("none");
    syncFloatBtn();
    $("progressBar").style.width = "100%";
    setStatus("playStatus", "朗读完毕，共 " + sentences.length + " 句。");
    return;
  }
  curIdx++;
  updateProgress();
  updateMediaMetadata();
  if (currentSource() === "fish") speakFish(curIdx, token);
  else speakEdge(curIdx, token);
}

function haltCurrent() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentAudio) { try { currentAudio.pause(); } catch (e) { /* 忽略 */ } currentAudio = null; }
}

function stopPlay() {
  playToken++;
  haltCurrent();
  playing = false; paused = false;
  setMediaState("none");
  syncFloatBtn();
}

// ---------- 锁屏 / 切后台续播（Lee 2026-11-09 定） ----------
// 原理：逐句接龙靠页面脚本推进，锁屏/切后台时 iOS 会冻结脚本、系统会暂停音频，
// 回来后 onended 可能已经丢了。本组逻辑：回前台 + 每 4 秒看门狗检查——
// 还在正常出声就什么都不做；被系统暂停就续播同一句；一句已经播完但没接上
// 就作废旧回调、从下一句接龙；Edge 语音静默了就重读当前句。
// Media Session 让锁屏界面显示标题，并能用锁屏/耳机按钮暂停、继续、上下句。
function mediaSessionOK() { return "mediaSession" in navigator && typeof MediaMetadata !== "undefined"; }
function updateMediaMetadata() {
  if (!mediaSessionOK()) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: playTitle || "muse19 在线听报告",
      artist: sentences.length ? ("第 " + (curIdx + 1) + " / " + sentences.length + " 句") : "逐句朗读",
      album: "muse19 在线听报告"
    });
  } catch (e) { /* 不支持就算了 */ }
}
function setMediaState(st) {
  if (!("mediaSession" in navigator)) return;
  try { navigator.mediaSession.playbackState = st; } catch (e) { /* 忽略 */ }
}
function setupMediaSession(mode) {
  if (!("mediaSession" in navigator)) return;
  var ms = navigator.mediaSession;
  function set(action, fn) { try { ms.setActionHandler(action, fn); } catch (e) { /* 忽略 */ } }
  if (mode === "mp3") {
    set("play", function () { var a = $("mp3Player"); if (a) a.play(); });
    set("pause", function () { var a = $("mp3Player"); if (a) a.pause(); });
    set("previoustrack", null);
    set("nexttrack", null);
  } else {
    set("play", function () { resumePlayback(); });
    set("pause", function () { pausePlayback(); });
    set("previoustrack", function () { if (curIdx > 0) startAt(curIdx - 1); });
    set("nexttrack", function () { if (curIdx < sentences.length - 1) startAt(curIdx + 1); });
  }
}
function pausePlayback() {
  if (!playing || paused) return;
  $("pauseBtn").click();
}
function resumePlayback() {
  if (!playing) return;
  if (paused) { $("pauseBtn").click(); return; }
  recoverStalledPlayback();
}
function recoverStalledPlayback() {
  if (!playing || paused || curIdx < 0) return;
  var now = Date.now();
  if (now - lastRecoverAt < 3000) return;
  if (currentSource() === "fish") {
    var au = currentAudio;
    if (au && !au.paused && !au.ended) {
      // 盲区修复（Lee 2026-11-09）：不能只看 paused 标志判「正在出声」——声音实际
      // 卡住时标志仍是未暂停，旧代码会一直以为正常。改盯播放进度：进度在前进
      // 就不管；进度超过 6 秒纹丝不动（且没到句尾）按卡住处理，重读本句。
      if (au.currentTime !== lastProgressTime) { lastProgressTime = au.currentTime; lastProgressAt = now; return; }
      if (lastProgressAt && now - lastProgressAt < 6000) return;
      if (au.duration && au.currentTime >= au.duration - 0.3) return; // 贴近句尾，等 onended
      lastRecoverAt = now;
      lastProgressTime = -1; lastProgressAt = now;
      playToken++;
      setStatus("playStatus", "检测到播放卡住，已自动重读第 " + (curIdx + 1) + " 句。");
      speakFish(curIdx, playToken);
      return;
    }
    if (au && au.paused && !au.ended) {
      lastRecoverAt = now;
      var p = au.play();
      if (p && p.catch) p.catch(function () { /* 没续上等下一次机会 */ });
      sentStartedAt = now;
      setStatus("playStatus", "检测到播放被系统暂停，已自动续播（第 " + (curIdx + 1) + " 句）。");
      return;
    }
    if (fetchStartedAt && now - fetchStartedAt < 20000) return; // 还在合成宽限内
    if (!au && !fetchStartedAt && sentStartedAt && now - sentStartedAt < 3000) return;
    lastRecoverAt = now;
    playToken++; // 作废旧回调与在途合成，防迟到的 onended 串台
    var token = playToken;
    if (au && au.ended) {
      au._wdAdvanced = true; // 这句的 onended 若迟到也不再重复推进
      sentRetries = 0; skipStreak = 0;
      nextSentence(token);
    } else {
      setStatus("playStatus", "回来了，自动从第 " + (curIdx + 1) + " 句续播。");
      speakFish(curIdx, token);
    }
  } else {
    var ss = window.speechSynthesis;
    if (!ss) return;
    if (ss.speaking || ss.pending) return;
    if (sentStartedAt && now - sentStartedAt < 3000) return;
    lastRecoverAt = now;
    playToken++;
    setStatus("playStatus", "回来了，自动从第 " + (curIdx + 1) + " 句续播。");
    speakEdge(curIdx, playToken);
  }
}
document.addEventListener("visibilitychange", function () { if (!document.hidden) recoverStalledPlayback(); });
window.addEventListener("pageshow", function () { recoverStalledPlayback(); });
setInterval(function () { if (!document.hidden) recoverStalledPlayback(); }, 4000);

$("playBtn").addEventListener("click", function () { startAt(curIdx < 0 ? 0 : curIdx); });
$("stopBtn").addEventListener("click", function () { stopPlay(); setStatus("playStatus", "已停止。"); });
$("prevBtn").addEventListener("click", function () { if (curIdx > 0) startAt(curIdx - 1); });
$("nextBtn").addEventListener("click", function () { if (curIdx < sentences.length - 1) startAt(curIdx + 1); });
$("pauseBtn").addEventListener("click", function () {
  if (!playing) return;
  if (currentSource() === "fish") {
    if (!currentAudio) return;
    if (paused) { currentAudio.play(); paused = false; } else { currentAudio.pause(); paused = true; }
  } else {
    if (!window.speechSynthesis) return;
    if (paused) { window.speechSynthesis.resume(); paused = false; }
    else { window.speechSynthesis.pause(); paused = true; }
  }
  setMediaState(paused ? "paused" : "playing");
  setStatus("playStatus", paused ? "已暂停（第 " + (curIdx + 1) + " 句）。" : "继续朗读第 " + (curIdx + 1) + " 句。");
  syncFloatBtn();
});

// ---------- 下载整篇 MP3（仅 Fish，拼接已合成/逐句合成的音频） ----------
$("downloadBtn").addEventListener("click", function () {
  if (currentSource() !== "fish") return;
  if (!sentences.length) { setStatus("playStatus", "先生成文字稿。"); return; }
  setStatus("playStatus", "正在逐句合成并拼接整篇 MP3，句子多时会慢一些…");
  var chain = Promise.resolve();
  sentences.forEach(function (_, i) {
    chain = chain.then(function () { return fetchFish(i, false); });
  });
  chain.then(function () {
    var blobs = sentences.map(function (_, i) { return fishBlobs[i]; }).filter(Boolean);
    var whole = new Blob(blobs, { type: "audio/mpeg" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(whole);
    a.download = "朗读稿.mp3";
    a.click();
    setStatus("playStatus", "整篇 MP3 已生成下载（共 " + blobs.length + " 句拼接）。");
  }).catch(function (err) {
    setStatus("playStatus", "下载失败：" + err.message);
  });
});

// ---------- 初始化 ----------
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = function () { /* 语音列表就绪后挑音时再读 */ };
renderVoiceOptions();
loadHealth();

// ---------- 飞书待听 ----------
function fmtBJ(iso) {
  try {
    return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch (e) { return iso; }
}
function remainText(expiresIso) {
  var ms = new Date(expiresIso).getTime() - Date.now();
  if (ms <= 0) return "即将删除";
  var h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return "剩 " + h + " 小时 " + m + " 分删除";
}
async function inboxFetch(path, method, silent) {
  if (silent && !adminMode && !getPassword()) throw new Error("__need_auth__");
  var pw = await ensurePassword();
  if (!pw) throw new Error("未输入口令");
  var r = await fetch(path, { method: method || "GET", headers: { "X-Access-Password": pw } });
  if (r.status === 401) { clearPassword(); throw new Error("口令错误，请重试"); }
  var data = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(data.error || ("请求失败 " + r.status));
  return data;
}
// ---------- 待听搜索 + 分时分区（Lee 2026-11-10 定） ----------
// 分区口径（北京时间分钟数，左闭右开，空档已就近并入前一段）：
//   上午 06:00-11:00 → [360, 660)；中午 11:00-15:00 → [660, 900)；
//   下午 15:00-20:30 → [900, 1230)；晚上 20:30-次日 06:00 → 其余（[1230,1440) 与 [0,360)）。
//   边界整点归后一段：06:00 上午、11:00 中午、15:00 下午、20:30 晚上。
var INBOX_GROUPS = ["上午", "中午", "下午", "晚上"];
// 分区配色 class 后缀（Lee 2026-11-10 定）：上午淡蓝 morning / 中午橙 noon / 下午紫 afternoon / 晚上咖啡 night，具体色值在 style.css
var INBOX_GROUP_KEYS = { "上午": "morning", "中午": "noon", "下午": "afternoon", "晚上": "night" };
var inboxAllItems = []; // 最近一次拉到的全部待听（搜索/分区只在本地重渲染，不重复请求）
function inboxBjMinutes(iso) {
  try {
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
    var h = 0, m = 0;
    parts.forEach(function (pt) { if (pt.type === "hour") h = parseInt(pt.value, 10) % 24; if (pt.type === "minute") m = parseInt(pt.value, 10); });
    return h * 60 + m;
  } catch (e) { return 0; }
}
function inboxGroupName(iso) {
  var m = inboxBjMinutes(iso);
  if (m >= 360 && m < 660) return "上午";
  if (m >= 660 && m < 900) return "中午";
  if (m >= 900 && m < 1230) return "下午";
  return "晚上";
}
function inboxItemMatches(it, kw, scope) {
  if (!kw) return true;
  var k = kw.toLowerCase();
  var t = (it.file_name || "").toLowerCase();
  var b = (it.refined_text || "").toLowerCase();
  if (scope === "title") return t.indexOf(k) >= 0;
  if (scope === "body") return b.indexOf(k) >= 0;
  return t.indexOf(k) >= 0 || b.indexOf(k) >= 0; // title_body（默认档：标题＋正文）
}
// 待听标题标色（Lee 2026-11-10 定）：只在待听列表标题里，把「游资板学」四字以粉红+加粗显示，正文/来源不标。
// 仅渲染层：用文本节点+span 拼装，标题原文永不走 innerHTML，< > & 等字符不会被当标签解析；搜索仍按 it.file_name 原文匹配，不受影响。
function renderInboxTitle(el, name) {
  var title = name || "";
  var kw = "游资板学";
  el.textContent = "";
  var start = 0, idx = title.indexOf(kw, start);
  while (idx >= 0) {
    if (idx > start) el.appendChild(document.createTextNode(title.slice(start, idx)));
    var s = document.createElement("span");
    s.className = "hl-youzi";
    s.textContent = kw;
    el.appendChild(s);
    start = idx + kw.length;
    idx = title.indexOf(kw, start);
  }
  if (start < title.length) el.appendChild(document.createTextNode(title.slice(start)));
}
function buildInboxRow(it) {
  var row = document.createElement("div");
  row.className = "inbox-item inbox-item--" + (INBOX_GROUP_KEYS[inboxGroupName(it.created_at)] || "night");
  var modeLabel = ({minutes:"会议纪要",limitup:"涨停板朗读",usmapping:"美股映射朗读",morning:"早盘事件挖掘朗读",watchdog:"看门狗跟踪表朗读",xueqiu:"twitter雪球朗读",catalyst:"催化剂日报朗读",signal:"观点信号日报朗读",script:"协作朗读稿",clean:"清洗全文",limiao:"李淼基本面朗读",audio:"自带 MP3"})[it.mode] || "提炼要点";
  row.innerHTML = "<div class='inbox-name'></div><div class='hint'></div>";
  renderInboxTitle(row.querySelector(".inbox-name"), it.file_name);
  var estMin = Math.max(1, Math.round((it.char_count || 0) / 300));
  var mp3Pending = it.provider === "mp3_pending";
  row.querySelector(".hint").textContent = "上架时间 " + fmtBJ(it.created_at) + " · 来源：" + (it.source || "muse19") + " · " + modeLabel + " · " + it.char_count + " 字 · 约 " + estMin + " 分钟 · " + remainText(it.expires_at) + (mp3Pending ? " · MP3 待补（Fish 恢复后自动补）" : "");
  var playBtn = document.createElement("button");
  playBtn.textContent = mp3Pending ? "一键收听（Edge）" : "听这个";
  playBtn.className = "primary";
  playBtn.addEventListener("click", function () { playInbox(it.id, it.file_name, mp3Pending); });
  var delBtn = document.createElement("button");
  delBtn.textContent = "删除";
  delBtn.addEventListener("click", function () { deleteInbox(it.id, it.file_name); });
  var btnRow = document.createElement("div");
  btnRow.className = "row";
  var listenLabel = document.createElement("label");
  listenLabel.className = "listened-toggle";
  var listenBox = document.createElement("input");
  listenBox.type = "checkbox";
  listenBox.checked = !!it.listened;
  listenLabel.appendChild(listenBox);
  listenLabel.appendChild(document.createTextNode(" 已听"));
  listenBox.addEventListener("change", function () { toggleListened(it.id, listenBox, row); });
  btnRow.appendChild(listenLabel);
  if (it.listened) {
    row.classList.add("listened");
    var tag = document.createElement("span");
    tag.className = "listened-tag";
    tag.textContent = "已听";
    row.querySelector(".inbox-name").appendChild(tag);
  }
  btnRow.appendChild(playBtn);
  if (it.has_audio && it.audio_url && !mp3Pending) {
    var mp3Btn = document.createElement("button");
    mp3Btn.textContent = "播 MP3";
    mp3Btn.addEventListener("click", function () { playMp3(it.audio_url, it.file_name, mp3Btn); });
    btnRow.appendChild(mp3Btn);
  }
  btnRow.appendChild(delBtn);
  row.appendChild(btnRow);
  return row;
}
function renderInbox() {
  var box = $("inboxList");
  if (!box) return;
  var kwEl = $("inboxSearch"), scopeEl = $("inboxSearchScope");
  var kw = kwEl ? kwEl.value.trim() : "";
  var scope = scopeEl ? scopeEl.value : "title_body";
  // 组内最新在最上面：先按上架时间倒序，再按 上午→中午→下午→晚上 分组（空组不显示）
  var sorted = inboxAllItems.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
  var visible = sorted.filter(function (it) { return inboxItemMatches(it, kw, scope); });
  box.innerHTML = "";
  if (!visible.length) {
    box.innerHTML = kw
      ? "<p class='hint'>没有搜到符合的待听，换个关键词试试。</p>"
      : "<p class='hint'>暂无待听。把文档发到专用朗读群，处理好后会出现在这里。</p>";
  } else {
    INBOX_GROUPS.forEach(function (g) {
      var items = visible.filter(function (it) { return inboxGroupName(it.created_at) === g; });
      if (!items.length) return;
      var head = document.createElement("div");
      head.className = "inbox-group-title inbox-group-title--" + (INBOX_GROUP_KEYS[g] || "night");
      head.textContent = g;
      box.appendChild(head);
      items.forEach(function (it) { box.appendChild(buildInboxRow(it)); });
    });
  }
  if (kw) setStatus("inboxStatus", "共 " + inboxAllItems.length + " 条待听，搜到 " + visible.length + " 条（自动更新）");
  else if (inboxAllItems.length) setStatus("inboxStatus", "共 " + inboxAllItems.length + " 条待听（自动更新）");
}
var inboxSearchEl = $("inboxSearch"), inboxScopeEl = $("inboxSearchScope"), inboxClearEl = $("inboxSearchClear");
if (inboxSearchEl) inboxSearchEl.addEventListener("input", renderInbox); // 边打边出
if (inboxScopeEl) inboxScopeEl.addEventListener("change", renderInbox);
if (inboxClearEl) inboxClearEl.addEventListener("click", function () { if (inboxSearchEl) inboxSearchEl.value = ""; renderInbox(); });
async function loadInbox(silent) {
  var box = $("inboxList");
  if (!silent) setStatus("inboxStatus", "正在加载…");
  try {
    var data = await inboxFetch("/api/inbox", "GET", silent);
    if (!data.configured) {
      inboxAllItems = [];
      box.innerHTML = "";
      setStatus("inboxStatus", "待听功能尚未配置（站长需在 Cloudflare 补 Supabase 变量）");
      return;
    }
    inboxAllItems = data.items || [];
    renderInbox();
    if (!inboxAllItems.length) setStatus("inboxStatus", "");
  } catch (e) {
    if (e.message === "__need_auth__") {
      box.innerHTML = "";
      setStatus("inboxStatus", "登录管理员后这里会自动列出待听稿子");
    } else if (!silent) {
      setStatus("inboxStatus", e.message || String(e));
    }
  }
}
// 常驻 MP3 播放器（Lee 2026-11-09 定）：播放器在待听列表之外（index.html 的 mp3PlayerWrap），
// 列表每 60 秒自动重建只重建 inboxList，碰不到它，整篇 MP3 不会再被刷新掐断。
var mp3PlayerBtn = null; // 当前占用常驻播放器的那颗「播 MP3」按钮（切歌时复位其文字）
var mp3Active = false;   // 常驻 MP3 是否处于待命/播放中（悬浮暂停键的管辖判断）
function playMp3(url, name, btn) {
  var wrap = $("mp3PlayerWrap"), au = $("mp3Player");
  if (!wrap || !au) return;
  if (au.getAttribute("src") === url && wrap.style.display !== "none") {
    au.pause(); au.removeAttribute("src"); au.load();
    wrap.style.display = "none";
    if (mp3PlayerBtn) mp3PlayerBtn.textContent = "播 MP3";
    mp3PlayerBtn = null;
    mp3Active = false;
    syncFloatBtn();
    return;
  }
  stopPlay(); // 与逐句朗读互斥，避免两路同时出声
  if (mp3PlayerBtn && mp3PlayerBtn !== btn) mp3PlayerBtn.textContent = "播 MP3";
  mp3PlayerBtn = btn || null;
  mp3Active = true;
  if (btn) btn.textContent = "关 MP3";
  $("mp3PlayerName").textContent = "正在播 MP3：" + name;
  setupMediaSession("mp3");
  if (mediaSessionOK()) {
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: name, artist: "飞书待听 MP3", album: "muse19 在线听报告" }); } catch (e) { /* 忽略 */ }
  }
  setMediaState("playing");
  wrap.style.display = "";
  au.src = url;
  var p = au.play();
  if (p && p.catch) p.catch(function () { setStatus("inboxStatus", "浏览器拦了自动播放，点 MP3 播放器上的播放键即可"); });
  syncFloatBtn();
}
function pauseMp3Player() {
  var au = $("mp3Player");
  if (au && !au.paused) { try { au.pause(); } catch (e) { /* 忽略 */ } }
}
var mp3CloseBtn = $("mp3PlayerClose");
if (mp3CloseBtn) mp3CloseBtn.addEventListener("click", function () {
  var au = $("mp3Player"), wrap = $("mp3PlayerWrap");
  if (au) { au.pause(); au.removeAttribute("src"); au.load(); }
  if (wrap) wrap.style.display = "none";
  if (mp3PlayerBtn) { mp3PlayerBtn.textContent = "播 MP3"; mp3PlayerBtn = null; }
  mp3Active = false;
  syncFloatBtn();
});
var mp3PlayerEl = $("mp3Player");
if (mp3PlayerEl) {
  mp3PlayerEl.addEventListener("error", function () {
    if (mp3PlayerEl.getAttribute("src")) setStatus("inboxStatus", "MP3 加载出错，可能还没生成好，请用「听这个」");
  });
  mp3PlayerEl.addEventListener("play", function () { setMediaState("playing"); syncFloatBtn(); });
  mp3PlayerEl.addEventListener("pause", function () { setMediaState("paused"); syncFloatBtn(); });
  mp3PlayerEl.addEventListener("ended", function () { setMediaState("none"); mp3Active = false; syncFloatBtn(); });
}

// ---------- 右下角悬浮暂停键（Lee 2026-11-09 定，圆形、只管暂停/继续） ----------
// 跟读时原暂停键在第四步卡片里、滚下去就够不着；这个键 position:fixed 跟着
// 视口走，朗读会话中（含暂停待续）常驻右下角，停了/读完自动消失。
// 管辖：逐句朗读优先，其次常驻 MP3；逐句侧直接借用原暂停键的点击逻辑，
// 状态与页面按钮、锁屏按钮天然同步。
function syncFloatBtn() {
  var btn = $("floatPauseBtn");
  if (!btn) return;
  var show = false, icon = "⏸";
  if (playing) {
    show = true; icon = paused ? "▶" : "⏸";
  } else if (mp3Active) {
    var au = $("mp3Player");
    if (au && au.getAttribute("src")) { show = true; icon = au.paused ? "▶" : "⏸"; }
  }
  btn.style.display = show ? "block" : "none";
  if (show) btn.textContent = icon;
  var cbtn = $("floatCopyBtn");
  if (cbtn) cbtn.style.display = (playing && curIdx >= 0 && sentences.length) ? "block" : "none";
}
var floatPauseEl = $("floatPauseBtn");
if (floatPauseEl) floatPauseEl.addEventListener("click", function () {
  if (playing) {
    $("pauseBtn").click();
  } else if (mp3Active) {
    var au = $("mp3Player");
    if (au) {
      if (au.paused) { var p = au.play(); if (p && p.catch) p.catch(function () { /* 忽略 */ }); }
      else au.pause();
    }
  }
  syncFloatBtn();
});

// ---------- 右下角悬浮复制键（Lee 2026-11-09 定，紧挨暂停键，只复制当前这一句） ----------
// 用法：读到/点到哪句、在哪句暂停，点它就把那一句原文复制到剪贴板，去别处粘贴。
// 只管逐句朗读（MP3 模式没有句，不出现）；点它不改变播放状态，暂停着仍暂停。
var floatCopyEl = $("floatCopyBtn");
if (floatCopyEl) floatCopyEl.addEventListener("click", function () {
  if (!sentences.length || curIdx < 0) return;
  var text = sentences[curIdx];
  var idx = curIdx;
  function done(ok) {
    if (ok) {
      floatCopyEl.textContent = "已复制";
      setStatus("playStatus", "已复制第 " + (idx + 1) + " 句。");
      setTimeout(function () { floatCopyEl.textContent = "复制"; }, 1200);
    } else {
      setStatus("playStatus", "复制失败，请长按句子列表里那句话手动复制。");
    }
  }
  function fallback() {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand("copy");
      document.body.removeChild(ta);
      done(!!ok);
    } catch (e) { done(false); }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
  } else fallback();
});

async function playInbox(id, name, useEdge) {
  introPending = null;  // 待听是存量稿，播放不加第一句、不回头改
  setStatus("inboxStatus", "正在载入：" + name);
  try {
    var data = await inboxFetch("/api/inbox?id=" + encodeURIComponent(id));
    var it = data.item;
    if (typeof stopPlayback === "function") stopPlayback();
    $("draftText").value = it.refined_text || "";
    if (useEdge) {
      // MP3 待补条目（Lee 2026-11-07 定）：一键收听默认走浏览器 Edge，按当日 Fish 音色性别配对（女→晓晓、男→云扬）
      var edgeRadio = document.querySelector('input[name="source"][value="edge"]');
      if (edgeRadio) { edgeRadio.checked = true; renderVoiceOptions(); }
      var femaleKeys = ["wenrou-zhiyu", "yulin-zhuanjia", "cctv13-nv", "zhaoyang", "changfa-nv", "yangshi-boyin"];
      $("voiceSelect").value = femaleKeys.indexOf(defaultVoiceKey()) >= 0 ? "xiaoxiao" : "yunyang";
      buildSentences();
      setStatus("inboxStatus", "已载入「" + name + "」，正在开始朗读（Edge " + ($("voiceSelect").value === "yunyang" ? "云扬" : "晓晓") + "；暂停/换音色在第四步）");
    } else {
      var voiceKey = defaultVoiceKey();
      setFishVoice(voiceKey);
      var voiceName = voiceNameOf(voiceKey);
      buildSentences();
      setStatus("inboxStatus", "已载入「" + name + "」，正在开始朗读（Fish " + voiceName + "；暂停/换音色在第四步）");
    }
    playTitle = name || playTitle;
    try {
      startAt(0);
    } catch (e) {
      setStatus("inboxStatus", "已载入「" + name + "」，浏览器拦了自动播放，点第四步的播放键即可");
    }
  } catch (e) {
    setStatus("inboxStatus", e.message || String(e));
  }
}
async function toggleListened(id, box, row) {
  var want = box.checked;
  try {
    var pw = await ensurePassword();
    if (!pw) throw new Error("未输入口令");
    var r = await fetch("/api/inbox", {
      method: "POST",
      headers: { "X-Access-Password": pw, "Content-Type": "application/json" },
      body: JSON.stringify({ id: id, listened: want }),
    });
    if (r.status === 401) { clearPassword(); throw new Error("口令错误，请重试"); }
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || ("标记失败 " + r.status));
    row.classList.toggle("listened", want);
    var nameEl = row.querySelector(".inbox-name");
    var old = nameEl.querySelector(".listened-tag");
    if (want && !old) {
      var tag = document.createElement("span");
      tag.className = "listened-tag";
      tag.textContent = "已听";
      nameEl.appendChild(tag);
    } else if (!want && old) {
      old.remove();
    }
  } catch (e) {
    box.checked = !want;
    setStatus("inboxStatus", e.message || String(e));
  }
}

async function deleteInbox(id, name) {
  if (!window.confirm("删除这条待听？\n" + name + "\n删了就没了。")) return;
  try {
    await inboxFetch("/api/inbox?id=" + encodeURIComponent(id), "DELETE");
    loadInbox();
  } catch (e) {
    setStatus("inboxStatus", e.message || String(e));
  }
}
// 待听列表自动加载与定时刷新（不用手动刷新）：登录管理员或已有口令时自动列出，页面开着每 60 秒自更新
setInterval(function () { loadInbox(true); }, 60000);

// ---------- 管理员登录 ----------
function renderAdminUI(user) {
  adminMode = !!user;
  $("adminStatus").textContent = user ? ("管理员：" + user + "（已登录，免输口令）") : "管理员：未登录";
  $("adminUser").style.display = user ? "none" : "";
  $("adminPass").style.display = user ? "none" : "";
  $("adminLoginBtn").style.display = user ? "none" : "";
  $("adminLogoutBtn").style.display = user ? "" : "none";
}
async function loadAdminStatus() {
  try {
    var r = await fetch("/api/admin");
    var d = await r.json();
    if (!d.configured) {
      $("adminStatus").textContent = "管理员：未配置（站长需在 Cloudflare 设置 ADMIN_USERNAME / ADMIN_PASSWORD）";
      $("adminUser").style.display = "none";
      $("adminPass").style.display = "none";
      $("adminLoginBtn").style.display = "none";
      return;
    }
    renderAdminUI(d.admin ? d.user : "");
    loadInbox(true);
  } catch (e) { /* 状态拉取失败不阻塞使用 */ }
}
$("adminLoginBtn").addEventListener("click", async function () {
  var username = $("adminUser").value.trim();
  var password = $("adminPass").value;
  if (!username || !password) { $("adminStatus").textContent = "请先填账号和密码"; return; }
  try {
    var r = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", username: username, password: password }),
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) { $("adminStatus").textContent = d.error || "登录失败"; return; }
    $("adminPass").value = "";
    renderAdminUI(d.user || username);
    loadInbox(true);
  } catch (e) {
    $("adminStatus").textContent = "登录请求失败：" + (e.message || e);
  }
});
$("adminLogoutBtn").addEventListener("click", async function () {
  try {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
  } catch (e) { /* 忽略 */ }
  renderAdminUI("");
});
loadAdminStatus();
try { setFishVoice(defaultVoiceKey()); } catch (e) { /* 页面初始默认音色按周规则选好（周六赵阳/周日齐静春/平日单双轮换），用户仍可手动改 */ }

// ===== 涨停板朗读（游资板学专用分段拼装，与本地流水线 limitup.py 同口径） =====
function limitupVoiceKey() {
  var day = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", day: "numeric" }).format(new Date()));
  return day % 2 === 1 ? "xinwen-nan" : "cctv13-nv";
}
function defaultVoiceKey() {
  // 默认音色（Lee 2026-11-07 定）：周六固定赵阳（女）、周日固定齐静春（男），覆盖单双轮换；
  // 周一至周五维持日期单双：奇数天新闻男、偶数天 CCTV13 播报女。睡前音频是独立排班，不用此规则。
  var wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(new Date());
  if (wd === "Sat") return "zhaoyang";
  if (wd === "Sun") return "qijingchun";
  return limitupVoiceKey();
}
function voiceNameOf(key) {
  for (var i = 0; i < FISH_VOICES.length; i++) { if (FISH_VOICES[i][0] === key) return FISH_VOICES[i][1]; }
  return key;
}
function setFishVoice(key) {
  var fishRadio = document.querySelector('input[name="source"][value="fish"]');
  if (fishRadio) { fishRadio.checked = true; renderVoiceOptions(); }
  var vs = $("voiceSelect");
  for (var i = 0; i < vs.options.length; i++) { if (vs.options[i].value === key) { vs.value = key; break; } }
}
function luLines(html) {
  var t = String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "");
  t = t.replace(/<\/(p|div|li|tr|h1|h2|h3|h4|section|article)>/gi, "\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/t[dh]>/gi, "｜");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  return t.split("\n").map(function (s) { return s.replace(/[ \t]+/g, " ").trim().replace(/^｜+|｜+$/g, "").trim(); }).filter(function (s) { return s; });
}
function luRows(tableHtml) {
  var rows = [];
  var trs = String(tableHtml || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];
  trs.forEach(function (tr) {
    var cells = [], m, re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    while ((m = re.exec(tr))) cells.push(m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    if (cells.some(function (c) { return c; })) rows.push(cells);
  });
  return rows;
}
function luBlocks(bodyHtml) {
  var blocks = [], pos = 0, m, re = /<table[\s\S]*?<\/table>/gi;
  while ((m = re.exec(bodyHtml))) {
    if (m.index > pos) blocks.push({ kind: "text", html: bodyHtml.slice(pos, m.index) });
    blocks.push({ kind: "table", html: m[0] });
    pos = m.index + m[0].length;
  }
  if (pos < bodyHtml.length) blocks.push({ kind: "text", html: bodyHtml.slice(pos) });
  return blocks;
}
function luSplitH2(html) {
  var parts = String(html || "").split(/(<h2[^>]*>[\s\S]*?<\/h2>)/gi);
  var out = [["", parts[0] || ""]];
  for (var i = 1; i < parts.length; i += 2) {
    out.push([luLines(parts[i]).join(""), parts[i + 1] || ""]);
  }
  return out;
}
function luFind(sections, kw) {
  for (var i = 0; i < sections.length; i++) { if (sections[i][0].indexOf(kw) >= 0) return sections[i][1]; }
  return "";
}
function luSectorTable(rows) {
  if (!rows.length) return null;
  var head = rows[0];
  function col(n) { return head.indexOf(n); }
  var iB = col("板块"), iN = col("涨停数"), iL = col("龙一/最高连板"), iT = col("梯队"), iD = col("核心驱动一句话");
  if (iB < 0 || iL < 0) return null;
  var lines = ["板块强弱速览。"];
  rows.slice(1).forEach(function (r) {
    function g(i) { return i >= 0 && i < r.length ? r[i] : ""; }
    lines.push(g(iB) + "，涨停" + g(iN) + "只，龙一/最高连板：" + g(iL) + "，梯队：" + g(iT) + "。核心驱动：" + g(iD));
  });
  return lines;
}
function luGenericTable(rows, dropCols) {
  if (!rows.length) return [];
  var head = rows[0];
  var keep = head.map(function (h, i) { return dropCols.indexOf(h) < 0 ? i : -1; }).filter(function (i) { return i >= 0; });
  var lines = [];
  rows.slice(1).forEach(function (r) {
    var parts = [];
    keep.forEach(function (i) { if (i < r.length && r[i]) parts.push(head[i] ? head[i] + " " + r[i] : r[i]); });
    if (parts.length) lines.push(parts.join("，") + "。");
  });
  return lines;
}
function luFirstBoard(rows) {
  // 首板精选：兼容旧表头（精选理由/判定依据）与 2026-11-11 起新表头
  // （首板时间/产业逻辑/持续性/卡位预判/超级预判双条件）；空值/缺失不拼标签，
  // 绝不输出「精选理由：。」式空占位（2026-11-11 bug 教训，与本地 limitup.py 同步）。
  if (!rows.length) return [];
  var head = rows[0];
  function col() {
    for (var k = 0; k < arguments.length; k++) {
      var idx = head.indexOf(arguments[k]);
      if (idx >= 0) return idx;
    }
    return -1;
  }
  function missing(v) { return !v || ["缺失", "无", "-", "—"].indexOf(String(v).trim()) >= 0; }
  var iS = col("个股（代码）", "个股");
  if (iS < 0) return luGenericTable(rows, []);
  var iR = col("精选理由"), iB = col("判定依据");
  var lines = [];
  if (iR >= 0 || iB >= 0) {
    rows.slice(1).forEach(function (r) {
      function g(i) { return i >= 0 && i < r.length ? String(r[i]).trim() : ""; }
      if (!g(iS)) return;
      var seg = g(iS) + "。";
      if (!missing(g(iR))) seg += "精选理由：" + g(iR) + "。";
      if (!missing(g(iB))) seg += "判定依据：" + g(iB) + "。";
      lines.push(seg);
    });
    return lines;
  }
  var iT = col("首板时间", "封板时间"), iL = col("产业逻辑"), iSu = col("持续性");
  var iP = col("卡位预判"), iSup = col("超级预判双条件");
  if (iL < 0 && iSu < 0) return luGenericTable(rows, []);
  rows.slice(1).forEach(function (r) {
    function g(i) { return i >= 0 && i < r.length ? String(r[i]).trim() : ""; }
    if (!g(iS)) return;
    var seg = g(iS);
    if (!missing(g(iT))) seg += "，" + g(iT) + "首板";
    seg += "。";
    if (!missing(g(iL))) seg += "产业逻辑：" + g(iL) + "。";
    if (!missing(g(iSu))) seg += "持续性：" + g(iSu) + "。";
    if (!missing(g(iP))) seg += "卡位预判：" + g(iP) + "。";
    if (!missing(g(iSup))) seg += "超级预判双条件：" + g(iSup) + "。";
    lines.push(seg);
  });
  return lines;
}

function luSummaryTable(rows) {
  if (!rows.length) return [];
  var KEEP = ["新事件（主题）", "个股（代码）", "今日板况", "最新相关信息", "催化进展", "催化剂", "时间节点", "状态", "影响（一句话）"];
  var head = rows[0];
  var keep = [];
  head.forEach(function (h, i) { if (KEEP.indexOf(h) >= 0) keep.push(i); });
  if (!keep.length) return luGenericTable(rows, []);
  var lines = [];
  rows.slice(1).forEach(function (r) {
    var parts = [];
    keep.forEach(function (i) { if (i < r.length && r[i]) parts.push(r[i]); });
    if (parts.length) lines.push(parts.join("，"));
  });
  return lines;
}

function luIsMissingLine(t) {
  var s = String(t || "").replace(/\s+/g, "").replace(/^[。．.]+|[。．.]+$/g, "");
  return s === "缺失" || /^[^：:。]{1,12}[：:]缺失$/.test(s);
}
function luEmphasizeFirstBoard(t) {
  return String(t || "").indexOf("首板先锋") === 0 ? "首板重点。" + t : t;
}
function luStripCodes(t) {
  return String(t || "")
    .replace(/[（(]\s*\d{6}(?:\.(?:SH|SZ|BJ))?\s*[)）]/g, "")
    .replace(/(^|[^\d.])\d{6}(?![\d.])/g, "$1")
    .replace(/ {2,}/g, " ");
}
function luSectionLines(bodyHtml, tableFn) {
  var out = [];
  luBlocks(bodyHtml).forEach(function (b) {
    if (b.kind === "text") { out = out.concat(luLines(b.html)); }
    else {
      var conv = tableFn ? tableFn(luRows(b.html)) : null;
      out = out.concat(conv === null ? luLines(b.html) : conv);
    }
  });
  return out;
}
function luDeep(html) {
  var m, re = /<(h[23])[^>]*>([\s\S]*?)<\/\1>/gi, target = null;
  while ((m = re.exec(html))) { if (luLines(m[2]).join("").indexOf("七股深度分析") >= 0) { target = m; break; } }
  if (!target) return "";
  var start = target.index + target[0].length;
  var rest = html.slice(start);
  var cut = rest.search(/<h2[^>]*>/i);
  if (target[1] === "h3") {
    var cut3 = rest.search(/<h3[^>]*>/i);
    if (cut3 >= 0 && (cut < 0 || cut3 < cut)) cut = cut3;
  }
  return cut >= 0 ? rest.slice(0, cut) : rest;
}
async function buildLimitup() {
  var LU_SOFT = 4400 - 130, LU_HARD = 5600 - 220;
  var provider = $("providerSelect").value;
  var html = window.__lastHtml && /<h2/i.test(window.__lastHtml) ? window.__lastHtml : null;
  if (!html) {
    setStatus("processStatus", "涨停板朗读需要上传原始 HTML 文件（粘贴文本没有分段结构）。请上传游资板学 HTML 后再点生成。");
    return;
  }
  setStatus("processStatus", "涨停板朗读：正在按分段规则拼装（直读部分＋三段小兵提炼）…");
  var sections = luSplitH2(html);
  var conclusion = luSectionLines(luFind(sections, "核心结论"), function (rows) { return luSectorTable(rows); });
  var sentiment = luLines(luFind(sections, "情绪指标"));
  var panorama = luSectionLines(luFind(sections, "涨停板全景"), null).filter(function (x) { return !luIsMissingLine(x); }).map(function (x) { return luEmphasizeFirstBoard(x); });
  var leader = luSectionLines(luFind(sections, "龙头跟踪"), function (rows) { return luGenericTable(rows, ["收盘价", "今日涨幅"]); });
  var firstboard = luSectionLines(luFind(sections, "首板精选"), function (rows) { return luFirstBoard(rows); });
  var deep = luLines(luDeep(html));
  var summaries = {};
  var jobs = [["sentiment", "情绪指标"], ["leader", "龙头跟踪"], ["catalyst", "板块催化分析"], ["events", "新事件涨停板"], ["outlook", "明日前瞻"]];
  for (var j = 0; j < jobs.length; j++) {
    var key = jobs[j][0];
    var rawSec = luSectionLines(luFind(sections, jobs[j][1]), key === "leader" ? function (rows) { return luGenericTable(rows, ["收盘价", "今日涨幅"]); } : function (rows) { return luSummaryTable(rows); }).join("\n");
    if (!rawSec) { summaries[key] = ""; continue; }
    if (key === "outlook" && rawSec.length <= 320) { summaries[key] = rawSec.replace(/\n/g, ""); continue; }
    rawSec = rawSec.slice(0, 4000);
    try {
      var r = await callRefineWithFallback(provider, rawSec.slice(0, 16000), "limitup");
      summaries[key] = (r.text || "").trim();
    } catch (e) {
      summaries[key] = rawSec.slice(0, 400);
    }
  }
  function block(h, lines) { return lines && lines.length ? h + "\n" + lines.join("\n") : ""; }
  var guaranteed = [
    block("一、核心结论", conclusion), block("二、情绪指标（提炼）", summaries.sentiment ? [summaries.sentiment] : sentiment),
    block("四、涨停板全景（按板块归类）", panorama), block("六、首板精选（重点）", firstboard),
    block("八、板块催化分析（提炼）", summaries.catalyst ? [summaries.catalyst] : []),
    block("九、新事件涨停板（提炼）", summaries.events ? [summaries.events] : []),
    block("十、明日前瞻（提炼）", summaries.outlook ? [summaries.outlook] : [])
  ];
  var total = guaranteed.join("").length;
  var notes = [];
  function fillTo(lines, room) {
    var kept = [], used = 0;
    for (var i = 0; i < lines.length; i++) {
      if (used + lines[i].length + 8 > room) break;
      kept.push(lines[i]); used += lines[i].length + 1;
    }
    return kept;
  }
  var leaderText = block("五、龙头跟踪（提炼）", summaries.leader ? [summaries.leader] : []);
  total += leaderText.length;
  var deepKept = fillTo(deep, LU_SOFT - total);
  total += block("七、个股深度分析", deepKept).length;
  if (deepKept.length < deep.length) {
    var moreD = fillTo(deep.slice(deepKept.length), LU_HARD - total);
    moreD.forEach(function (x) { total += x.length + 1; });
    deepKept = deepKept.concat(moreD);
  }
  if (deepKept.length < deep.length) notes.push("七、个股深度分析因时长控制，" + (deepKept.length ? "部分省略" : "已省略"));
  var deepText = block("七、个股深度分析", deepKept);
  var ordered = [
    block("一、核心结论", conclusion), block("二、情绪指标（提炼）", summaries.sentiment ? [summaries.sentiment] : sentiment),
    block("四、涨停板全景（按板块归类）", panorama), leaderText,
    block("六、首板精选（重点）", firstboard), deepText,
    block("八、板块催化分析（提炼）", summaries.catalyst ? [summaries.catalyst] : []),
    block("九、新事件涨停板（提炼）", summaries.events ? [summaries.events] : []),
    block("十、明日前瞻（提炼）", summaries.outlook ? [summaries.outlook] : [])
  ].filter(function (b) { return b; });
  var text = ordered.join("\n\n").split("\n").map(function (ln) { return luStripCodes(ln).trim(); }).join("\n");
  if (notes.length) text += "\n\n时长说明：" + notes.join("；") + "。";
  $("draftText").value = text;
  var vk = defaultVoiceKey();
  setFishVoice(vk);
  $("refineInfo").textContent = "涨停板朗读模式：分段拼装完成，全文约 " + text.length + " 字（15 分钟预算内）；已自动选声：" + voiceNameOf(vk) + "。";
  setStatus("processStatus", "涨停板朗读稿已生成（第三步），到第四步点播放即可。");
  buildSentences();
}
