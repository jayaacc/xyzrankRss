# XYZRank 播客排行榜服务

一个Node.js服务，用于获取xyzrank.com播客排行榜的数据。

## 功能特性

- 🔍 自动发现动态API接口地址
- 📊 获取完整的播客排行榜数据
- 🌐 提供RESTful API接口
- 🔒 支持CORS跨域访问

## 安装依赖

```bash
npm install
```

## 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

## API接口

### 1. 获取播客排行榜数据

**GET** `/api/podcasts`

返回完整的播客排行榜数据。

**响应示例:**
```json
{
  "success": true,
  "data": [
    {
      "rank": 1,
      "title": "播客标题",
      "author": "作者",
      "description": "描述",
      "duration": "时长",
      "publishDate": "发布日期",
      "audioUrl": "音频链接",
      "coverImage": "封面图片"
    }
  ],
  "count": 100,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. 获取API端点地址

**GET** `/api/endpoint`

返回当前使用的xyzrank.com API接口地址。

**响应示例:**
```json
{
  "success": true,
  "apiEndpoint": "https://xyzrank.justinbot.com/assets/hot-episodes.xxx.json",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## 技术实现

- **Puppeteer**: 用于模拟浏览器行为，获取动态加载的API地址
- **Axios**: 用于HTTP请求
- **Cheerio**: 用于HTML解析
- **原生HTTP模块**: 创建轻量级服务器

## 工作原理

1. 使用Puppeteer打开xyzrank.com页面
2. 监听网络请求，捕获API接口地址
3. 直接请求获取到的API接口
4. 格式化数据并提供API服务

## 注意事项

- 首次启动可能需要较长时间（10-30秒）来初始化浏览器
- API接口地址可能会定期变更，服务会自动检测更新
- 建议设置合理的请求频率，避免对目标网站造成压力