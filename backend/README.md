# 小学生日常作业任务管理系统 - 后端服务 (Backend)

本项目是针对小学生日常作业任务管理系统的后端 API 服务，基于 **Node.js + Fastify + SQLite (better-sqlite3)** 构建，为孩子端（iPad Air 5 横屏）及家长管理端提供轻量高效、零运维依赖的 RESTful JSON 接口。

---

## 🛠️ 技术栈

- **运行环境**：Node.js 20+ LTS
- **Web 框架**：[Fastify 4.x](https://fastify.dev/)（支持插件生态与高性能 JSON 序列化）
- **数据库**：SQLite（通过 [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) 访问，WAL 模式与外键级联）
- **身份认证**：`@fastify/jwt` + PBKDF2 安全加盐 Hash
- **图像处理**：`sharp` (高性能 libvips Node.js 绑定，支持 EXIF 自动校正、对比度拉伸、自适应锐化、尺寸压缩与 WebP 标准化存储)
- **文件上传**：`@fastify/multipart`（错题本照片上传，存储至 `/uploads` 目录）
- **静态资源**：`@fastify/static`
- **跨域支持**：`@fastify/cors`

---

## 📁 目录结构

```text
backend/
├── src/
│   ├── app.js               # Fastify 应用工厂（加载插件、装饰器与路由）
│   ├── server.js            # 服务启动入口（支持优雅退出与多信号处理）
│   ├── config.js            # 环境变量与默认配置
│   ├── db/
│   │   ├── index.js         # SQLite 连接管理、WAL 模式配置与自动初始化
│   │   ├── schema.sql       # 数据库表结构定义与索引
│   │   └── seed.js          # 数据库种子数据（孩子与任务模板）
│   ├── services/
│   │   ├── auth.service.js      # 孩子/家长登录与 PIN 认证
│   │   ├── children.service.js  # 孩子账号 CRUD 与数据隔离
│   │   ├── tasks.service.js     # 任务模板与每日任务实例按星期自动生成
│   │   ├── rewards.service.js   # 积分、连续打卡 (Streak) 与徽章自动解锁逻辑
│   │   ├── mistakes.service.js  # 错题记录与照片上传
│   │   ├── stats.service.js     # 历史记录与本周/上周汇总统计
│   │   └── characters.service.js# 生字本数据管理与掌握状态切换
│   ├── routes/
│   │   ├── auth.routes.js       # /api/auth/*
│   │   ├── children.routes.js   # /api/children/*
│   │   ├── templates.routes.js  # /api/task-templates/*
│   │   ├── daily-tasks.routes.js# /api/daily-tasks/*
│   │   ├── rewards.routes.js    # /api/badge-definitions, /api/children/:id/stats, /api/children/:id/badges
│   │   ├── mistakes.routes.js   # /api/mistakes/*
│   │   ├── stats.routes.js      # /api/children/:id/history, /api/children/:id/weekly-summary
│   │   └── characters.routes.js # /api/characters/*
│   └── utils/
│       ├── crypto.js            # PIN 哈希校验与 UUID 工具
│       ├── date.js              # 本地日期格式化、星期与日期范围计算
│       └── image.js             # Sharp 图像增强、EXIF校正、锐化缩放与压缩流水线
├── test/                    # 单元与集成测试套件 (node:test)
├── uploads/                 # 错题拍照本地静态存储目录
├── data.sqlite              # 本地 SQLite 数据文件
├── package.json
└── README.md
```

---

## ⚙️ 环境变量说明

可通过环境变量或 `.env` 配置服务参数：

| 环境变量名 | 默认值 | 说明 |
|-----------|-------|------|
| `PORT` | `3000` | 后端服务监听端口 |
| `HOST` | `0.0.0.0` | 监听地址（支持局域网设备与 iPad 访问） |
| `DATABASE_PATH` | `./data.sqlite` | SQLite 数据库文件绝对或相对路径 |
| `UPLOAD_DIR` | `./uploads` | 错题上传图片存储目录 |
| `JWT_SECRET` | `homework-task-secret-key-2026` | JWT 签名密钥 |
| `DEFAULT_PARENT_PIN` | `1234` | 全新安装时的初始家长 PIN，首次登录后必须修改 |
| `IMAGE_MAX_DIMENSION` | `1600` | 错题照片最大单边限制（超过则等比缩放） |
| `IMAGE_FORMAT` | `webp` | 错题照片目标标准化存储格式（`webp` 或 `jpeg`） |
| `IMAGE_QUALITY` | `85` | 图像压缩质量（1-100） |

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 数据库初始化与种子数据（可选）

启动时会自动检查并初始化 SQLite 表结构和 8 大基础成就徽章。若需要预置演示孩子账号和日常任务模板：

```bash
npm run seed
```

> **预置演示数据**：
> - 孩子 1：小明（头像 `🐱`，PIN 码 `1234`）
> - 孩子 2：小红（头像 `🐰`，免 PIN 直接进入）
> - 模板：语文朗读、数学练习册、英语单词、课外阅读20页、跳绳300个、整理书包

### 3. 启动开发服务

```bash
npm run dev
```

### 4. 生产启动

```bash
npm run start
```

### 5. 运行全量测试套件

内置使用 Node.js 原生测试引擎（无需额外庞大测试依赖，内存内极速执行）：

```bash
npm test
```

---

## 📖 API 接口契约说明

所有接口路径以 `/api` 为前缀，通信使用 JSON 格式。

### 1. 认证管理 (Auth)

#### 孩子登录
- **`POST /api/auth/child-login`**
- **请求体**：
  ```json
  {
    "child_id": "uuid-string",
    "pin": "1234"
  }
  ```
  *(若孩子未设置 PIN，无需传递 pin 字段)*
- **成功响应** (200)：
  ```json
  {
    "success": true,
    "token": "jwt-token",
    "child_id": "uuid-string",
    "child": {
      "id": "uuid-string",
      "name": "小明",
      "avatar_emoji": "🐱"
    }
  }
  ```

#### 家长登录
- **`POST /api/auth/parent-login`**
- **请求体**：`{ "pin": "1234" }`
- **成功响应** (200)：
  ```json
  {
    "success": true,
    "token": "jwt-token",
    "role": "parent",
    "must_change_pin": false
  }
  ```
- `must_change_pin` 为 `true` 时表示仍在使用默认 PIN：此时家长会话只能调用修改 PIN 接口，其余家长接口返回 403 和 `"code": "PARENT_PIN_CHANGE_REQUIRED"`。

#### 是否仍为默认 PIN
- **`GET /api/auth/setup`**（无需登录）
- **成功响应** (200)：`{ "parent_pin_is_default": true }`

#### 退出登录
- **`POST /api/auth/logout`**
- **成功响应** (200)：`{ "success": true, "message": "Logged out successfully" }`

#### 修改家长 PIN 码
- **`PUT /api/auth/parent-pin`**
- **请求体**：`{ "old_pin": "1234", "new_pin": "8888" }`
- 新 PIN 必须为 4 位数字，且不能与默认 PIN 或当前 PIN 相同；修改后所有会话失效，需要重新登录。

---

### 2. 孩子账号管理 (Children)

- **`GET /api/children`**：获取所有孩子列表
  ```json
  [
    {
      "id": "250e21f5-8206-46f1-bbc2-29e3c6039be5",
      "name": "小明",
      "avatar_emoji": "🐱",
      "has_pin": true,
      "created_at": "2026-10-13T10:04:06.050Z"
    }
  ]
  ```
- **`POST /api/children`**：创建孩子账号 (201)
  - 请求体：`{ "name": "小明", "avatar_emoji": "🦁", "pin": "1234" }`
- **`PUT /api/children/:id`**：更新孩子（姓名、Emoji头像、PIN码）
- **`DELETE /api/children/:id`**：删除孩子（级联删除该孩子的所有任务与数据）

---

### 3. 任务模板配置 (Task Templates)

任务模板供家长配置每周重复出现的作业任务项。

- **`GET /api/task-templates`**：获取所有任务模板
  ```json
  [
    {
      "id": "template-uuid",
      "title": "语文朗读",
      "subject": "语文",
      "days_of_week": [1, 2, 3, 4, 5],
      "points": 10,
      "created_at": "2026-10-13T10:04:06.053Z"
    }
  ]
  ```
  *(注：`days_of_week` 为数字数组：`0` 代表周日，`1-6` 代表周一至周六)*
- **`POST /api/task-templates`**：创建模板 (201)
  - 请求体：`{ "title": "数学练习册", "subject": "数学", "days_of_week": [1,2,3,4,5], "points": 15 }`
- **`PUT /api/task-templates/:id`**：修改模板
- **`DELETE /api/task-templates/:id`**：删除模板

---

### 4. 每日任务实例 (Daily Tasks)

- **`GET /api/daily-tasks?child_id=<childId>&date=YYYY-MM-DD`**
  - **自动生成机制**：若指定日期该孩子尚无任务实例，接口会根据当天的星期自动拉取匹配的模板生成当天的任务清单（未访问前不提前生成）；
  - **多孩子隔离**：严格按 `child_id` 独立生成与查询；
  - **响应示例** (200)：
    ```json
    [
      {
        "id": "task-uuid-1",
        "child_id": "child-uuid",
        "template_id": "template-uuid",
        "title": "语文朗读",
        "subject": "语文",
        "points": 10,
        "date": "2026-10-13",
        "is_completed": false,
        "completed_at": null
      }
    ]
    ```

- **`POST /api/daily-tasks/:id/complete`**：打卡完成任务
  - 自动更新完成状态、插入积分流水 `point_logs`；
  - 实时评估 Streak 与徽章解锁条件，返回解锁的徽章列表；
  - **响应示例** (200)：
    ```json
    {
      "success": true,
      "task": {
        "id": "task-uuid-1",
        "is_completed": true,
        "completed_at": "2026-10-13T10:15:00.000Z"
      },
      "points_earned": 10,
      "new_badges": [
        {
          "key": "first_complete",
          "name": "初出茅庐",
          "icon_emoji": "🌟"
        }
      ]
    }
    ```

- **`POST /api/daily-tasks/:id/uncomplete`**：取消完成
  - 还原未完成状态，扣除对应积分流水。

---

### 5. 积分与激励系统 (Rewards & Badges)

- **`GET /api/children/:id/stats`**：获取孩子个人数据统计
  ```json
  {
    "total_points": 135,
    "current_streak": 5,
    "today_total_tasks": 6,
    "today_completed_tasks": 3,
    "today_completion_rate": 0.5,
    "today_points": 35
  }
  ```
  *(Streak 连续打卡逻辑：实时根据 `daily_tasks` 统计。若当天尚未打卡，继承截止至昨天的连续天数，避免早晨打开显示 0)*

- **`GET /api/children/:id/badges`**：获取孩子已解锁的成就徽章墙
- **`GET /api/badge-definitions`**：获取全部徽章定义（共 8 款基础徽章）

#### 内置成就徽章一览

| key | 名称 | 条件说明 | 图标 |
|-----|------|---------|------|
| `first_complete` | 初出茅庐 | 第一次完成作业任务 | 🌟 |
| `streak_3` | 三连击 | 连续 3 天完成任务 | 🔥 |
| `streak_7` | 一周勇士 | 连续 7 天完成任务 | 🚀 |
| `streak_30` | 月度冠军 | 连续 30 天完成任务 | 👑 |
| `points_100` | 小富翁 | 累计积分 ≥ 100 分 | 💰 |
| `points_500` | 积分达人 | 累计积分 ≥ 500 分 | 💎 |
| `all_done_once` | 全勤王 | 第一次完成当天所有作业 | ✅ |
| `all_done_10` | 优秀学生 | 累计 10 次完成当天所有作业 | 🏆 |

---

### 6. 家长端历史统计 (History & Weekly Summary)

- **`GET /api/children/:id/history?from=YYYY-MM-DD&to=YYYY-MM-DD`**
  - 按日期范围返回每日任务完成度及任务详情，默认最近 30 天。
- **`GET /api/children/:id/weekly-summary?date=YYYY-MM-DD`**
  - 返回**本周**与**上周**（周一至周日）的数据对比统计与每日完成走势，适配前端 Chart.js 柱状图展示。

---

### 7. 错题记录 (Mistakes)

- **`GET /api/mistakes?child_id=<childId>&subject=<subject>`**：查询错题列表
- **`POST /api/mistakes`**：录入错题 (201)
  - 支持 **`application/json`** 与 **`multipart/form-data`** 表单文件上传；
  - 上传图片支持 JPG、PNG、WEBP 格式，经服务端 Sharp 图像流水线自动处理：
    1. EXIF 朝向自动校正（`.rotate()`）；
    2. 色阶归一化与对比度自适应增强（`.normalize()`）；
    3. 自适应字迹边缘锐化（`.sharpen({ sigma: 1.2, m1: 1.0, m2: 2.0 })`）；
    4. 大图等比例限制单边最大 1600px；
    5. 标准化转换为高压缩比 WebP（质量 85，可在配置中设为 JPEG）存储至 `/uploads` 目录；
  - 若解析异常支持平滑回退，非图片格式校验返回 400 错误；
  - 静态访问地址：`http://<host>:<port>/uploads/<filename>`；
  - 参数：`child_id`, `subject`, `description`, `file` (可选)。
- **`PUT /api/mistakes/:id/master`**：标记错题已掌握
- **`DELETE /api/mistakes/:id`**：删除错题（自动同步删除本地图片文件）

---

### 8. 生字本管理 (Characters)

- **`GET /api/characters?child_id=<childId>&is_mastered=<0|1>`**：获取指定孩子的生字列表
  - 支持按掌握状态 `is_mastered` 过滤（`0` 未掌握，`1` 已掌握）；
  - 默认按 `created_at DESC` 倒序返回；
  - 严格按 `child_id` 实施多孩子数据隔离。
- **`GET /api/characters/:id`**：获取指定生字详情
- **`POST /api/characters`**：将汉字加入生字本 (201)
  - 请求体：
    ```json
    {
      "child_id": "child-uuid",
      "char": "学",
      "pinyin": "xué",
      "strokes": 8,
      "radical": "子"
    }
    ```
  - 校验规则：
    - `child_id` 必须存在且合法；
    - `char` 单字校验（单字符且非空）；
    - 唯一性校验：同一孩子不可重复添加相同汉字，重复添加返回 409。
- **`PUT /api/characters/:id/master`**：切换 / 标记掌握状态
  - 可传 `{ "is_mastered": true|false }` 显式设置；
  - 若不传请求体，则自动取反切换状态；
  - 设为已掌握时记录 `mastered_at` ISO 时间戳，取消掌握时清空为 null。
- **`DELETE /api/characters/:id`**：从生字本移除生字 (200)

### 9. 积分兑换、临时任务、长期任务与假期

以下接口的写操作均需家长权限（孩子可兑换、撤回自己的申请，并记录、撤销自己当天的长期任务进度）。

| 方法与路径 | 说明 |
|---|---|
| `GET/POST /api/reward-items`，`PUT/DELETE /api/reward-items/:id` | 奖励列表与管理 |
| `GET/POST /api/children/:id/redemptions` | 孩子的兑换记录、申请兑换（积分先冻结） |
| `GET /api/redemptions?status=pending`，`POST /api/redemptions/:id/{approve,reject,cancel}` | 待确认列表、确认、拒绝、撤回 |
| `GET/POST /api/children/:id/adhoc-tasks`，`DELETE /api/adhoc-tasks/:id` | 临时任务（某一天的一次性任务） |
| `GET/POST /api/children/:id/goals` | 长期任务列表（含假期任务）、新建独立长期任务 |
| `GET/POST /api/children/:id/periods`，`PUT/DELETE /api/periods/:id` | 假期及假期中暂停的模板 |
| `POST /api/periods/:id/tasks` | 新建假期任务（日期跟随假期） |
| `PUT/DELETE /api/period-tasks/:id` | 修改、删除长期任务或假期任务 |
| `POST /api/period-tasks/:id/logs` | 记录进度：`{ "amount": 5 }` 或按位置 `{ "position": 57 }`，家长可加 `date` 补记 |
| `DELETE /api/period-task-logs/:id` | 撤销一条进度记录并扣回积分 |

---

## 🧪 接口验证示例 (cURL)

```bash
# 1. 家长登录
curl -X POST http://127.0.0.1:3000/api/auth/parent-login \
  -H "Content-Type: application/json" \
  -d '{"pin": "1234"}'

# 2. 获取孩子列表
curl http://127.0.0.1:3000/api/children

# 3. 获取小明今日任务（假设已运行 seed，小明 ID 传入即可）
curl "http://127.0.0.1:3000/api/daily-tasks?child_id=<CHILD_ID>&date=2026-10-13"

# 4. 打卡完成任务
curl -X POST "http://127.0.0.1:3000/api/daily-tasks/<TASK_ID>/complete"

# 5. 查看积分与连续打卡
curl "http://127.0.0.1:3000/api/children/<CHILD_ID>/stats"

# 6. 加入生字本
curl -X POST http://127.0.0.1:3000/api/characters \
  -H "Content-Type: application/json" \
  -d '{"child_id": "<CHILD_ID>", "char": "学", "pinyin": "xué", "strokes": 8, "radical": "子"}'

# 7. 查看生字本列表
curl "http://127.0.0.1:3000/api/characters?child_id=<CHILD_ID>"

# 8. 切换/标记掌握状态
curl -X PUT "http://127.0.0.1:3000/api/characters/<CHAR_ID>/master"
```
