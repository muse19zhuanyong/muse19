#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
qqmuse 在线朗读工作台「龙猫乡野夏日风」主题脚本（v4，幂等可重跑）。

沿革：
- v1 扁平矢量景被 Lee 否（不像宫崎骏、无龙猫元素）。
- v2（Lee 口径：龙猫元素必备、鲜花多于绿植、绿色少用、强调色淡黄/橙/浅蓝；
  小兵三家分工出主意、qqmuse 整合）：静态横幅 + 全站配色。
- v3 按 Lee 令去掉标题与按钮上的花朵 emoji。
- v4「活场景」（Lee 2026-11-07 定，参考图：树枝远望/草地撑伞/花田/溪边钓鱼/趴看蝌蚪）：
  横幅改为内联 SVG，龙猫 + 草壁姐妹（姐姐黄衫橙裙、妹妹红裙双辫草帽）入住；
  北京时间每 6 小时换一集（05:30 晨间散步 / 11:30 溪边钓鱼 / 17:30 树枝黄昏 /
  23:30 夜晚站牌安睡），00:00–05:30 整个落在夜集内、不发生换集；
  集数与动作全部由网页自带脚本 ghibli.js 按时钟维持——纯前端、零后端、
  零 AI 维持（Lee 硬要求：生成后网页内容要脚本维持而不是 AI 维持）。
  集内微动：散步集真走动（castWrap 横移 + 腿臂摆动）、钓鱼集浮漂/蝴蝶、
  黄昏集落叶/腿轻晃、夜集呼吸起伏/Zzz/星月。prefers-reduced-motion 时全停。

主题机制：覆盖作用域 html.ghibli-on，默认开，页眉按钮可切简洁版
（localStorage reader-theme=plain）；集数显隐由 CSS 的 svg[data-ep="N"] 规则控制，
ghibli.js 只负责算集数、设角色位移与下一次换集定时。
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent
PUB = ROOT / "public"
VER = "20261109-1"

SVG = r"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label="龙猫乡野夏日">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5ea9e6"/><stop offset=".5" stop-color="#a5d8f5"/><stop offset=".82" stop-color="#fdf0cd"/>
  </linearGradient>
  <radialGradient id="sunGlow" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#ffedb8" stop-opacity=".9"/><stop offset="1" stop-color="#ffedb8" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="totoroBody" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#6b7a70"/><stop offset="1" stop-color="#4e5a52"/>
  </linearGradient>
  <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#efe7c2"/><stop offset="1" stop-color="#e6d9a8"/>
  </linearGradient>
  <filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="1.1"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .55 0"/></filter>
  <style>
    .cloud{animation:drift 80s ease-in-out infinite alternate}
    .cloud2{animation:drift 110s ease-in-out infinite alternate-reverse}
    @keyframes drift{from{transform:translateX(-12px)}to{transform:translateX(20px)}}
    @media (prefers-reduced-motion: reduce){.cloud,.cloud2{animation:none}}
  </style>
</defs>
<rect width="1200" height="300" fill="url(#sky)"/>
<circle cx="150" cy="42" r="105" fill="url(#sunGlow)"/><circle cx="150" cy="42" r="24" fill="#ffe27a"/>
<g class="cloud">
  <g fill="#ffffff"><ellipse cx="330" cy="86" rx="120" ry="24"/><ellipse cx="272" cy="62" rx="64" ry="30"/>
  <ellipse cx="330" cy="42" rx="56" ry="34"/><ellipse cx="392" cy="60" rx="62" ry="28"/><ellipse cx="330" cy="70" rx="88" ry="26"/></g>
  <ellipse cx="330" cy="90" rx="76" ry="10" fill="#cfdff0" opacity=".55" filter="url(#soft)"/>
</g>
<g class="cloud2">
  <g fill="#ffffff" opacity=".92"><ellipse cx="706" cy="58" rx="76" ry="17"/><ellipse cx="668" cy="40" rx="40" ry="20"/><ellipse cx="716" cy="34" rx="34" ry="22"/></g>
  <ellipse cx="706" cy="62" rx="44" ry="8" fill="#cfdff0" opacity=".55" filter="url(#soft)"/>
</g>
<!-- 星月（夜集显示） -->
<g id="sceneStars" display="none" fill="#ffffff">
  <circle cx="60" cy="30" r="2"/><circle cx="150" cy="58" r="1.6"/><circle cx="240" cy="24" r="1.8"/><circle cx="420" cy="36" r="1.5"/>
  <circle cx="520" cy="20" r="2"/><circle cx="660" cy="44" r="1.5"/><circle cx="760" cy="26" r="1.8"/><circle cx="880" cy="20" r="1.5"/>
  <circle cx="1080" cy="30" r="1.7"/><circle cx="1150" cy="58" r="1.5"/><circle cx="330" cy="64" r="1.3"/><circle cx="980" cy="60" r="1.3"/>
  <path d="M92 18 a17 17 0 1 0 10 27 a13.5 13.5 0 1 1 -10 -27 Z" fill="#fdf6d8"/>
</g>
<path d="M452 52 q7 -7 14 0 M474 46 q7 -7 14 0" stroke="#4a6a80" stroke-width="2.2" fill="none" stroke-linecap="round"/>
<path d="M0 196 Q 240 148 520 178 T 1200 168 V300 H0 Z" fill="#b3c9ab"/>
<path d="M0 216 Q 300 182 640 202 T 1200 196 V300 H0 Z" fill="#a2bd97" opacity=".85"/>
<g opacity=".9">
  <path d="M30 216 L172 216 L164 230 L40 230 Z" fill="#bcd9ea"/>
  <path d="M44 234 L182 234 L174 246 L56 246 Z" fill="#a9cfe8"/>
  <path d="M44 223 h104 M58 240 h100" stroke="#eaf6ff" stroke-width="2" opacity=".7"/>
</g>
<g>
  <rect x="118" y="176" width="76" height="44" rx="4" fill="#fff6dd"/>
  <path d="M106 180 L156 150 L206 180 Z" fill="#c96f4a"/>
  <rect x="146" y="194" width="19" height="26" rx="3" fill="#8a5a3b"/>
  <rect x="126" y="186" width="14" height="12" rx="2" fill="#bfe3f2"/><rect x="172" y="186" width="14" height="12" rx="2" fill="#bfe3f2"/>
</g>
<path d="M0 246 Q 320 226 660 240 T 1200 234 V300 H0 Z" fill="url(#ground)"/>
<path d="M700 300 C 740 272 776 262 806 254 L838 254 C 806 268 772 282 748 300 Z" fill="#f4ecd2"/>
<!-- 小溪（溪边集显示） -->
<g id="scenePond" display="none">
  <path d="M0 252 Q 320 240 640 250 T 1200 244 V300 H0 Z" fill="#a9cfe8"/>
  <ellipse cx="300" cy="272" rx="90" ry="7" fill="#ffffff" opacity=".28"/><ellipse cx="820" cy="284" rx="120" ry="8" fill="#ffffff" opacity=".22"/>
  <ellipse cx="180" cy="278" rx="13" ry="4.6" fill="#7fae72"/><ellipse cx="1050" cy="272" rx="11" ry="4" fill="#7fae72"/><circle cx="180" cy="274" r="3.4" fill="#f6a8c1"/>
  <g fill="#3a3f45"><circle cx="700" cy="280" r="2.6"/><circle cx="742" cy="288" r="2.4"/><circle cx="664" cy="290" r="2.2"/></g>
  <g stroke="#3a3f45" stroke-width="1.4" fill="none"><path d="M702 280 q6 2 8 6"/><path d="M744 288 q6 2 8 5"/></g>
  <g stroke="#8ba573" stroke-width="2.4" fill="none"><path d="M28 262 q3 -14 8 -20 M40 264 q-1 -12 -6 -18 M1170 258 q3 -13 8 -19"/></g>
</g>
<!-- 大树枝（树枝集显示） -->
<g id="sceneBranch" display="none">
  <path d="M96 252 C 320 218 560 204 920 184" stroke="#7a4f2c" stroke-width="13" fill="none" stroke-linecap="round"/>
  <path d="M420 212 C 470 196 510 192 548 192" stroke="#7a4f2c" stroke-width="7" fill="none" stroke-linecap="round"/>
  <g fill="#7fae72"><circle cx="104" cy="238" r="16"/><circle cx="128" cy="228" r="13"/><circle cx="906" cy="172" r="15"/><circle cx="930" cy="182" r="12"/><circle cx="548" cy="184" r="11"/></g>
</g>
<!-- 公交站牌 -->
<g id="propSign">
  <rect x="791" y="146" width="7" height="100" rx="3" fill="#8a6a4e"/>
  <circle cx="794" cy="132" r="27" fill="#d9534a"/><circle cx="794" cy="132" r="20" fill="#fff8e7"/>
  <rect x="782" y="124" width="24" height="13" rx="3" fill="#35618e"/>
  <rect x="785" y="127" width="5" height="4" fill="#dff1ff"/><rect x="792" y="127" width="5" height="4" fill="#dff1ff"/><rect x="799" y="127" width="5" height="4" fill="#dff1ff"/>
  <circle cx="787" cy="139" r="2.4" fill="#3a3f45"/><circle cx="801" cy="139" r="2.4" fill="#3a3f45"/>
</g>
<g id="castWrap">
<!-- 大龙猫（形象按 Lee 参考图：深灰绿巨身、奶油肚、^形肚纹） -->
<g id="castTotoro" stroke-linejoin="round">
  <ellipse cx="900" cy="260" rx="22" ry="7" fill="#43514a"/><ellipse cx="980" cy="260" rx="22" ry="7" fill="#43514a"/>
  <path d="M894 106 L904 56 L922 100 Z" fill="#55645b"/><path d="M958 100 L976 56 L986 106 Z" fill="#55645b"/>
  <path d="M940 92 C 1002 92 1032 148 1030 204 C 1028 246 992 266 940 266 C 888 266 852 246 850 204 C 848 148 878 92 940 92 Z" fill="url(#totoroBody)"/>
  <ellipse cx="862" cy="206" rx="13" ry="30" fill="#525f57" transform="rotate(12 862 206)"/>
  <ellipse cx="1018" cy="180" rx="12" ry="28" fill="#525f57" transform="rotate(-30 1018 180)"/>
  <ellipse cx="940" cy="218" rx="53" ry="45" fill="#f3e9cf"/>
  <g stroke="#55645b" stroke-width="4" fill="none" stroke-linecap="round"><path d="M904 205 q7 -8 14 0 M933 197 q7 -8 14 0 M962 205 q7 -8 14 0 M918 223 q7 -8 14 0 M948 223 q7 -8 14 0"/></g>
  <circle cx="912" cy="136" r="7.6" fill="#fff"/><circle cx="968" cy="136" r="7.6" fill="#fff"/>
  <circle cx="913" cy="134.5" r="3.6" fill="#26221f"/><circle cx="967" cy="134.5" r="3.6" fill="#26221f"/>
  <circle cx="914.4" cy="133" r="1.2" fill="#fff"/><circle cx="968.4" cy="133" r="1.2" fill="#fff"/>
  <ellipse cx="940" cy="148" rx="9" ry="4.2" fill="#33302e"/>
  <path d="M923 162 q17 10 34 0" stroke="#33302e" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <g stroke="#3f4a44" stroke-width="2.2" stroke-linecap="round"><path d="M868 140 L834 132 M866 153 L832 153 M868 166 L836 174 M1012 140 L1046 132 M1014 153 L1048 153 M1012 166 L1044 174"/></g>
  <g id="propUmbrella">
    <rect x="1004" y="76" width="4" height="104" rx="2" fill="#3a3f45"/>
    <path d="M948 84 Q1006 22 1064 84 Q1035 70 1006 84 Q977 70 948 84 Z" fill="#2f3338"/>
  </g>
  <g id="propRod" display="none">
    <path d="M862 190 L730 84" stroke="#8a5a33" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <path d="M730 84 L730 244" stroke="#ffffff" stroke-width="1.1" opacity=".65"/>
    <ellipse cx="730" cy="254" rx="4" ry="6" fill="#e2543e"><animate attributeName="cy" values="254;250;254" dur="2.2s" repeatCount="indefinite"/></ellipse>
  </g>
</g>
<!-- 中号蓝龙猫（奶油肚 + 肚纹） -->
<g id="castChu">
  <path d="M674 210 L681 190 L691 208 Z" fill="#5f7f9c"/><path d="M694 208 L705 190 L709 210 Z" fill="#5f7f9c"/>
  <ellipse cx="692" cy="231" rx="28" ry="26" fill="#6a86a0"/>
  <ellipse cx="692" cy="242" rx="17" ry="13.5" fill="#f3e9cf"/>
  <g stroke="#5f7f9c" stroke-width="2.2" fill="none" stroke-linecap="round"><path d="M681 238 q4 -4.5 8 0 M695 238 q4 -4.5 8 0 M688 247 q4 -4.5 8 0"/></g>
  <circle cx="682" cy="224" r="3.2" fill="#26221f"/><circle cx="702" cy="224" r="3.2" fill="#26221f"/>
  <ellipse cx="692" cy="230" rx="3.4" ry="2.2" fill="#3a3f45"/>
</g>
<!-- 白色小龙猫（抱橡子，浅肚纹） -->
<g id="castChibi">
  <path d="M615 233 L619 219 L626 232 Z" fill="#f1eee2"/><path d="M634 232 L641 219 L644 233 Z" fill="#f1eee2"/>
  <ellipse cx="630" cy="247" rx="17" ry="15" fill="#fdfcf6"/>
  <ellipse cx="630" cy="252" rx="10" ry="8" fill="#f7f2df"/>
  <g stroke="#c9c2ab" stroke-width="1.8" fill="none" stroke-linecap="round"><path d="M623 250 q3.5 -4 7 0 M633 250 q3.5 -4 7 0"/></g>
  <circle cx="623" cy="242" r="2.4" fill="#26221f"/><circle cx="637" cy="242" r="2.4" fill="#26221f"/>
  <ellipse cx="646" cy="255" rx="6" ry="7" fill="#a9743f"/><path d="M640 251 q6 -5 12 0 l0 3 l-12 0 Z" fill="#7c4f27"/>
</g>
<!-- 姐姐（形象按参考图：深色发+低马尾、黄衫橙裙） -->
<g id="castSatsuki" transform="translate(470,254)"><g>
  <g class="legL"><rect x="-7" y="-30" width="5.4" height="24" rx="2.7" fill="#f6cfa5"/><ellipse cx="-4.3" cy="-3.6" rx="4.6" ry="2.8" fill="#8a4f35"/></g>
  <g class="legR"><rect x="1.6" y="-30" width="5.4" height="24" rx="2.7" fill="#f6cfa5"/><ellipse cx="4.3" cy="-3.6" rx="4.6" ry="2.8" fill="#8a4f35"/></g>
  <g class="armL"><rect x="-15.5" y="-58" width="5.6" height="23" rx="2.8" fill="#f6cfa5"/><rect x="-15.5" y="-59" width="5.6" height="9" rx="2.8" fill="#ffd94d"/></g>
  <g class="armR"><rect x="9.9" y="-58" width="5.6" height="23" rx="2.8" fill="#f6cfa5"/><rect x="9.9" y="-59" width="5.6" height="9" rx="2.8" fill="#ffd94d"/></g>
  <polygon points="-13,-32 13,-32 16,-12 -16,-12" fill="#ff8c42"/>
  <rect x="-11" y="-62" width="22" height="32" rx="5" fill="#ffd94d"/>
  <circle cx="0" cy="-88" r="12.5" fill="#2e2a26"/>
  <rect x="-14.5" y="-90" width="6.5" height="26" rx="3.2" fill="#2e2a26"/><rect x="8" y="-90" width="6.5" height="26" rx="3.2" fill="#2e2a26"/>
  <path d="M10 -94 q13 4 10 21 q-1 8 -6 11 q3 -17 -4 -32 Z" fill="#2e2a26"/>
  <circle cx="0" cy="-85.5" r="9.8" fill="#f6cfa5"/>
  <path d="M-9.8 -87 Q0 -99 9.8 -87 L9.8 -90.5 Q0 -100.5 -9.8 -90.5 Z" fill="#2e2a26"/>
  <circle cx="-8.2" cy="-90.5" r="1.8" fill="#e2543e"/>
  <ellipse cx="-3.6" cy="-84.5" rx="1.5" ry="2.1" fill="#26221f"/><ellipse cx="3.6" cy="-84.5" rx="1.5" ry="2.1" fill="#26221f"/>
  <circle cx="-3.1" cy="-85.3" r=".6" fill="#fff"/><circle cx="4.1" cy="-85.3" r=".6" fill="#fff"/>
  <path d="M-5.6 -89.2 q2 -1.7 3.9 0 M1.7 -89.2 q2 -1.7 3.9 0" stroke="#2e2a26" stroke-width=".9" fill="none" stroke-linecap="round"/>
  <path d="M-2.2 -78.6 Q0 -76.6 2.2 -78.6" stroke="#b06a3b" stroke-width="1.3" fill="none" stroke-linecap="round"/>
</g></g>
<!-- 妹妹（形象按参考图：棕色双马尾、红背带裙） -->
<g id="castMei" transform="translate(524,256)"><g>
  <g class="legL"><rect x="-6.4" y="-27" width="5" height="21" rx="2.5" fill="#f6cfa5"/><ellipse cx="-3.9" cy="-3.4" rx="4.3" ry="2.6" fill="#c9452c"/></g>
  <g class="legR"><rect x="1.4" y="-27" width="5" height="21" rx="2.5" fill="#f6cfa5"/><ellipse cx="3.9" cy="-3.4" rx="4.3" ry="2.6" fill="#c9452c"/></g>
  <g class="armL"><rect x="-14.5" y="-52" width="5.2" height="21" rx="2.6" fill="#f6cfa5"/><rect x="-14.5" y="-53" width="5.2" height="9" rx="2.6" fill="#ffffff"/></g>
  <g class="armR"><rect x="9.3" y="-52" width="5.2" height="21" rx="2.6" fill="#f6cfa5"/><rect x="9.3" y="-53" width="5.2" height="9" rx="2.6" fill="#ffffff"/></g>
  <polygon points="-12,-29 12,-29 15,-11 -15,-11" fill="#e2604d"/>
  <rect x="-10.5" y="-56" width="21" height="29" rx="5" fill="#e2604d"/>
  <rect x="-10.5" y="-56" width="21" height="7" rx="3.5" fill="#ffffff"/>
  <g id="propHat">
    <ellipse cx="0" cy="-76" rx="15" ry="4.6" fill="#eed9a4"/>
    <path d="M-9 -76 a9 7.5 0 0 1 18 0 Z" fill="#f4e3b2"/>
    <path d="M-9 -77.5 a9 3.4 0 0 1 18 0 l0 2.4 a9 3.4 0 0 1 -18 0 Z" fill="#e2543e"/>
  </g>
  <circle cx="-14" cy="-60" r="6.5" fill="#6b4430"/><circle cx="14" cy="-60" r="6.5" fill="#6b4430"/>
  <circle cx="0" cy="-70" r="11.5" fill="#6b4430"/>
  <circle cx="0" cy="-67.5" r="9.2" fill="#f6cfa5"/>
  <path d="M-9.2 -69 L9.2 -69 L9.2 -73.5 Q0 -80.5 -9.2 -73.5 Z" fill="#6b4430"/>
  <circle cx="-11" cy="-66.5" r="2.4" fill="#e2543e"/><circle cx="11" cy="-66.5" r="2.4" fill="#e2543e"/>
  <ellipse cx="-3.4" cy="-66.5" rx="1.4" ry="2" fill="#26221f"/><ellipse cx="3.4" cy="-66.5" rx="1.4" ry="2" fill="#26221f"/>
  <circle cx="-2.9" cy="-67.3" r=".55" fill="#fff"/><circle cx="3.9" cy="-67.3" r=".55" fill="#fff"/>
  <path d="M-2 -60.8 Q0 -58.6 2 -60.8" stroke="#b06a3b" stroke-width="1.3" fill="none" stroke-linecap="round"/>
</g></g>
</g>
<!-- 蝴蝶（溪边集） -->
<g id="sceneFlies" display="none">
  <g transform="translate(408,232)"><g class="flyA"><ellipse cx="-4" cy="-3" rx="4.6" ry="2.6" fill="#ffd9e6" transform="rotate(-24)"/><ellipse cx="4" cy="-3" rx="4.6" ry="2.6" fill="#ffd9e6" transform="rotate(24)"/><rect x="-1" y="-4" width="2" height="8" rx="1" fill="#5d4a3a"/></g></g>
  <g transform="translate(660,222)"><g class="flyB"><ellipse cx="-4" cy="-3" rx="4.6" ry="2.6" fill="#fff3c4" transform="rotate(-24)"/><ellipse cx="4" cy="-3" rx="4.6" ry="2.6" fill="#fff3c4" transform="rotate(24)"/><rect x="-1" y="-4" width="2" height="8" rx="1" fill="#5d4a3a"/></g></g>
</g>
<!-- 落叶（黄昏集） -->
<g id="sceneLeaves" display="none" fill="#8abb7f">
  <g transform="translate(300,150)"><ellipse class="leafA" rx="6" ry="3.4"/></g>
  <g transform="translate(560,132)"><ellipse class="leafB" rx="5" ry="3"/></g>
  <g transform="translate(820,146)"><ellipse class="leafC" rx="6" ry="3.4"/></g>
</g>
<!-- Zzz（夜集） -->
<g id="propZzz" display="none" fill="#eaf4ff" font-weight="700">
  <text x="1006" y="104" font-size="15">Z</text><text x="1024" y="86" font-size="19">Z</text><text x="1046" y="64" font-size="24">Z</text>
</g>
<!-- 橡子小径 -->
<g fill="#a9743f"><ellipse cx="724" cy="262" rx="5" ry="6"/><ellipse cx="756" cy="270" rx="5" ry="6"/><ellipse cx="700" cy="276" rx="5" ry="6"/></g>
<g fill="#7c4f27"><path d="M719 259 q5 -4 10 0 l0 3 l-10 0 Z"/><path d="M751 267 q5 -4 10 0 l0 3 l-10 0 Z"/><path d="M695 273 q5 -4 10 0 l0 3 l-10 0 Z"/></g>
<!-- 前景花海 -->
<g>
  <g>
    <circle cx="76" cy="266" r="15" fill="#86aede"/><circle cx="98" cy="258" r="13" fill="#aecdf0"/><circle cx="120" cy="268" r="14" fill="#86aede"/><circle cx="88" cy="278" r="12" fill="#aecdf0"/><circle cx="112" cy="280" r="11" fill="#86aede"/>
    <circle cx="140" cy="258" r="14" fill="#a493e0"/><circle cx="162" cy="266" r="13" fill="#c3b8ee"/><circle cx="150" cy="276" r="12" fill="#a493e0"/>
    <circle cx="192" cy="268" r="14" fill="#eda9c6"/><circle cx="212" cy="260" r="12" fill="#f7c9dd"/><circle cx="204" cy="280" r="12" fill="#eda9c6"/>
    <circle cx="424" cy="264" r="14" fill="#a493e0"/><circle cx="446" cy="272" r="12" fill="#c3b8ee"/><circle cx="486" cy="258" r="13" fill="#86aede"/><circle cx="506" cy="268" r="12" fill="#aecdf0"/>
    <circle cx="540" cy="268" r="13" fill="#eda9c6"/><circle cx="560" cy="260" r="11" fill="#f7c9dd"/>
    <circle cx="1072" cy="264" r="14" fill="#eda9c6"/><circle cx="1094" cy="272" r="12" fill="#f7c9dd"/><circle cx="1128" cy="258" r="13" fill="#86aede"/><circle cx="1148" cy="268" r="12" fill="#aecdf0"/><circle cx="1138" cy="280" r="11" fill="#86aede"/>
    <circle cx="292" cy="278" r="12" fill="#86aede"/><circle cx="312" cy="270" r="11" fill="#aecdf0"/>
    <g fill="#ffffff"><circle cx="96" cy="264" r="2.4"/><circle cx="152" cy="262" r="2.4"/><circle cx="200" cy="268" r="2.4"/><circle cx="436" cy="266" r="2.4"/><circle cx="496" cy="262" r="2.4"/><circle cx="1084" cy="266" r="2.4"/><circle cx="1138" cy="264" r="2.4"/></g>
  </g>
  <g stroke="#93a97e" stroke-width="2.4"><path d="M310 300 L306 252 M356 300 L360 258 M846 300 L850 256 M986 300 L982 258"/></g>
  <g>
    <g fill="#f6a8c1"><ellipse cx="306" cy="246" rx="6" ry="10"/><ellipse cx="306" cy="246" rx="6" ry="10" transform="rotate(72 306 246)"/><ellipse cx="306" cy="246" rx="6" ry="10" transform="rotate(144 306 246)"/><ellipse cx="306" cy="246" rx="6" ry="10" transform="rotate(216 306 246)"/><ellipse cx="306" cy="246" rx="6" ry="10" transform="rotate(288 306 246)"/></g>
    <g fill="#ffffff"><ellipse cx="850" cy="250" rx="6" ry="10"/><ellipse cx="850" cy="250" rx="6" ry="10" transform="rotate(72 850 250)"/><ellipse cx="850" cy="250" rx="6" ry="10" transform="rotate(144 850 250)"/><ellipse cx="850" cy="250" rx="6" ry="10" transform="rotate(216 850 250)"/><ellipse cx="850" cy="250" rx="6" ry="10" transform="rotate(288 850 250)"/></g>
    <g fill="#ffd9e6"><ellipse cx="360" cy="253" rx="5" ry="8"/><ellipse cx="360" cy="253" rx="5" ry="8" transform="rotate(90 360 253)"/><ellipse cx="360" cy="253" rx="5" ry="8" transform="rotate(180 360 253)"/><ellipse cx="360" cy="253" rx="5" ry="8" transform="rotate(270 360 253)"/></g>
    <g fill="#f7b731"><circle cx="306" cy="246" r="4"/><circle cx="850" cy="250" r="4"/><circle cx="360" cy="253" r="3.4"/></g>
  </g>
  <g stroke="#93a97e" stroke-width="3.4"><path d="M36 300 L32 208 M1176 300 L1180 224"/></g>
  <g fill="#ffc93c">
    <ellipse cx="32" cy="196" rx="8.5" ry="17"/><ellipse cx="32" cy="196" rx="8.5" ry="17" transform="rotate(45 32 196)"/><ellipse cx="32" cy="196" rx="8.5" ry="17" transform="rotate(90 32 196)"/><ellipse cx="32" cy="196" rx="8.5" ry="17" transform="rotate(135 32 196)"/><ellipse cx="32" cy="196" rx="8.5" ry="17" transform="rotate(180 32 196)"/><ellipse cx="32" cy="196" rx="8.5" ry="17" transform="rotate(225 32 196)"/><ellipse cx="32" cy="196" rx="8.5" ry="17" transform="rotate(270 32 196)"/><ellipse cx="32" cy="196" rx="8.5" ry="17" transform="rotate(315 32 196)"/>
    <ellipse cx="1180" cy="214" rx="7.5" ry="15"/><ellipse cx="1180" cy="214" rx="7.5" ry="15" transform="rotate(60 1180 214)"/><ellipse cx="1180" cy="214" rx="7.5" ry="15" transform="rotate(120 1180 214)"/><ellipse cx="1180" cy="214" rx="7.5" ry="15" transform="rotate(180 1180 214)"/><ellipse cx="1180" cy="214" rx="7.5" ry="15" transform="rotate(240 1180 214)"/><ellipse cx="1180" cy="214" rx="7.5" ry="15" transform="rotate(300 1180 214)"/>
  </g>
  <circle cx="32" cy="196" r="13" fill="#8a5a3b"/><circle cx="1180" cy="214" r="11" fill="#8a5a3b"/>
  <g>
    <circle cx="240" cy="282" r="4.6" fill="#ff9d5c"/><circle cx="272" cy="292" r="4" fill="#ef6f6c"/><circle cx="398" cy="290" r="4.4" fill="#ffd93c"/>
    <circle cx="600" cy="292" r="4" fill="#eda9c6"/><circle cx="660" cy="284" r="4.2" fill="#ffd93c"/><circle cx="770" cy="290" r="4.2" fill="#ef6f6c"/>
    <circle cx="906" cy="290" r="4" fill="#ffd93c"/><circle cx="1040" cy="288" r="4.4" fill="#ff9d5c"/><circle cx="150" cy="292" r="4" fill="#ffd93c"/>
    <circle cx="330" cy="288" r="4.4" fill="#f6a8c1"/><circle cx="470" cy="294" r="4" fill="#ff9d5c"/><circle cx="716" cy="292" r="4.2" fill="#f6a8c1"/>
    <circle cx="812" cy="286" r="3.8" fill="#ffd93c"/><circle cx="946" cy="282" r="3.6" fill="#ff9d5c"/><circle cx="1006" cy="292" r="4.2" fill="#ef6f6c"/>
  </g>
  <g fill="#26221f"><circle cx="468" cy="284" r="8"/><circle cx="1052" cy="286" r="7"/><circle cx="646" cy="290" r="6.4"/></g>
  <g fill="#fff"><circle cx="465.4" cy="282" r="2.3"/><circle cx="470.6" cy="282" r="2.3"/><circle cx="1049.8" cy="284" r="2"/><circle cx="1054.2" cy="284" r="2"/><circle cx="644" cy="288.4" r="1.8"/><circle cx="648" cy="288.4" r="1.8"/></g>
</g>
<rect id="tintSunset" width="1200" height="300" fill="#ff9d5c" opacity="0"/>
<rect id="tintNight" width="1200" height="300" fill="#1d3557" opacity="0"/>
<rect width="1200" height="300" fill="url(#sunGlow)" opacity=".30"/>
<rect width="1200" height="300" filter="url(#grain)" opacity=".05"/>
</svg>
"""

CSS = r"""/* 龙猫乡野夏日风 v4（中档）— apply_ghibli_theme.py 生成，纯静态零模型调用。
   口径（Lee 2026-11-07）：鲜花多于绿植；绿色少用，按钮选中态也不用绿，
   强调色 = 淡黄/橙/浅蓝；标题/按钮不带花朵 emoji。
   集数显隐：svg[data-ep="N"] 系列规则（集数由 ghibli.js 按北京时间设置）。 */

html.ghibli-on{--accent:#dd7f1f;--border:#e7dcc3;--bg:#f9f6eb;--muted:#7a6a55}

.ghibli-toggle{border-radius:999px;border:1px solid #f0a13a;background:#ffedb3;color:#7a4a12;
  padding:6px 16px;font-size:13px;cursor:pointer;margin-top:8px}
.ghibli-toggle:hover{border-color:#dd7f1f}
.ghibli-scene{display:none}
html.ghibli-on .ghibli-scene{display:block;max-width:860px;margin:10px auto 0;padding:0 16px}
html.ghibli-on .ghibli-scene svg{width:100%;height:170px;display:block;border-radius:18px;
  box-shadow:0 4px 18px rgba(160,110,40,.20)}
/* 原画版图层 + 横幅切换 + 下页散步（v5 扩展） */
.ghibli-scene{position:relative}
#scenePhoto{position:absolute;left:16px;right:16px;top:0;height:170px;margin:0;overflow:hidden;border-radius:18px}
#scenePhoto[hidden]{display:none}
#scenePhotoBg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(16px) brightness(.92);transform:scale(1.15)}
#scenePhotoFg{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transition:opacity .8s}
#scenePhotoTint{position:absolute;inset:0;pointer-events:none;transition:opacity 1.2s;opacity:0}
.ghibli-scene[data-mode="photo"] svg#sceneSvg{visibility:hidden}
.scene-switch{position:absolute;right:26px;bottom:8px;z-index:6;display:flex;gap:6px}
.scene-switch button{font-size:12px;padding:3px 12px;border-radius:999px;background:rgba(255,248,225,.94);border:1px solid #e0d3ae;color:#5b4a2f;cursor:pointer;box-shadow:none;margin:0}
.scene-switch button.on{background:#a8d8ff;border-color:#8ec9ee;color:#22252a;font-weight:600}
#totoroRoam{position:fixed;left:0;top:-300px;width:92px;z-index:90;pointer-events:none;opacity:0;transition:opacity .6s}
#totoroRoam .travel{position:relative}
#totoroRoam .shadow{position:absolute;left:13px;bottom:-3px;width:66px;height:10px;border-radius:50%;background:rgba(60,50,30,.20)}
#totoroRoam.flip .flip{transform:scaleX(-1)}
#totoroRoam .bob{animation:stepBob .72s linear infinite}
@keyframes stepBob{0%,50%,100%{transform:translateY(0)}25%,75%{transform:translateY(-2.5px)}}
#totoroRoam .fL,#totoroRoam .fR{transform-box:fill-box;transform-origin:center;animation:stepFoot .72s linear infinite}
#totoroRoam .fR{animation-delay:-.36s}
@keyframes stepFoot{0%{transform:translate(-6px,0)}30%{transform:translate(6px,-4px)}55%{transform:translate(6px,0)}100%{transform:translate(-6px,0)}}
#totoroRoam.umb .bob,#totoroRoam.umb .fL,#totoroRoam.umb .fR{animation-play-state:paused}
#totoroRoam .u{display:none}
#totoroRoam.umb .u{display:block}
/* 铺景两版（中档/全页）：景只在卡片之外，正文与数字不动 */
.scenery-switch{left:26px;right:auto}
html.ghibli-on[data-scenery="mid"] body{background:linear-gradient(180deg,#e9f2fa 0%,#fdf6e3 55%,#fdf6e3 100%)}
html.ghibli-on[data-scenery="full"] body{background:linear-gradient(180deg,#d9edfc 0%,#f3ecd9 60%,#eee3c6 100%)}
#pageScenery{display:none}
html.ghibli-on[data-scenery="mid"] #pageScenery,html.ghibli-on[data-scenery="full"] #pageScenery{display:block}
.sc-hills{position:fixed;left:0;right:0;bottom:0;height:190px;z-index:-1;pointer-events:none;opacity:.45;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 190' preserveAspectRatio='none'%3E%3Cpath d='M0 90 Q 200 30 420 74 T 840 60 T 1200 84 V190 H0 Z' fill='%23cfdde8'/%3E%3Cpath d='M0 132 Q 260 84 520 118 T 980 108 T 1200 126 V190 H0 Z' fill='%23e7dcbc'/%3E%3C/svg%3E") bottom center/cover no-repeat}
html[data-scenery="full"] .sc-hills{opacity:.75}
.sc-cloud{position:fixed;z-index:-1;pointer-events:none;width:180px;height:42px;border-radius:999px;background:rgba(255,255,255,.8);opacity:.30;animation:cloudDrift 150s ease-in-out infinite alternate}
.sc-cloud::before,.sc-cloud::after{content:"";position:absolute;border-radius:50%;background:rgba(255,255,255,.8)}
.sc-cloud::before{width:74px;height:74px;left:26px;top:-34px}
.sc-cloud::after{width:52px;height:52px;right:22px;top:-22px}
.sc-cloud.c1{top:13%;left:5%}
.sc-cloud.c2{top:27%;right:7%;width:240px;animation-duration:195s}
.sc-cloud.c3{top:49%;left:10%;width:140px;animation-duration:175s;opacity:.2}
html[data-scenery="full"] .sc-cloud{opacity:.5}
html[data-scenery="full"] .sc-cloud.c3{opacity:.36}
@keyframes cloudDrift{from{transform:translateX(-24px)}to{transform:translateX(34px)}}
.sc-footer{margin:28px auto 0;max-width:860px;padding:0 16px 12px}
.sc-foot-drawn svg{width:100%;height:150px;display:block;border-radius:18px;box-shadow:0 4px 18px rgba(160,110,40,.16)}
.sc-footer img{display:none;width:100%;height:230px;object-fit:cover;border-radius:18px;box-shadow:0 4px 18px rgba(160,110,40,.20)}
html[data-scenery="full"] .sc-footer{display:none}
.sc-side{display:none;position:fixed;top:33%;width:168px;z-index:0;pointer-events:none;margin:0}
.sc-side img{width:100%;display:block;border:6px solid #fffdf6;border-radius:10px;box-shadow:0 8px 24px rgba(120,90,40,.25)}
.sc-left{left:22px;transform:rotate(-2.5deg)}
.sc-right{right:22px;transform:rotate(2.5deg)}
/* 全页版已改为整页入画，两侧挂画退场 */
html[data-scenery="full"] .card h2::before{content:"";display:inline-block;width:15px;height:15px;margin-right:7px;vertical-align:-2px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2 L21 10 H3 Z' fill='%238a5a33'/%3E%3Cellipse cx='12' cy='15' rx='7' ry='6.5' fill='%23c98d4b'/%3E%3C/svg%3E") center/contain no-repeat}
/* 全页版·入画定版（Lee 23:04 对齐）：三张原图轮流整页打底、随页滚动，内容是剪出的干净窗口，全页无横幅 */
html[data-scenery="full"] body{position:relative}
.sc-backdrop{position:absolute;inset:0;z-index:-1;pointer-events:none;background-repeat:no-repeat;background-position:center top;background-size:cover;opacity:0;transition:opacity 1.2s}
html[data-scenery="full"] .sc-backdrop{opacity:1}
html[data-scenery="full"] .sc-hills,html[data-scenery="full"] .sc-cloud{display:none}
html[data-scenery="full"] .ghibli-scene{display:none}
html[data-scenery="full"] header{background:transparent;box-shadow:none;border:none}
html[data-scenery="full"] header h1,html[data-scenery="full"] header p{text-shadow:0 1px 0 rgba(255,255,255,.7),0 0 16px rgba(255,255,255,.55)}
.scene-switch.floating{position:fixed;top:10px;right:12px;left:auto;bottom:auto;z-index:95}

html.ghibli-on body{background:linear-gradient(180deg,#dcefff 0,#f9f6eb 240px,#f9f6eb 100%);color:#33302a}
html.ghibli-on .topbar{background:linear-gradient(180deg,#a8d8ff,#fdf3d8);border-bottom:2px solid #f0d9a0}
html.ghibli-on .topbar h1{color:#35618e;letter-spacing:.04em}
html.ghibli-on .subtitle{color:#7a6a55}

html.ghibli-on .card{background:#fffdf6;border:1px solid #e7dcc3;border-radius:16px;
  box-shadow:0 3px 14px rgba(170,120,50,.10)}
html.ghibli-on .card h2{color:#9c5a13}
html.ghibli-on .inbox-item{background:#fff7e6;border:1px dashed #f0c98a;border-radius:14px}
html.ghibli-on .badge{background:#ffedb3;border-color:#e7dcc3;color:#7a4a12}
html.ghibli-on .badge.ok{border-color:#f0a13a;color:#b35c1e;background:#fff3d6}
html.ghibli-on .badge.off{background:#f1ead8}

html.ghibli-on button{border-radius:999px;border-color:#ecd9ac;background:#ffedb3;color:#5d4a26}
html.ghibli-on button:hover:not(:disabled){border-color:#f0a13a}
html.ghibli-on button.primary{background:#ffa726;border-color:#f09a1f;color:#fff;font-weight:600}
html.ghibli-on button.primary:active,html.ghibli-on button.active{background:#ffb84d;border-color:#f09a1f}
/* 待听「听这个/一键收听」按钮：淡蓝底黑字（Lee 2026-11-07 令） */
html.ghibli-on #inboxList button.primary{background:#a8d8ff;border-color:#8ec9ee;color:#22252a}
html.ghibli-on #inboxList button.primary:hover{background:#bcd9ff;border-color:#5aa7de}
html.ghibli-on input[type="checkbox"],html.ghibli-on input[type="radio"]{accent-color:#f09a1f}
html.ghibli-on .listened-toggle input{accent-color:#f09a1f}
html.ghibli-on .listened-tag{border-color:#f0a13a;color:#b35c1e}
html.ghibli-on select,html.ghibli-on textarea,html.ghibli-on input[type="text"],html.ghibli-on input[type="password"]{
  border-radius:10px;border-color:#ecd9ac;background:#fffef9}
html.ghibli-on textarea:focus,html.ghibli-on select:focus,html.ghibli-on input:focus{
  outline:2px solid #8ec9ee;outline-offset:1px}
html.ghibli-on .sentences li:hover{background:#fdf3d8}
html.ghibli-on .sentences li.active{background:#a8d8ff;font-weight:600}
html.ghibli-on .sentences li.done{color:#a08b6d}
html.ghibli-on #progressBar{background:linear-gradient(90deg,#ffb84d,#ffa726)}
html.ghibli-on a{color:#c46a17}
html.ghibli-on footer{color:#7a6a55}

/* ===== 活场景（v4）：集数动作 ===== */
#castTotoro,#castSatsuki,#castMei{transition:transform 1.2s ease}
#tintSunset,#tintNight{transition:opacity 1.4s ease}
svg[data-ep="2"] #tintSunset{opacity:.30}
svg[data-ep="3"] #tintNight{opacity:.46}
svg[data-ep="1"] #scenePond,svg[data-ep="2"] #sceneBranch,svg[data-ep="3"] #sceneStars,
svg[data-ep="1"] #sceneFlies,svg[data-ep="2"] #sceneLeaves,svg[data-ep="3"] #propZzz,
svg[data-ep="1"] #propRod{display:block}
svg[data-ep="0"] #propUmbrella,svg[data-ep="1"] #propUmbrella,svg[data-ep="2"] #propUmbrella{display:none}
svg[data-ep="3"] #propHat{display:none}
svg[data-ep="1"] #castSatsuki .legL,svg[data-ep="1"] #castSatsuki .legR,
svg[data-ep="1"] #castMei .legL,svg[data-ep="1"] #castMei .legR{display:none}
/* 散步集：整队慢走 + 腿臂摆动 */
svg[data-ep="0"] #castWrap{animation:stroll 48s ease-in-out infinite}
@keyframes stroll{0%,100%{transform:translateX(-24px)}50%{transform:translateX(104px)}}
.legL,.legR,.armL,.armR{transform-box:fill-box;transform-origin:50% 0}
.armL,.armR{transform-origin:50% 6%}
svg[data-ep="0"] .legL,svg[data-ep="0"] .armR{animation:swingA .9s ease-in-out infinite}
svg[data-ep="0"] .legR,svg[data-ep="0"] .armL{animation:swingB .9s ease-in-out infinite}
@keyframes swingA{0%,100%{transform:rotate(16deg)}50%{transform:rotate(-16deg)}}
@keyframes swingB{0%,100%{transform:rotate(-16deg)}50%{transform:rotate(16deg)}}
/* 黄昏集：垂腿轻晃 */
svg[data-ep="2"] .legL{animation:swingS 2.8s ease-in-out infinite}
svg[data-ep="2"] .legR{animation:swingS 2.8s ease-in-out -1.4s infinite}
@keyframes swingS{0%,100%{transform:rotate(6deg)}50%{transform:rotate(-6deg)}}
/* 夜集：龙猫呼吸 + Zzz */
svg[data-ep="3"] #castTotoro{animation:breathe 5.2s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 92%}
@keyframes breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.015,1.022)}}
#propZzz{animation:zfloat 3.8s ease-in-out infinite}
@keyframes zfloat{0%,100%{transform:translateY(0);opacity:.75}50%{transform:translateY(-7px);opacity:1}}
/* 溪边集：浮漂 + 蝴蝶 */
#propRod .bobber{animation:bob 2.4s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(2.6px)}}
.flyA{animation:flutter 9s ease-in-out infinite}
.flyB{animation:flutter 11s ease-in-out -4s infinite reverse}
@keyframes flutter{0%,100%{transform:translate(0,0) rotate(0deg)}25%{transform:translate(16px,-12px) rotate(9deg)}55%{transform:translate(30px,-2px) rotate(-7deg)}78%{transform:translate(12px,7px) rotate(5deg)}}
/* 黄昏集：落叶 */
.leafA{animation:leafFall 8s linear infinite}
.leafB{animation:leafFall 10s linear -3s infinite}
.leafC{animation:leafFall 9s linear -6s infinite}
@keyframes leafFall{0%{transform:translate(0,0) rotate(0deg);opacity:0}10%{opacity:1}86%{opacity:1}100%{transform:translate(-18px,88px) rotate(300deg);opacity:0}}
@media (prefers-reduced-motion: reduce){#sceneSvg *{animation:none!important}}
"""

JS = r"""/* 朗读站横幅「活场景」维持脚本 — 纯前端、零后端、零 AI（Lee 2026-11-07 定）。
   北京时间每 6 小时一集：05:30 晨间散步 / 11:30 溪边钓鱼 / 17:30 树枝黄昏 / 23:30 夜晚安睡。
   夜集 23:30–05:30 整段覆盖 00:00–05:30 静默窗，窗口内不发生换集。
   本脚本只做三件事：算集数、给 SVG 设 data-ep 与角色位移、定下一次换集的闹钟。 */
(function () {
  var svg = document.getElementById("sceneSvg");
  if (!svg) return;
  var CAST = {
    totoro: document.getElementById("castTotoro"),
    satsuki: document.getElementById("castSatsuki"),
    mei: document.getElementById("castMei"),
    sign: document.getElementById("propSign")
  };
  var BASE = {}, k;
  for (k in CAST) if (CAST[k]) BASE[k] = CAST[k].getAttribute("transform") || "";
  var EPS = [
    { totoro: "", satsuki: "", mei: "" },
    { totoro: "translate(-40,4)", satsuki: "translate(-150,10)", mei: "translate(-30,10)", sign: "translate(-110,0)" },
    { totoro: "translate(-120,-18) scale(0.85)", satsuki: "translate(40,-16)", mei: "translate(95,-14)" },
    { totoro: "", satsuki: "", mei: "translate(-4,2)" }
  ];
  var BOUND = [330, 690, 1050, 1410]; // 北京时间换集点（分钟）：05:30 / 11:30 / 17:30 / 23:30
  var timer = null;
  function bj() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    return { mins: d.getUTCHours() * 60 + d.getUTCMinutes(), secs: d.getUTCSeconds() };
  }
  function apply() {
    var t = bj();
    var ep = Math.floor(((t.mins - 330 + 1440) % 1440) / 360);
    svg.setAttribute("data-ep", ep);
    var cfg = EPS[ep];
    for (var k2 in CAST) {
      var el = CAST[k2];
      if (!el) continue;
      var v = (BASE[k2] + " " + (cfg[k2] || "")).trim();
      if (v) el.setAttribute("transform", v); else el.removeAttribute("transform");
    }
    var nowSec = t.mins * 60 + t.secs, next = null, i, b;
    for (i = 0; i < BOUND.length; i++) { b = BOUND[i] * 60; if (b > nowSec) { next = b; break; } }
    if (next === null) next = BOUND[0] * 60 + 86400;
    if (timer) clearTimeout(timer);
    timer = setTimeout(apply, (next - nowSec) * 1000 + 400);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) apply(); });
  apply();
})();

/* 扩展段：原画版（Lee 的图）+ 横幅切换 + 龙猫下页散步。集数跟随主段设置的 data-ep。 */
(function () {
  var fig = document.getElementById("scenePhoto");
  var svg = document.getElementById("sceneSvg");
  if (!fig || !svg) return;
  var wrap = fig.parentNode;
  function curEp() { var v = parseInt(svg.getAttribute("data-ep") || "0", 10); return isNaN(v) ? 0 : v; }
  var MODE = "draw";
  try { MODE = localStorage.getItem("qqr-scene-mode") || "draw"; } catch (e) {}
  var urls = {}, pdata = null, pTimer = null, pIdx = 0, pEp = -1;
  function loadPhoto(idx, cb) {
    if (urls[idx]) { cb(urls[idx]); return; }
    if (!pdata) { cb(null); return; }
    var ph = pdata.photos[idx], parts = [], done = 0;
    for (var k = 0; k < ph.parts; k++) { (function (k) {
      fetch("scene-photos-data/p" + idx + ".b64." + k).then(function (r) { return r.text(); }).then(function (t) {
        parts[k] = t; done++;
        if (done === ph.parts) {
          var bin = atob(parts.join("")), arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          urls[idx] = URL.createObjectURL(new Blob([arr], { type: ph.mime }));
          cb(urls[idx]);
        }
      }).catch(function () { cb(null); });
    })(k); }
  }
  function showPhoto() {
    if (!pdata || MODE !== "photo") return;
    var list = pdata.slots[pEp]; if (!list || !list.length) return;
    var idx = list[pIdx % list.length];
    loadPhoto(idx, function (u) {
      if (!u || MODE !== "photo") return;
      var fg = document.getElementById("scenePhotoFg"), bg = document.getElementById("scenePhotoBg");
      if (!fg) return;
      var im = new Image();
      im.onload = function () { bg.src = u; fg.src = u; fg.style.opacity = 1; };
      fg.style.opacity = 0; im.src = u;
    });
  }
  function photoTick(ep) {
    var tint = document.getElementById("scenePhotoTint");
    if (tint) { tint.style.opacity = ep === 3 ? .42 : (ep === 2 ? .12 : 0); tint.style.background = ep === 2 ? "#b3541e" : "#16294d"; }
    if (ep !== pEp) {
      pEp = ep; pIdx = 0;
      if (pTimer) { clearInterval(pTimer); pTimer = null; }
      if (MODE === "photo") { showPhoto(); pTimer = setInterval(function () { pIdx++; showPhoto(); }, 45000); }
    }
  }
  function setMode(m) {
    MODE = m;
    try { localStorage.setItem("qqr-scene-mode", m); } catch (e) {}
    wrap.setAttribute("data-mode", m);
    fig.hidden = (m !== "photo");
    var btns = wrap.querySelectorAll(".scene-switch button");
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("on", btns[i].getAttribute("data-sm") === m);
    if (pTimer) { clearInterval(pTimer); pTimer = null; }
    if (m === "photo") { pEp = -1; photoTick(curEp()); } else { hideRoam(); }
  }
  var ROAM = '<svg viewBox="0 0 100 118" xmlns="http://www.w3.org/2000/svg"><rect class="u" x="66.7" y="10" width="2.6" height="44" rx="1.3" fill="#3a3f45"/><g class="fL"><ellipse cx="34" cy="108" rx="11" ry="3.6" fill="#43514a"/></g><g class="fR"><ellipse cx="66" cy="108" rx="11" ry="3.6" fill="#43514a"/></g><path d="M36 26 L41 9 L48 23 Z" fill="#55645b"/><path d="M52 23 L59 9 L64 26 Z" fill="#55645b"/><path d="M50 21 C 78 21 92 46 91 70 C 90 94 74 106 50 106 C 26 106 10 94 9 70 C 8 46 22 21 50 21 Z" fill="#59685f"/><ellipse cx="50" cy="82" rx="27" ry="23" fill="#f3e9cf"/><g stroke="#55645b" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M36 78 q4 -5 8 0 M46 73 q4 -5 8 0 M56 78 q4 -5 8 0"/></g><circle cx="36" cy="43" r="4" fill="#fff"/><circle cx="64" cy="43" r="4" fill="#fff"/><circle cx="36.6" cy="42.4" r="1.9" fill="#26221f"/><circle cx="63.4" cy="42.4" r="1.9" fill="#26221f"/><ellipse cx="50" cy="50" rx="4.6" ry="2.2" fill="#33302e"/><g stroke="#3f4a44" stroke-width="1.6" stroke-linecap="round"><path d="M14 47 L2 44 M13 55 L1 55 M14 63 L3 67 M86 47 L98 44 M87 55 L99 55 M86 63 L97 67"/></g><path class="u" d="M40 17 Q68 1 96 17 Q82 10 68 17 Q54 10 40 17 Z" fill="#2f3338"/></svg>';
  var roamEl = null, roamAnim = null;
  /* 满页散步禁行时段（Lee 2026-11-09 定）：北京时间 07:00-16:00 只停满页走的龙猫，
     以免影响听 MP3；横幅内动画、原画轮换、换集等其他动画一律保留。
     页面跨过 07:00 自动停（正在走的当场收起）、跨过 16:00 自动恢复，不用刷新。 */
  var roamQuietTimer = null, roamBoundaryTimer = null;
  function roamReduced() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function bjDaySec() { var d = new Date(Date.now() + 8 * 3600 * 1000); return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds(); }
  function roamQuiet() { var m = Math.floor(bjDaySec() / 60); return m >= 420 && m < 960; }
  function scheduleStrollAfterQuiet() {
    if (roamQuietTimer || roamReduced()) return;
    var wait = 960 * 60 - bjDaySec();
    if (wait <= 0) return;
    roamQuietTimer = setTimeout(function () { roamQuietTimer = null; stroll(); }, wait * 1000 + 1000);
  }
  function scheduleRoamBoundary() {
    if (roamBoundaryTimer) clearTimeout(roamBoundaryTimer);
    var now = bjDaySec(), start = 420 * 60;
    var wait = now < start ? start - now : start + 86400 - now;
    roamBoundaryTimer = setTimeout(function () {
      roamBoundaryTimer = null;
      if (roamQuiet()) { hideRoam(); scheduleStrollAfterQuiet(); }
      scheduleRoamBoundary();
    }, wait * 1000 + 500);
  }
  function buildRoam() {
    if (roamEl) return;
    roamEl = document.createElement("div");
    roamEl.id = "totoroRoam";
    roamEl.innerHTML = '<div class="flip"><div class="travel"><div class="shadow"></div><div class="bob">' + ROAM + '</div></div></div>';
    document.body.appendChild(roamEl);
  }
  function hideRoam() { if (roamAnim) { roamAnim.cancel(); roamAnim = null; } if (roamEl) roamEl.style.opacity = 0; }
  function stroll() {
    if (roamQuiet()) { hideRoam(); scheduleStrollAfterQuiet(); return; }
    if (roamAnim && (roamAnim.playState === "running" || roamAnim.playState === "paused")) return;
    if (MODE !== "draw" || document.hidden || !document.documentElement.classList.contains("ghibli-on")) { setTimeout(stroll, 30000); return; }
    buildRoam();
    var H = 109, W = 92, vw = window.innerWidth, vh = window.innerHeight;
    var fromLeft = Math.random() < 0.5;
    roamEl.classList.toggle("flip", !fromLeft);
    roamEl.classList.remove("umb");
    var startX, endX, dur, topPx, lane = null;
    if (Math.random() < 0.5) {
      var cands = [], els = document.querySelectorAll("header,.card,section,.ghibli-scene");
      for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (r.width > 240 && r.top > 80 && r.top < vh - 150) cands.push(r); }
      if (cands.length) lane = cands[Math.floor(Math.random() * cands.length)];
    }
    if (lane) {
      topPx = lane.top - H + 8;
      startX = fromLeft ? lane.left - W - 12 : lane.right + 12;
      endX = fromLeft ? lane.right + 12 : lane.left - W - 12;
      dur = Math.max(8000, Math.abs(endX - startX) * 40);
    } else {
      var feetY = vh * (0.32 + Math.random() * 0.6);
      topPx = feetY - H;
      startX = fromLeft ? -W - 20 : vw + 20;
      endX = fromLeft ? vw + 20 : -W - 20;
      dur = 23000 + Math.random() * 14000;
    }
    roamEl.style.top = topPx + "px";
    roamEl.style.opacity = 1;
    var travel = roamEl.querySelector(".travel");
    roamAnim = travel.animate([{ transform: "translateX(" + startX + "px)" }, { transform: "translateX(" + endX + "px)" }], { duration: dur, easing: "linear" });
    if (Math.random() < 0.65) {
      setTimeout(function () {
        if (roamAnim && roamAnim.playState === "running") {
          roamAnim.pause(); roamEl.classList.add("umb");
          setTimeout(function () { roamEl.classList.remove("umb"); if (roamAnim) roamAnim.play(); }, 2400 + Math.random() * 1200);
        }
      }, dur * (0.35 + Math.random() * 0.3));
    }
    roamAnim.onfinish = function () { roamEl.style.opacity = 0; roamAnim = null; setTimeout(stroll, 140000 + Math.random() * 220000); };
  }
  var sw = wrap.querySelectorAll(".scene-switch button");
  for (var i = 0; i < sw.length; i++) sw[i].addEventListener("click", function () { setMode(this.getAttribute("data-sm")); });
  new MutationObserver(function () { photoTick(curEp()); backdropTick(); }).observe(svg, { attributes: true, attributeFilter: ["data-ep"] });
  fetch("scene-photos-data/manifest.json").then(function (r) { return r.json(); }).then(function (j) { pdata = j; if (MODE === "photo") { pEp = -1; photoTick(curEp()); } backdropTick(); }).catch(function () {});

  /* 铺景两版：中档=淡云坡+手绘页脚；全页=原图页脚+两侧挂画+标题橡子。正文不动。 */
  var FOOT_SVG = '<svg viewBox="0 0 1200 180" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="180" fill="#f7ecd2"/><circle cx="1050" cy="38" r="24" fill="#ffd94d"/><path d="M0 96 Q 240 44 480 82 T 960 70 T 1200 88 V180 H0 Z" fill="#bfd4e2"/><path d="M0 128 Q 300 88 620 116 T 1200 122 V180 H0 Z" fill="#e9dcb4"/><ellipse cx="810" cy="152" rx="200" ry="17" fill="#a8d8ff"/><path d="M660 150 h90 M790 158 h110" stroke="#ffffff" stroke-width="2.4" opacity=".7" stroke-linecap="round"/><g><rect x="118" y="102" width="52" height="36" fill="#fdf6e3"/><polygon points="108,104 144,78 180,104" fill="#c96f3f"/><rect x="136" y="118" width="15" height="20" fill="#8a5a33"/></g><g><rect x="1018" y="106" width="7" height="34" fill="#8a5a33"/><circle cx="1021" cy="88" r="30" fill="#f2b8c6"/><circle cx="998" cy="100" r="18" fill="#f6ccd7"/><circle cx="1044" cy="100" r="18" fill="#f6ccd7"/></g><g fill="#e2543e"><circle cx="240" cy="158" r="5"/><circle cx="330" cy="166" r="5"/><circle cx="470" cy="160" r="5"/></g><g fill="#7fb2e0"><circle cx="285" cy="168" r="4.5"/><circle cx="420" cy="168" r="4.5"/><circle cx="560" cy="162" r="4.5"/></g><g fill="#ffb84d"><circle cx="360" cy="156" r="4.5"/><circle cx="520" cy="170" r="4.5"/><circle cx="610" cy="158" r="4.5"/></g></svg>';
  var scDiv = document.createElement("div");
  scDiv.id = "pageScenery";
  scDiv.setAttribute("aria-hidden", "true");
  scDiv.innerHTML = '<div class="sc-backdrop" id="scBackdrop"></div><div class="sc-hills"></div><div class="sc-cloud c1"></div><div class="sc-cloud c2"></div><div class="sc-cloud c3"></div>'
    + '<figure class="sc-side sc-left"><img id="scSideL" alt=""></figure><figure class="sc-side sc-right"><img id="scSideR" alt=""></figure>'
    + '<div class="sc-footer"><div class="sc-foot-drawn">' + FOOT_SVG + '</div><img id="scFootImg" alt=""></div>';
  document.body.appendChild(scDiv);
  var scSw = document.createElement("span");
  scSw.className = "scene-switch scenery-switch";
  scSw.innerHTML = '<button type="button" data-sc="off">铺景关</button><button type="button" data-sc="mid">铺景·中</button><button type="button" data-sc="full">铺景·全</button>';
  wrap.appendChild(scSw);
  var SC = "mid", scLoaded = false;
  try { SC = localStorage.getItem("qqr-scenery") || "mid"; } catch (e) {}
  var SC_IMGS = [0, 2, 1];
  function backdropTick() {
    if (SC !== "full") return;
    var bd = document.getElementById("scBackdrop");
    if (!bd) return;
    var days = Math.floor(Date.now() / 86400000);
    var idx = SC_IMGS[(days * 4 + curEp()) % 3];
    loadPhoto(idx, function (u) {
      if (!u || SC !== "full") return;
      var im = new Image();
      im.onload = function () {
        var maxW = Math.min(document.documentElement.clientWidth, im.naturalWidth * 2);
        var grad = idx === 0 ? "linear-gradient(180deg,#6fa3cf,#a9c48a 55%,#e9dcb4)"
          : (idx === 2 ? "linear-gradient(180deg,#8fc1e3,#b7c98a 55%,#eee0b8)"
          : "linear-gradient(180deg,#a9bf7a,#e9e2c0)");
        bd.style.backgroundImage = "url(" + u + "), " + grad;
        bd.style.backgroundSize = maxW + "px auto, 100% 100%";
        bd.style.backgroundPosition = "center top, center top";
      };
      im.src = u;
    });
  }
  function setScenery(v) {
    SC = v;
    try { localStorage.setItem("qqr-scenery", v); } catch (e) {}
    document.documentElement.setAttribute("data-scenery", v);
    var bs = scSw.querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].getAttribute("data-sc") === v);
    if (v === "full") { document.body.appendChild(scSw); scSw.classList.add("floating"); backdropTick(); }
    else { wrap.appendChild(scSw); scSw.classList.remove("floating"); }
  }
  var scb = scSw.querySelectorAll("button");
  for (var i = 0; i < scb.length; i++) scb[i].addEventListener("click", function () { setScenery(this.getAttribute("data-sc")); });
  var _origFetchCb = null;
  setScenery(SC);
  setMode(MODE);
  scheduleRoamBoundary();
  if (!roamReduced()) setTimeout(stroll, 35000);
})();
"""

HEAD_INJECT = ('<link rel="stylesheet" href="ghibli.css?v=' + VER + '"><!-- ghibli-theme -->\n'
  '<script>try{if(localStorage.getItem("reader-theme")!=="plain")'
  '{document.documentElement.classList.add("ghibli-on")}}catch(e)'
  '{document.documentElement.classList.add("ghibli-on")}</script><!-- ghibli-theme -->\n')

TOGGLE_BUTTON = ('  <button id="themeToggle" class="ghibli-toggle" type="button">乡野花风：开</button>\n'
  '  <!-- ghibli-scene -->\n')

TOGGLE_SCRIPT = ('<script>(function(){var b=document.getElementById("themeToggle");if(!b)return;'
  'function sync(){var on=document.documentElement.classList.contains("ghibli-on");'
  'b.textContent=on?"乡野花风：开（点此切简洁版）":"乡野花风：关（点此开启）"}'
  'b.addEventListener("click",function(){var on=document.documentElement.classList.toggle("ghibli-on");'
  'try{localStorage.setItem("reader-theme",on?"ghibli":"plain")}catch(e){}sync()});sync()})()</script>'
  '<!-- ghibli-toggle-script -->\n')

JS_TAG = '<script src="ghibli.js?v=' + VER + '" defer></script><!-- ghibli-js -->\n'

PHOTO_HTML = ('<figure id="scenePhoto" hidden><img id="scenePhotoBg" alt=""><img id="scenePhotoFg" alt="">'
  '<i id="scenePhotoTint"></i></figure>'
  '<span class="scene-switch"><button type="button" data-sm="draw" class="on">会动版</button>'
  '<button type="button" data-sm="photo">原画版</button></span>')

def scene_block():
    inline = SVG.replace('<svg ', '<svg id="sceneSvg" ', 1)
    return '  <div class="ghibli-scene">' + inline + PHOTO_HTML + '</div>\n'

def patch(name, with_scene):
    p = PUB / name
    s = p.read_text(encoding="utf-8")
    orig = s
    if "ghibli-theme" not in s:
        s = s.replace('<link rel="stylesheet" href="style.css">',
                      '<link rel="stylesheet" href="style.css">\n' + HEAD_INJECT, 1)
    else:
        s = re.sub(r'href="ghibli\.css(?:\?v=[^"]*)?"', f'href="ghibli.css?v={VER}"', s)
    if with_scene:
        block = scene_block()
        if 'id="themeToggle"' in s:
            # 已有横幅（img 版或旧内联版）：整体换成最新内联场景
            s = re.sub(r'\s*<div class="ghibli-scene".*?</div>\s*(?=<button id="themeToggle")',
                       "\n" + block.rstrip("\n"), s, flags=re.S)
            s = s.replace("🌿 乡野风：开", "乡野花风：开").replace("🌸 乡野花风：开", "乡野花风：开")
        elif "</header>" in s:
            s = s.replace("</header>", block + TOGGLE_BUTTON + "</header>", 1)
        if "ghibli-toggle-script" not in s:
            s = s.replace("</body>", TOGGLE_SCRIPT + "</body>", 1)
        else:
            s = re.sub(r'<script>\(function\(\)\{var b=document\.getElementById\("themeToggle"\).*?</script><!-- ghibli-toggle-script -->\n?',
                       TOGGLE_SCRIPT, s, flags=re.S)
        if "ghibli-js" not in s:
            s = s.replace("</body>", JS_TAG + "</body>", 1)
        else:
            s = re.sub(r'src="ghibli\.js(?:\?v=[^"]*)?"', f'src="ghibli.js?v={VER}"', s)
    if s != orig:
        p.write_text(s, encoding="utf-8")
        print(f"patched {name}")
    else:
        print(f"unchanged {name} (already applied)")

def main():
    (PUB / "ghibli.css").write_text(CSS, encoding="utf-8")
    (PUB / "ghibli-scene.svg").write_text(SVG, encoding="utf-8")
    (PUB / "ghibli.js").write_text(JS, encoding="utf-8")
    patch("index.html", True)
    patch("submit.html", True)
    patch("guide.html", False)
    css = (PUB / "ghibli.css").read_text(encoding="utf-8")
    assert css.count("{") == css.count("}"), "CSS braces unbalanced"
    js = (PUB / "ghibli.js").read_text(encoding="utf-8")
    assert js.count("{") == js.count("}") and js.count("(") == js.count(")"), "JS unbalanced"
    print("OK css", len(css), "bytes; svg", (PUB / 'ghibli-scene.svg').stat().st_size,
          "bytes; js", len(js), "bytes")

if __name__ == "__main__":
    sys.exit(main())
