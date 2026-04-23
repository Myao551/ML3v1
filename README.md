# 三打一 - 在线扑克游戏

一个基于 Web 的四人实时扑克游戏。后端使用 Node.js、Express 和 Socket.IO，前端使用原生 HTML/CSS/JavaScript。

## 项目状态

当前版本重点实现了三打一的核心流程：

- 创建房间、加入房间、四人准备
- 发牌、叫分、确定庄家
- 庄家拿底牌、埋底
- 选择主花色或无主
- 出牌、跟牌、轮次胜负判断
- 闲家计分、扣底、结算
- Socket.IO 实时同步房间状态

> 说明：游戏状态目前保存在服务端内存中。服务重启、Render 免费实例休眠或重新部署后，正在进行的房间会丢失。

## 规则概要

- 使用两副扑克牌，共 108 张。
- 四名玩家参与，每人 25 张，底牌 8 张。
- 一名玩家为庄家，其余三名玩家为闲家。
- 叫分范围为 100 到 75，步长为 5，叫分越低表示庄家承诺越高。
- 闲家得分达到或超过庄家叫分时，闲家胜利。
- 王、2、7 为常主。
- 庄家可以选择主花色，也可以选择无主。
- 出牌阶段必须跟首家有效花色；没有该花色时可以垫牌或用主牌杀。
- 对子、拖拉机等牌型需要按规则跟出。
- 最后一轮闲家用主牌获胜时可以扣底，底牌分按牌型倍数加入闲家得分。

完整规则请参考 `三打一.md`。

## 本地运行

先安装依赖：

```bash
npm install
```

启动服务：

```bash
npm start
```

开发模式：

```bash
npm run dev
```

默认访问地址：

```text
http://localhost:3000
```

## 部署到 Render

本项目适合部署为 Render 的 **Web Service**。不要部署成 Static Site，因为游戏需要 Node.js 服务端和 WebSocket 长连接。

推荐配置：

```text
Runtime: Node
Build Command: npm ci
Start Command: npm start
Plan: Free 或更高
```

Render 会自动提供 `PORT` 环境变量，`server.js` 已经通过下面的方式读取端口：

```js
const PORT = process.env.PORT || 3000;
```

因此通常不需要在 Render 后台手动设置 `PORT`。

### Render 部署步骤

1. 将最新代码提交并推送到 GitHub。
2. 登录 [Render](https://render.com)。
3. 点击 **New +**，选择 **Web Service**。
4. 连接 GitHub 仓库。
5. 设置服务：
   - Name: `sanda1-poker-game`
   - Runtime: `Node`
   - Build Command: `npm ci`
   - Start Command: `npm start`
6. 创建服务，等待构建完成。
7. 打开 Render 分配的域名测试游戏。

### Render 注意事项

- 免费实例一段时间无人访问后会休眠，首次访问会有冷启动延迟。
- 房间状态保存在内存中，实例休眠、重启或重新部署会清空当前房间。
- 当前实现适合单实例运行。如果以后要水平扩容，需要把房间状态迁移到 Redis 或数据库，并配置 Socket.IO adapter。
- 部署前必须确认本地修改已经 commit 并 push，否则 Render 从 GitHub 部署时不会包含本地未提交代码。

## 其他平台

### Railway / Fly.io

Railway 和 Fly.io 也支持长连接服务，可以直接部署本项目的 Node.js 服务端。

### Netlify / Vercel

Netlify Functions 和 Vercel Serverless Functions 不适合直接承载这个 Socket.IO 长连接服务。如果要使用这些平台，建议只托管静态前端，并把实时后端部署到 Render、Railway、Fly.io 或其他支持 WebSocket 的平台。

## 项目结构

```text
.
├── package.json
├── package-lock.json
├── server.js
├── render.yaml
├── DEPLOY.md
├── README.md
├── 三打一.md
└── public/
    ├── index.html
    ├── style.css
    └── game.js
```

## 技术栈

- 后端：Node.js、Express、Socket.IO
- 前端：HTML、CSS、JavaScript
- 实时通信：WebSocket / Socket.IO
- 部署推荐：Render Web Service

## 常见问题

### 为什么不推荐直接部署到 Netlify 或 Vercel？

这个游戏需要持续的 WebSocket 连接。Netlify/Vercel 的 Serverless Functions 更适合短请求，不适合直接运行当前这种常驻 Socket.IO 服务。

### 为什么 Render 上游戏房间会消失？

当前房间数据存放在 Node.js 进程内存中。Render 免费实例休眠、服务重启或重新部署都会重置进程内存，因此房间会消失。

### 能否多人同时开多个房间？

可以。当前服务用房间 ID 区分不同对局。只要服务实例没有重启，不同房间可以同时存在。

## License

MIT
