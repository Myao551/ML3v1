# 三打一扑克游戏 - 部署指南

## 项目概述

这是一个基于 Web 的多人实时扑克游戏，支持四人同时在线对战。游戏完全实现了"三打一"规则。

## 部署方案

### 方案1: Render.com (推荐 ⭐)

**优点**: 原生支持 WebSocket，免费套餐足够使用，部署最简单

1. 注册 [Render](https://render.com) 账号
2. 点击 "New Web Service"
3. 连接你的 GitHub 仓库或上传代码
4. 配置:
   - **Name**: sanda1-poker
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
5. 点击创建，等待部署完成

**注意**: Free 套餐在无访问15分钟后会休眠，首次访问可能需要等待启动。

---

### 方案2: Railway.app (推荐 ⭐)

**优点**: 支持 WebSocket，无需信用卡，每月 5 美元免费额度

1. 注册 [Railway](https://railway.app) 账号
2. 点击 "New Project" → "Deploy from GitHub repo"
3. 选择你的仓库
4. Railway 会自动检测 Node.js 项目并部署
5. 自动生成域名，直接使用

---

### 方案3: Fly.io (推荐 ⭐)

**优点**: 全球 CDN，性能优秀，每月有免费额度

1. 安装 Fly CLI:
   ```bash
   # Windows (PowerShell)
   iwr https://fly.io/install.ps1 -useb | iex
   
   # Mac/Linux
   curl -L https://fly.io/install.sh | sh
   ```

2. 登录:
   ```bash
   fly auth login
   ```

3. 初始化并部署:
   ```bash
   fly launch
   fly deploy
   ```

---

### 方案4: Netlify (需要额外配置)

**注意**: Netlify Functions 不支持原生 WebSocket，需要使用 Pusher 等第三方服务

#### 步骤:

1. **注册 Pusher 账号**
   - 访问 [Pusher](https://pusher.com/)
   - 创建免费账号
   - 创建 Channels 应用
   - 记录 App ID, Key, Secret, Cluster

2. **配置环境变量**
   在 Netlify 后台 → Site settings → Environment variables 添加:
   ```
   PUSHER_APP_ID=your_app_id
   PUSHER_KEY=your_key
   PUSHER_SECRET=your_secret
   PUSHER_CLUSTER=your_cluster
   ```

3. **修改前端配置**
   编辑 `netlify-server/public/game.js`，替换 Pusher 配置:
   ```javascript
   const PUSHER_KEY = '你的Pusher Key';
   const PUSHER_CLUSTER = '你的Cluster';
   ```

4. **部署到 Netlify**
   - 方式1: 直接拖拽 `netlify-server/public` 文件夹到 Netlify Drop
   - 方式2: 连接 GitHub 仓库，自动部署

---

### 方案5: Vercel (需要额外配置)

**注意**: Vercel Serverless Functions 有 10 秒执行限制，不适合长时间连接

建议使用 Vercel 仅部署静态前端，后端使用其他方案。

---

## 推荐部署方案总结

| 平台 | WebSocket 支持 | 免费额度 | 难度 | 推荐指数 |
|------|---------------|---------|------|---------|
| **Render** | ✅ 原生支持 | 750小时/月 | ⭐ 简单 | ⭐⭐⭐⭐⭐ |
| **Railway** | ✅ 原生支持 | 5美元/月 | ⭐ 简单 | ⭐⭐⭐⭐⭐ |
| **Fly.io** | ✅ 原生支持 | 2340小时/月 | ⭐⭐ 中等 | ⭐⭐⭐⭐ |
| Netlify | ❌ 需要 Pusher | 125k 请求/月 | ⭐⭐⭐ 复杂 | ⭐⭐⭐ |
| Vercel | ❌ 有限制 | Hobby 免费 | ⭐ 简单 | ⭐⭐ |

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 或
npm start

# 访问 http://localhost:3000
```

## 项目文件结构

```
.
├── server.js              # 主服务器 (Render/Railway/Fly.io)
├── package.json
├── README.md
├── render.yaml            # Render 配置
├── vercel.json            # Vercel 配置
├── netlify.toml           # Netlify 配置
├── netlify-server/        # Netlify 版本
│   ├── public/
│   │   ├── index.html
│   │   ├── style.css
│   │   └── game.js
│   └── functions/
│       ├── room.js
│       └── pusher-auth.js
└── public/                # 原版前端文件
    ├── index.html
    ├── style.css
    └── game.js
```

## 游戏房间链接

部署完成后，玩家可以通过以下方式加入房间:

1. **创建房间** → 获得房间号
2. **分享链接** → `https://your-domain.com/?room=ROOM_ID`
3. **好友点击链接** → 自动填入房间号，输入昵称即可加入

## 常见问题

**Q: 为什么推荐使用 Render/Railway 而不是 Netlify?**
A: 扑克游戏需要实时通信，WebSocket 是最佳选择。Netlify Functions 不支持持久的 WebSocket 连接。

**Q: 免费套餐够用吗?**
A: 对于小型游戏房间(4人)，所有平台的免费套餐都足够。

**Q: 可以同时开多个房间吗?**
A: 可以，每个房间是独立的，由房间 ID 区分。

**Q: 如何防止作弊?**
A: 当前版本为演示用途，游戏逻辑主要在服务端执行，但完整防作弊需要更复杂的实现。

## 许可证

MIT License
