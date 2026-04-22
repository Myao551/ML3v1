# 三打一 - 在线扑克游戏

一个基于 Web 的多人实时扑克游戏，支持四人同时在线对战。

## 游戏简介

三打一是一种起源于湖南的扑克牌游戏，四人参与，三打一（1名庄家 vs 3名闲家）。游戏使用两副扑克牌（不去掉3和4），共108张牌。

## 游戏规则

- **发牌**：每人25张牌，8张底牌
- **叫分**：从100分起叫，最低叫到75分
- **主牌**：王、2、7为常主，庄家可选主牌花色或打无主
- **计分**：5、10、K为分牌，闲家抓分达到庄分则庄家下庄
- **抠底**：闲家以主牌赢得最后一轮可获得底牌分数加成

## 本地运行

```bash
# 安装依赖
npm install

# 启动服务器
npm start

# 访问 http://localhost:3000
```

## 部署到 Netlify

### 方法1：使用 Socket.io 适配器（推荐用于静态托管）

1. 注册 [Pusher](https://pusher.com/) 账号并创建应用
2. 在 Netlify 环境变量中添加：
   - `PUSHER_APP_ID`
   - `PUSHER_KEY`
   - `PUSHER_SECRET`
   - `PUSHER_CLUSTER`
3. 部署到 Netlify

### 方法2：使用 Render/Railway（推荐，完整 WebSocket 支持）

由于 Netlify Functions 对 WebSocket 支持有限，推荐使用以下平台：

- [Render](https://render.com)
- [Railway](https://railway.app)
- [Fly.io](https://fly.io)

这些平台原生支持 WebSocket，可以直接部署本项目。

## 项目结构

```
.
├── package.json
├── server.js          # Node.js 服务器
├── README.md
├── netlify.toml       # Netlify 配置
├── vercel.json        # Vercel 配置
└── public/
    ├── index.html     # 前端页面
    ├── style.css      # 样式
    └── game.js        # 游戏逻辑
```

## 技术栈

- 后端：Node.js + Socket.io
- 前端：原生 HTML/CSS/JavaScript
- 实时通信：WebSocket

## License

MIT
