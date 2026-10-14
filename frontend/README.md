# 小学生日常作业任务管理系统 - 前端 (Vue 3 iPad 横屏端)

基于 **Vue 3 + Vite + Tailwind CSS** 的专为 iPad 横屏设计的小学生日常作业任务管理与激励系统。

## 🎯 设计与适配基准

- **适配基准设备**：iPad Air 5 横屏浏览器视口（**1180 × 820 px**）
- **触控优化**：核心操作与卡片触控目标 ≥ 48×48px，家长端数字键盘按键 ≥ 64px
- **字体规范**：
  - **中文字体**：专门引入适宜儿童语文阅读与字形认知的开源名作 **霞鹜文楷 屏幕版 (LXGW WenKai Screen)** 与 **思源黑体 (Noto Sans SC)**，笔触温润柔和、间架规范，契合语文朗读与错题本学习场景；
  - **英文字体与数字**：采用 Google Fonts **Nunito**，圆润活泼；
  - **系统级回退**：自动无缝回退至 `PingFang SC` / `Hiragino Sans GB` / `Microsoft YaHei`。
- **设计风格**：明亮活泼儿童风，柔和蓝紫（`#6C63FF`）+ 暖黄点缀（`#FFD93D`）+ 卡片圆角 16px（`rounded-2xl`）
- **动效反馈**：
  - ✅ 任务完成卡片变绿，飘出动态金币动画（`+10分`）
  - 🎉 当日全部任务完成触发全屏七彩撒花粒子特效
  - 🔥 连击打卡天数更新触发火焰图标抖动及数字跳动

---

## 🛠 技术栈

| 模块 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **核心框架** | Vue 3 (Composition API / `<script setup>`) | 响应式前端框架 |
| **构建工具** | Vite 5.x | 毫秒级极速热重载与打包 |
| **样式方案** | Tailwind CSS 3.x + PostCSS | 原生手写 iPad 优化卡片组件（零臃肿 UI 库） |
| **中文字体** | 霞鹜文楷 屏幕版 + 思源黑体 | 专为儿童中文学习与阅读定制的字体方案 |
| **路由导航** | Vue Router 4 | 支持孩子端与独立家长端路由切换 |
| **状态管理** | Pinia | 响应式管理当前孩子会话、打卡状态与家长鉴权 |
| **数据通信** | Axios | RESTful API 客户端，支持代理与本地智能容灾降级 |
| **数据图表** | Chart.js 4.x + vue-chartjs 5.x | 最近 7 天完成率与达标柱状图 |
| **粒子动效** | canvas-confetti | 全勤庆祝全屏粒子喷射特效 |

---

## 📅 双重任务周期规则

系统现已全面支持两种任务周期规则：
1. **按固定星期重复**（`fixed_days`）：
   - 家长端自由勾选星期（周一至周日），支持工作日/周末/每天一键预设；
   - 每日任务看板在对应星期自动生成并呈现。
2. **每周完成特定次数**（`weekly_times`）：
   - 针对跳绳运动、课外阅读、大扫除等灵活型任务，家长可指定每周目标频次（如：每周 3 次）；
   - 学生端任务卡片实时展示周目标进度条与达成标识：`🎯 周目标 3次 · 本周已完成 2/3次`；
   - 孩子每周可自主规划任意天数完成，达标后自动点亮 🎉 达标徽章！

---

## 📂 项目结构

```text
frontend/
├── index.html                 # 入口 HTML，配置 iPad 视口与中英文专属字体
├── package.json               # 项目依赖与启动脚本
├── postcss.config.js          # PostCSS 配置文件
├── tailwind.config.js         # Tailwind 主题与儿童配色配置
├── vite.config.js             # Vite 代理与别名配置
├── src/
│   ├── main.js                # 应用入口文件
│   ├── App.vue                # 根组件
│   ├── style.css              # 全局样式与自定义关键帧动画
│   ├── api/
│   │   ├── client.js          # RESTful Axios 接口客户端（含后端状态感知）
│   │   └── redemptions.js     # 兑换申请分页加载
│   ├── stores/
│   │   ├── child.js           # 孩子状态与打卡数据 Pinia Store
│   │   └── parent.js          # 家长管理与 PIN 码鉴权 Pinia Store
│   ├── router/
│   │   └── index.js           # 完整路由配置（孩子端 + 家长端）
│   ├── utils/                 # 工具库
│   │   └── imageProcess.js    # Canvas 图像处理（拉普拉斯 3x3 锐化、白纸去灰底、自适应二值化、WebP压缩）
│   ├── components/            # iPad 优化手写组件
│   │   ├── ChildSelectCard.vue # 孩子头像选择大卡片
│   │   ├── PinInput.vue       # ≥64px 大按键数字 PIN 输入组件
│   │   ├── TaskCard.vue       # 双态任务卡片（含飘金币动效 & 每周频次进度）
│   │   ├── ProgressRing.vue   # 环形 SVG 进度指示器
│   │   ├── StreakBadge.vue    # Streak 连续打卡火焰动效组件
│   │   ├── BadgeWall.vue      # 徽章墙（已解锁彩显 / 未解锁灰显）
│   │   ├── PointsLog.vue      # 积分流水记录列表
│   │   ├── WeeklyChart.vue    # 周完成率柱状图
│   │   ├── MistakeCard.vue    # 错题卡片（学科分类 / 攻克状态切换 / 点击放大）
│   │   ├── PhotoCropModal.vue # 错题拍照、交互式裁剪与旋转、Canvas滤镜实时处理弹窗
│   │   └── ParentNavBar.vue   # 家长端顶栏导航
│   └── views/                 # 页面视图
│       ├── ChildSelectView.vue  # / 孩子选择页
│       ├── TodayTasksView.vue   # /child/:id/today 今日任务看板（核心主页）
│       ├── RewardsView.vue      # /child/:id/rewards 积分与徽章页
│       ├── HistoryView.vue      # /child/:id/history 历史统计页
│       ├── MistakesView.vue     # /child/:id/mistakes 错题本页（支持拍照/相册/拖拽/裁剪/滤镜）
│       ├── ParentLoginView.vue  # /parent/login 家长 PIN 登录页
│       ├── ParentDashboardView.vue # /parent/dashboard 家长总览
│       ├── ParentChildrenView.vue  # /parent/children 孩子账号管理
│       └── ParentTasksView.vue     # /parent/tasks 任务模板管理（支持每周特定频次）
│   test/
│   └── imageProcess.test.js   # 图像处理算法与滤镜自动化单元测试
```

---

## 🚀 安装与启动步骤

### 1. 安装依赖

```bash
cd frontend
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

### 3. 构建生产包

```bash
npm run build
```

---

## 🔌 后端 API 配置与联调

1. **反向代理配置**：
   开发环境下，Vite 默认将 `/api` 与 `/uploads` 反向代理至 `http://localhost:3000`。
   若需修改目标地址，可在 `frontend/.env` 设置：
   ```bash
   VITE_BACKEND_URL=http://localhost:3000
   ```

2. **需要后端运行**：
   前端所有数据都来自后端 API，开发时请先启动后端（`npm run dev:backend`，可先 `npm run seed:backend` 写入演示数据）。断网时页面会提示操作未确认，不会切换到本地数据。
