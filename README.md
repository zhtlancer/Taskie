# 🎒 Taskie (嗒嗒日常)
### 专为小学生量身定制的日常作业打卡与学习成长空间

<p align="center">
  <img src="https://img.shields.io/badge/Platform-iPad%20Air%205%20(1180%C3%97820)-6C63FF?style=flat-square&logo=apple" alt="iPad Optimized" />
  <img src="https://img.shields.io/badge/Frontend-Vue%203%20%2B%20Vite%205-42b883?style=flat-square&logo=vuedotjs" alt="Vue 3" />
  <img src="https://img.shields.io/badge/CSS-Tailwind%20CSS%203-38bdf8?style=flat-square&logo=tailwindcss" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Backend-Fastify%20%2B%20Node.js%2020-000000?style=flat-square&logo=fastify" alt="Fastify" />
  <img src="https://img.shields.io/badge/Database-SQLite%20(better--sqlite3)-003B57?style=flat-square&logo=sqlite" alt="SQLite" />
  <img src="https://img.shields.io/badge/Image-Sharp%20Pipeline-99cc00?style=flat-square" alt="Sharp" />
  <img src="https://img.shields.io/badge/Audio-Web%20Audio%20API-FF6B6B?style=flat-square" alt="Web Audio" />
  <img src="https://img.shields.io/badge/PWA-Standalone%20Fullscreen-FFD93D?style=flat-square" alt="PWA" />
  <img src="https://img.shields.io/badge/Deploy-Docker%20%7C%20Compose-2496ED?style=flat-square&logo=docker" alt="Docker" />
  <img src="https://img.shields.io/badge/Tests-56%20Passed-brightgreen?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License" />
</p>

---

## 📖 项目简介

**Taskie (嗒嗒日常)** 是一款专为家庭场景设计的小学生日常作业与学习任务管理系统。

摒弃了传统家校软件臃肿的社交与营销功能，以**孩子自主打卡**为核心，深度针对 **iPad Air 5 横屏视口 (1180 × 820 px)** 进行触控与视觉定制。集**日常作业打卡**、**趣味激励成长**、**拍照错题本**、**生字本与查笔画**于一体，让孩子在正向激励中养成专注自律的好习惯。

---

## ✨ 核心功能全览

### 1. 🐱 多孩子账号与独立隔离
- **可爱头像选择**：首页直观的 Emoji 萌宠卡片（如 🐱 小明、🐰 小红），一键点击切换；
- **独立 PIN 码保护**：孩子可选配置专属 4 位数字密码，任务进度、积分金币、勋章与错题严格物理隔离；
- **独立家长管理入口**：右上角家长控制台设有独立 PIN 码门禁，防止孩子误改配置。

### 2. 📋 每日作业任务看板 (iPad Air 5 横屏优化)
- **大卡片一屏全览**：在 1180 × 820 px 视口下无需滚动即可掌控今日全部作业，触控目标 ≥ 48×48px，防误触；
- **中文字体专属设计**：甄选适宜小学生语文认读的开源名作 **霞鹜文楷 (LXGW WenKai)**，配合规范的 **思源黑体**、童趣 **站酷快乐体** 标题与圆润英文字体 **Nunito**；
- **灵活双模式周期配置**：
  - **模式一（固定星期）**：如周一到周五每日生成“数学口算打卡”；
  - **模式二（每周特定次数）**：如“每周完成 3 次课外阅读 20 页”，卡片动态跟踪周完成进度（`🎯 周目标 3次 · 本周已完成 2/3`）。

### 3. 🏆 趣味激励系统与交互音效
- **即时正向反馈**：点击打卡触发卡片微动效与金币飘洒动画；
- **连续打卡火焰 (Streak)**：累计连续完成作业天数，跳动火焰动效实时激励；
- **8 大里程碑勋章墙**：初出茅庐、三连击、一周勇士、月度冠军、小富翁、积分达人、全勤王、优秀学生，达成自动点亮；
- **全勤礼花庆贺**：当天全部作业完成时触发全屏彩色纸屑粒子动效；
- **自研 Web Audio 原生音效**：
  - 零外部音频文件依赖，离线秒开，iPadOS 完美支持；
  - 包含金币音 (Coin)、胜利号角 (Fanfare)、勋章叮当音 (Chime)、轻触水滴气泡音；
  - **全局声音开关**：顶部常驻 🔊 / 🔇 开关，状态本地持久化保存。

### 4. 📸 拍照错题本 (触控裁剪 + 自动锐化压缩)
- **原生相机集成**：点击直接调用 iPad 原生后置高清相机拍照或相册选图；
- **多点触控自由裁剪**：基于九宫格辅助线自由拉伸四角框选题目区域，支持 90° 旋转校正；
- **试卷文档增强模式**：
  - **原图模式**：保留真实色彩；
  - **清晰增强（推荐）**：应用拉普拉斯锐化矩阵去除纸张灰暗底色、加黑铅笔与墨水字迹；
  - **黑白文档模式**：自适应阈值二值化（纯白纸张、加黑字迹），便于日后打印重练；
- **服务端 Sharp 高效压缩**：自动校正 EXIF 拍摄方向，将几兆原始照片压缩为 **150KB~250KB WebP** 格式，兼顾画质与轻量存储。

### 5. 📖 生字本与 🔍 查笔画系统
- **「🔍 查笔画」**：
  - 输入任意汉字，在超大米字格中动态演示**逐笔笔顺书写动画**（基于 `hanzi-writer`，支持步进播放与重写）；
  - 实时解析部首、总笔画数、带声调拼音并支持点击「🔊」标准普通话朗读；
  - 醒目大按钮「⭐ 加入生字本」，一键秒存至孩子生字库。
- **「📖 生字本」**：
  - 田字格生字卡片流（霞鹜文楷书法字体展示）；
  - **拼音默认遮罩隐藏**（显示为问号），点击卡片「👁️ 拼音」翻牌显露，专为自主认字背诵与默写自测设计；
  - 点开详情卡片支持在 iPad 屏幕上进行**手指描红临摹**练习；
  - 支持按“已掌握 / 学习中”分类过滤。

### 6. 📱 PWA 独立全屏模式 (极简沉浸体验)
- 内置 Web App Manifest 与 Apple 移动设备独立运行标签（`apple-mobile-web-app-capable: yes`）；
- 在 iPad Safari 中点击 **分享 ➡️ 添加到主屏幕**，即可在 iPad 桌面上生成独立 App 图标；
- 点开后**100% 独立全屏运行**，彻底去除顶栏网址输入框与底栏标签页，专注防误触。

### 7. 👨‍👩‍👧 家长后台管理
- PIN 码保护，孩子无法误入修改；
- 孩子账号管理（姓名、头像 Emoji、PIN 码）；
- 任务模板管理（分值权重、学科分类、星期与周频次）；
- 孩子完成率历史趋势图表（基于 Chart.js）。

---

## 🏗️ 技术架构

```
Taskie/
├── backend/                   # 后端 API 服务 (Node.js + Fastify)
│   ├── data.sqlite            # SQLite 数据库单文件 (零运维)
│   ├── uploads/               # 错题 WebP 图片存储目录
│   ├── src/
│   │   ├── app.js             # Fastify 应用工厂
│   │   ├── config.js          # 环境配置 (端口、host、密码等)
│   │   ├── db/                # SQLite 表结构与种子数据
│   │   ├── routes/            # REST API 路由 (auth, children, tasks, characters, mistakes)
│   │   ├── services/          # 业务逻辑与激励规则
│   │   └── utils/             # Sharp 图像流水线、加解密等
│   └── test/                  # Node.js 原生自动化测试套件 (29 项测试)
│
├── frontend/                  # 前端 Web 应用 (Vue 3 + Vite)
│   ├── public/
│   │   └── manifest.webmanifest # PWA 独立全屏清单
│   ├── src/
│   │   ├── api/               # API 客户端与离线 MockStore 兜底引擎
│   │   ├── assets/hanziData/  # 离线打包的常用汉字笔顺矢量数据
│   │   ├── components/        # iPad 触控定制 UI 组件 (看板、裁剪、笔画、音效开关等)
│   │   ├── stores/            # Pinia 状态管理 (child, character, sound)
│   │   ├── utils/             # Web Audio 合成器、Canvas 滤镜、拼音解析
│   │   └── views/             # 页面视图 (看板、生字本、错题本、激励墙、家长端)
│   └── test/                  # 前端工具与状态测试套件 (27 项测试)
│
├── Dockerfile                 # 多阶段容器构建定义 (前端编译 + 后端运行时)
├── docker-compose.yml         # Docker Compose 一键启动与持久化挂载配置
├── start.sh                   # 一键启动持久化后台服务脚本
├── stop.sh                    # 一键停止服务脚本
└── package.json               # 根项目整合脚本
```

---

## 🚀 快速开始

### 方式一：Docker / Docker Compose 部署（强烈推荐，一键运行、零配置）

项目已完整内置多阶段 `Dockerfile` 与 `docker-compose.yml`，支持零环境依赖一键容器化启动。
前端静态资源自动构建并由后端统一托管，数据持久化保存在宿主机 `./data` 目录。

```bash
# 1. 启动容器（后台常驻运行，自动构建前端与后端环境）
docker compose up -d

# 2. 查看运行日志
docker compose logs -f

# 3. 停止容器
docker compose down
```

启动完成后，直接在 iPad 或电脑浏览器中访问：
- **Web 应用与打卡入口**：`http://<服务器局域网IP>:3000`（本机：`http://localhost:3000`）
- **持久化数据存储**：
  - 数据库文件：宿主机 `./data/data.sqlite`
  - 错题照片目录：宿主机 `./data/uploads/`
  容器更新、销毁与重建过程中，所有作业记录与错题照片均持久保存在宿主机，永不丢失。

> 💡 **已有本地数据迁移至 Docker（可选）**：
> 若此前在本地裸机运行过已有数据，执行以下命令即可平滑迁移进 Docker 挂载卷：
> ```bash
> mkdir -p data
> cp backend/data.sqlite data/data.sqlite 2>/dev/null || true
> cp -r backend/uploads data/ 2>/dev/null || true
> ```

---

### 方式二：Node.js 本地开发与脚本启动

#### 1. 环境准备
- Node.js 18.0 或更高版本（推荐 Node.js 20 LTS）
- npm 9.0 或更高版本

#### 2. 安装依赖

```bash
# 进入项目目录安装前后端依赖
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

#### 3. 初始化演示数据库（可选）

```bash
npm run seed:backend
```

> **预置测试账号**：
> - 孩子 1：**小明**（头像 🐱，PIN 码 `1234`，预置日常作业与生字）
> - 孩子 2：**小红**（头像 🐰，免 PIN 直接进入）
> - 家长管理初始 PIN：`1234`

#### 4. 启动服务

推荐使用根目录提供的一键管理脚本（自动绑定到 `0.0.0.0`，iPad 局域网可访问）：

```bash
# 启动后台持久化服务
./start.sh
```

启动成功后，即可在浏览器中访问：
- **前端应用界面（iPad 访问入口）**：`http://<局域网IP>:5173`（本地：`http://localhost:5173`）
- **后端 API 服务**：`http://<局域网IP>:3000`（本地：`http://localhost:3000`）

停止服务：
```bash
./stop.sh
```

---

## 🧪 自动化测试

项目拥有严密的测试覆盖，共 **56 项自动化测试** 全部绿灯通过：

```bash
# 运行后端全量测试 (29 tests)
npm run test:backend

# 运行前端核心逻辑测试 (27 tests)
npm --prefix frontend test
```

---

## 💾 数据备份与迁移

- **数据库**：所有账号、任务、积分与生字均存储在单一文件 `backend/data.sqlite` 中；
- **图片**：所有错题照片均保存在 `backend/uploads/` 目录中；
- **一键全量备份**：
  ```bash
  tar -czvf taskie_backup_$(date +%Y%m%d).tar.gz backend/data.sqlite backend/uploads/
  ```

---

## 📄 开源协议

本项目采用 [MIT 许可证](LICENSE)。
