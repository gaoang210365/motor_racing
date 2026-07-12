# 🏁 Voxel Grand Prix · 体素大奖赛

[English](README.md) | **简体中文**

[![Deploy to GitHub Pages](https://github.com/lwt980916-glitch/voxel-grand-prix/actions/workflows/deploy.yml/badge.svg)](https://github.com/lwt980916-glitch/voxel-grand-prix/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-r166-049EF4)](https://threejs.org)

纯浏览器运行的体素风格 F1 赛车游戏。三条赛道均基于**真实 GPS 中心线数据**复刻——
弯道序列、赛道长度（误差 < 0.4%）与海拔起伏和现实一致。全程零素材：
每一辆赛车、每一座看台、每一声引擎轰鸣都由代码生成。

### ▶️ [立即游玩](https://lwt980916-glitch.github.io/voxel-grand-prix/)

| | |
|---|---|
| ![摩纳哥 赌场广场](docs/screenshots/monaco-casino.jpg) | ![铃鹿 8字立体交叉](docs/screenshots/suzuka-crossover.jpg) |
| 摩纳哥 — 冲上赌场广场坡顶 | 铃鹿 — 8 字立体交叉桥下 |
| ![隧道内座舱视角](docs/screenshots/cockpit-tunnel.jpg) | ![银石 贝克茨弯](docs/screenshots/silverstone-becketts.jpg) |
| 第一人称座舱 · 摩纳哥隧道 | 银石 — Maggotts & Becketts 连续弯 |

## 赛道

| 赛道 | 长度 | 标志性看点 |
|---|---|---|
| 🇲🇨 **摩纳哥** Circuit de Monaco | 3.325 km | 全程街道护墙、爬升 30 米的赌场广场、19 米半径费尔蒙发夹弯、海滨隧道、游艇码头 |
| 🇬🇧 **银石** Silverstone | 5.879 km | Maggotts–Becketts 高速连续弯、Hangar 直道 307 km/h、砂石缓冲区、巨型看台 |
| 🇯🇵 **铃鹿** Suzuka | 5.814 km | 全球唯一 8 字形 F1 赛道——先从桥**下**穿过，半圈后再从桥**上**跨越；S 字弯、130R、摩天轮 |

## 特性

- **精细体素 F1 赛车**（0.05m 网格，5 万+顶点）：级联前翼、Halo、侧箱进气口、
  鲨鱼鳍、带软胎红标的轮毂罩、车手头盔、刹车尾灯，以及**真正会开合的 DRS 尾翼**
- **有真实感的操控**：双轴自行车模型、空气下压力（高速弯贴地、发夹弯灵活）、
  后轮摩擦圆牵引（大脚油门可控滑动 + 白烟 + 胎痕）、速度敏感转向、坡道重力、
  路缘/草地/砂石抓地差异、护墙碰撞——0-100 km/h 2.9 秒，DRS 极速 320+，制动 2.8g
- **三种视角**（`C` 键）：第三人称追尾、第一人称座舱（透过 Halo 看赛道）、经典 T-Cam
- **完整比赛氛围**：五灯起步、检查点计圈、最速圈本地存档、弯道名实时播报、
  DRS 区域、逆行警告、小地图、演示模式自动驾驶（`P`）
- **100% 程序化音频**（WebAudio）：随转速变化的引擎声浪、风噪、轮胎尖啸、
  路缘震动、换挡声
- **性能优秀**：27–36 个 draw call，单帧渲染约 1ms

## 操作

| 按键 | 功能 |
|---|---|
| `W` / `↑` | 油门 |
| `S` / `↓` | 刹车 |
| `A` `D` / `←` `→` | 转向 |
| `C` | 切换视角（追尾 → 座舱 → T-Cam） |
| `R` | 重置回赛道（本圈作废） |
| `P` | 演示模式（自动驾驶） |
| `M` | 静音 |
| `Esc` | 暂停 |
| 🎮 | 支持手柄（左摇杆转向 + 扳机油门/刹车） |

## 本地开发

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产物输出到 dist/
```

## 赛道是怎么复刻的

1. `raw/*.geojson` — 来自 [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)
   的真实赛道中心线（MIT 协议）
2. `npm run data:convert` — 将经纬度投影为本地米制坐标（`src/data/circuits.js`）
3. `npm run data:plot` — 生成带曲率峰值表的标定图，用于确定起点线位置、
   行驶方向和每个弯道的里程占比（存入 `src/config.js`，配合手工调校的海拔剖面）
4. `src/track.js` 以 2.5m 步长重采样中心线，按曲率自动铺设路缘石、
   生成护墙/缓冲区、检测铃鹿 8 字交叉点，并为自动驾驶预计算赛车线速度剖面

## 项目结构

```
src/
  main.js         主循环、菜单、视觉同步
  config.js       涂装 + 赛道配置（弯道、海拔、DRS…）
  voxel.js        体素构建器 → 合并 BufferGeometry
  carModel.js     F1 车体、车轮与 DRS 翼片网格
  physics.js      车辆动力学
  track.js        路面/路缘/护墙几何、计时采样、空间查询
  environment.js  天空、阳光、观众、建筑、隧道、立交桥、摩天轮
  cameras.js      追尾 / 座舱 / T-Cam 相机
  race.js         起步灯序、计圈、自动驾驶
  hud.js          F1 风格 HUD + 小地图
  audio.js        程序化引擎/风噪/轮胎音效
  particles.js    烟雾 + 轮胎痕迹
  input.js        键盘 + 手柄
tools/            数据转换与标定工具
raw/              GeoJSON 源数据（MIT，bacinger/f1-circuits）
```

## 致谢

- 赛道几何数据：[bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)（MIT）
- 基于 [Three.js](https://threejs.org) 与 [Vite](https://vitejs.dev) 构建

## 许可证

[MIT](LICENSE)
