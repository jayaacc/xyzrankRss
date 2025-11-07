const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

class XyzRankScraper {
  constructor() {
    this.baseUrl = 'https://xyzrank.com';
    this.apiPattern = /https:\/\/xyzrank\.justinbot\.com\/assets\/hot-episodes\.[a-f0-9]+\.json/;
    this.cacheDir = path.join(__dirname, 'cache');
    this.rssCacheFile = path.join(this.cacheDir, 'podcasts.rss');
    this.dataCacheFile = path.join(this.cacheDir, 'podcasts.json');
    
    // 确保缓存目录存在
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 使用Puppeteer获取动态加载的API接口地址
   */
  async getApiEndpoint() {
    console.log('正在启动浏览器获取API接口...');
    
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      
      // 监听网络请求
      const apiUrls = [];
      page.on('response', async (response) => {
        const url = response.url();
        if (this.apiPattern.test(url)) {
          apiUrls.push(url);
          console.log('发现API接口:', url);
        }
      });
      
      // 访问页面
      await page.goto(this.baseUrl + '/#/', {
        waitUntil: 'networkidle0',
        timeout: 30000
      });
      
      // 等待一段时间确保所有请求完成
      await page.waitForTimeout(5000);
      
      if (apiUrls.length === 0) {
        // 如果没有监听到API请求，尝试从页面内容中提取
        const content = await page.content();
        const apiUrl = this.extractApiFromHtml(content);
        if (apiUrl) {
          apiUrls.push(apiUrl);
        }
      }
      
      return apiUrls.length > 0 ? apiUrls[0] : null;
      
    } catch (error) {
      console.error('获取API接口时出错:', error.message);
      return null;
    } finally {
      await browser.close();
    }
  }

  /**
   * 从HTML内容中提取API接口地址
   */
  extractApiFromHtml(html) {
    const $ = cheerio.load(html);
    
    // 查找包含API地址的script标签
    const scripts = $('script');
    for (let i = 0; i < scripts.length; i++) {
      const scriptContent = $(scripts[i]).html();
      if (scriptContent) {
        const match = scriptContent.match(this.apiPattern);
        if (match) {
          return match[0];
        }
      }
    }
    
    return null;
  }

  /**
   * 从播客页面提取音源地址
   */
  async extractAudioUrlFromPage(pageUrl) {
    try {
      console.log(`正在提取音源地址: ${pageUrl}`);
      
      const response = await axios.get(pageUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      });
      
      const $ = cheerio.load(response.data);
      
      // 主要策略：从meta标签中提取og:audio属性
      let audioUrl = '';
      
      // 1. 查找og:audio meta标签
      audioUrl = $('meta[property="og:audio"]').attr('content') || '';
      
      // 2. 如果og:audio不存在，尝试其他音频相关的meta标签
      if (!audioUrl) {
        audioUrl = $('meta[name="og:audio"]').attr('content') || '';
      }
      
      // 3. 查找其他可能的音频meta标签
      if (!audioUrl) {
        audioUrl = $('meta[property="audio"]').attr('content') || '';
      }
      
      if (!audioUrl) {
        audioUrl = $('meta[name="audio"]').attr('content') || '';
      }
      
      // 4. 作为备选方案，查找audio标签
      if (!audioUrl) {
        audioUrl = $('audio').attr('src') || '';
      }
      
      // 5. 查找source标签
      if (!audioUrl) {
        audioUrl = $('source').attr('src') || '';
      }
      
      // 处理相对路径
      if (audioUrl && !audioUrl.startsWith('http')) {
        const urlObj = new URL(pageUrl);
        audioUrl = urlObj.origin + (audioUrl.startsWith('/') ? audioUrl : '/' + audioUrl);
      }
      
      console.log(`音源地址提取结果: ${audioUrl || '未找到'}`);
      
      // 调试信息：显示页面中所有的meta标签
      if (!audioUrl) {
        console.log('页面meta标签调试信息:');
        $('meta').each((i, el) => {
          const property = $(el).attr('property');
          const name = $(el).attr('name');
          const content = $(el).attr('content');
          if (property || name) {
            console.log(`  ${property || name}: ${content}`);
          }
        });
      }
      
      return audioUrl;
      
    } catch (error) {
      console.error(`提取音源地址失败 (${pageUrl}):`, error.message);
      return '';
    }
  }

  /**
   * 获取播客数据并提取音源地址
   */
  async getPodcastData() {
    try {
      console.log('开始获取播客数据...');
      
      // 首先获取API接口地址
      const apiUrl = await this.getApiEndpoint();
      
      if (!apiUrl) {
        throw new Error('无法找到API接口地址');
      }
      
      console.log('使用API接口获取数据:', apiUrl);
      
      // 请求API接口获取数据
      const response = await axios.get(apiUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': this.baseUrl
        }
      });
      
      const data = response.data;
      
      if (!data || !data.data || !Array.isArray(data.data.episodes)) {
        throw new Error('API返回数据格式不正确');
      }
      
      console.log(`成功获取 ${data.data.episodes.length} 个播客剧集`);
      
      // 遍历每个播客，提取音源地址
      const enhancedEpisodes = [];
      
      for (let i = 0; i < data.data.episodes.length; i++) {
        const episode = data.data.episodes[i];
        console.log(`处理第 ${i + 1}/${data.data.episodes.length} 个播客: ${episode.title}`);
        
        // 如果有link地址，尝试提取音源
        if (episode.link) {
          const audioUrl = await this.extractAudioUrlFromPage(episode.link);
          enhancedEpisodes.push({
            ...episode,
            extractedAudioUrl: audioUrl,
            hasAudio: !!audioUrl
          });
        } else {
          enhancedEpisodes.push({
            ...episode,
            extractedAudioUrl: '',
            hasAudio: false
          });
        }
        
        // 添加延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // 更新缓存数据
      const enhancedData = {
        ...data,
        data: {
          ...data.data,
          episodes: enhancedEpisodes
        }
      };
      
      fs.writeFileSync(this.dataCacheFile, JSON.stringify(enhancedData, null, 2));
      
      console.log(`音源地址提取完成，成功提取 ${enhancedEpisodes.filter(e => e.hasAudio).length} 个音源`);
      
      // 生成feed.xml文件
      await this.generateFeedXML(enhancedEpisodes);
      
      return enhancedEpisodes;
      
    } catch (error) {
      console.error('获取播客数据时出错:', error.message);
      
      // 如果获取失败，尝试从缓存读取
      if (fs.existsSync(this.dataCacheFile)) {
        console.log('尝试从缓存读取数据...');
        try {
          const cachedData = JSON.parse(fs.readFileSync(this.data.dataCacheFile, 'utf8'));
          if (cachedData && cachedData.data && Array.isArray(cachedData.data.episodes)) {
            console.log('从缓存读取成功');
            return cachedData.data.episodes;
          }
        } catch (cacheError) {
          console.error('读取缓存失败:', cacheError.message);
        }
      }
      
      throw error;
    }
  }

  /**
   * 生成RSS文件
   */
  async generateRSS() {
    try {
      console.log('开始生成RSS文件...');
      
      const episodes = await this.getPodcastData();
      
      // 构建RSS内容
      const rssContent = this.buildRSSContent(episodes);
      
      // 写入缓存文件
      fs.writeFileSync(this.rssCacheFile, rssContent);
      
      console.log('RSS文件生成成功');
      return rssContent;
      
    } catch (error) {
      console.error('生成RSS文件时出错:', error.message);
      
      // 如果生成失败，尝试从缓存读取
      if (fs.existsSync(this.rssCacheFile)) {
        console.log('尝试从缓存读取RSS文件...');
        try {
          const cachedRSS = fs.readFileSync(this.rssCacheFile, 'utf8');
          console.log('从缓存读取RSS成功');
          return cachedRSS;
        } catch (cacheError) {
          console.error('读取RSS缓存失败:', cacheError.message);
        }
      }
      
      throw error;
    }
  }

  /**
   * 构建RSS内容
   */
  buildRSSContent(episodes) {
    const now = new Date().toUTCString();
    
    let rssItems = '';
    
    episodes.forEach((episode, index) => {
      const title = this.escapeXml(episode.title || '未知标题');
      const description = this.escapeXml(episode.description || episode.title || '无描述');
      const author = this.escapeXml(episode.podcastName || '未知作者');
      const audioUrl = episode.audioUrl || '';
      const coverImage = episode.logoURL || '';
      const publishDate = episode.publishDate ? new Date(episode.publishDate).toUTCString() : now;
      
      // 生成播客链接 - 如果有音频链接则使用音频链接，否则使用默认链接
      const link = audioUrl || `http://localhost:5777/episode/${index + 1}`;
      
      rssItems += `
    <item>
      <title>${title}</title>
      <description>${description}</description>
      <link>${link}</link>
      <pubDate>${publishDate}</pubDate>
      <guid isPermaLink="${!!audioUrl}">${audioUrl || `episode-${index + 1}`}</guid>
      ${audioUrl ? `<enclosure url="${audioUrl}" type="audio/mpeg" length="0" />` : ''}
      ${author ? `<itunes:author>${author}</itunes:author>` : ''}
      ${coverImage ? `<itunes:image href="${coverImage}" />` : ''}
      ${audioUrl ? `<itunes:duration>${episode.duration || '00:00'}</itunes:duration>` : ''}
    </item>`;
    });
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>XYZRank 热门播客排行榜</title>
    <description>来自 xyzrank.com 的热门播客排行榜</description>
    <link>https://xyzrank.com</link>
    <lastBuildDate>${now}</lastBuildDate>
    <pubDate>${now}</pubDate>
    <ttl>60</ttl>
    <atom:link href="http://localhost:5777/rss" rel="self" type="application/rss+xml" />
    <itunes:author>XYZRank</itunes:author>
    <itunes:summary>热门播客排行榜，每日更新</itunes:summary>
    <itunes:category text="Technology" />
    <itunes:image href="https://xyzrank.justinbot.com/public/og-image-2.png"/>
    ${rssItems}
  </channel>
</rss>`;
  }

  /**
   * 生成feed.xml文件
   */
  async generateFeedXML(episodes) {
    try {
      console.log('开始生成feed.xml文件...');
      
      const now = new Date();
      const pubDate = now.toUTCString();
      
      // 构建channel信息
      const channelInfo = `
    <atom:link href="http://localhost:5777/public/feed.xml" rel="self" type="application/rss+xml"/>
    <title><![CDATA[XYZRank 热门播客排行榜]]></title>
    <link>https://xyzrank.com</link>
    <language>zh-CN</language>
    <itunes:author><![CDATA[XYZRank]]></itunes:author>
    <itunes:summary><![CDATA[来自 xyzrank.com 的热门播客排行榜]]></itunes:summary>
    <description><![CDATA[来自 xyzrank.com 的热门播客排行榜]]></description>
    <copyright><![CDATA[Copyright @XYZRank]]></copyright>
    <itunes:owner>
      <itunes:name><![CDATA[XYZRank]]></itunes:name>
      <itunes:email>info@xyzrank.com</itunes:email>
    </itunes:owner>
    <itunes:keywords>播客,排行榜,热门</itunes:keywords>
    <itunes:image href="https://xyzrank.com/favicon.ico"/>
    <itunes:explicit>no</itunes:explicit>
    <itunes:category text="Technology">
      <itunes:category text="Software How-To"/>
    </itunes:category>`;
      
      // 构建item列表
      let items = '';
      
      episodes.forEach((episode, index) => {
        if (!episode.extractedAudioUrl) return; // 跳过没有音源的播客
        
        const title = episode.title || '未知标题';
        const author = episode.podcastName || '未知作者';
        const description = `播放量: ${episode.playCount || 0} | 评论数: ${episode.commentCount || 0} | 订阅数: ${episode.subscription || 0}`;
        const audioUrl = episode.extractedAudioUrl;
        const coverImage = episode.logoURL || '';
        const publishDate = episode.postTime ? new Date(episode.postTime).toUTCString() : pubDate;
        const duration = episode.duration || 0;
        
        // 确定音频文件类型
        let audioType = 'audio/mpeg';
        if (audioUrl.includes('.m4a')) {
          audioType = 'audio/x-m4a';
        } else if (audioUrl.includes('.mp3')) {
          audioType = 'audio/mpeg';
        } else if (audioUrl.includes('.aac')) {
          audioType = 'audio/aac';
        }
        
        // 转换时长格式（秒数或时间字符串）
        let durationSeconds = 0;
        if (typeof duration === 'number') {
          durationSeconds = duration;
        } else if (typeof duration === 'string') {
          // 处理时间格式如 "01:30:45"
          const timeParts = duration.split(':').reverse();
          durationSeconds = timeParts.reduce((total, part, index) => {
            return total + parseInt(part) * Math.pow(60, index);
          }, 0);
        }
        
        // 对URL进行XML转义
        const escapedAudioUrl = audioUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        const escapedLink = (episode.link || audioUrl).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        const escapedCoverImage = coverImage ? coverImage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;') : '';
        
        items += `
    <item>
      <title><![CDATA[${title}]]></title>
      <itunes:author><![CDATA[${author}]]></itunes:author>
      <link>${escapedLink}</link>
      <itunes:subtitle><![CDATA[${title}]]></itunes:subtitle>
      <description><![CDATA[<p>${description}</p>]]></description>
      ${coverImage ? `<itunes:image href="${escapedCoverImage}"/>` : ''}
      <enclosure url="${escapedAudioUrl}" length="0" type="${audioType}"/>
      <guid>${escapedAudioUrl}</guid>
      <pubDate>${publishDate}</pubDate>
      <itunes:duration>${durationSeconds}</itunes:duration>
    </item>`;
      });
      
      const feedContent = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
  <channel>${channelInfo}${items}
  </channel>
</rss>`;
      
      // 保存到public/feed.xml
      const feedPath = path.join(__dirname, 'public', 'feed.xml');
      fs.writeFileSync(feedPath, feedContent);
      
      console.log(`feed.xml文件生成成功，包含 ${items.split('<item>').length - 1} 个播客项目`);
      
    } catch (error) {
      console.error('生成feed.xml文件时出错:', error.message);
    }
  }

  /**
   * XML转义
   */
  escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"\n\r]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        case '\n': return ' ';
        case '\r': return ' ';
        default: return c;
      }
    });
  }

  /**
   * 自动更新数据（用于定时任务）
   */
  async autoUpdateData() {
    try {
      console.log('定时任务：开始自动更新播客数据...');
      console.log('当前时间：', new Date().toLocaleString('zh-CN'));
      
      const episodes = await this.getPodcastData();
      
      console.log('定时任务：数据更新完成');
      console.log(`成功处理 ${episodes.length} 个播客，其中 ${episodes.filter(e => e.hasAudio).length} 个有音源`);
      
      return episodes;
      
    } catch (error) {
      console.error('定时任务：更新数据失败:', error.message);
      throw error;
    }
  }

}

// 创建HTTP服务器
const http = require('http');

const scraper = new XyzRankScraper();

const server = http.createServer(async (req, res) => {
  // 设置CORS头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // 首页路由
  if (req.url === '/' || req.url === '/index.html') {
    try {
      const indexPath = path.join(__dirname, 'public', 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const fileStream = fs.createReadStream(indexPath);
        fileStream.pipe(res);
        return;
      }
    } catch (error) {
      console.error('处理首页请求时出错:', error.message);
    }
  }
  
  // 静态文件服务 - 处理public目录
  if (req.url.startsWith('/public/') || req.url === '/public') {
    try {
      let filePath = path.join(__dirname, 'public', req.url.replace('/public/', ''));
      
      // 如果请求的是/public，默认显示目录列表
      if (req.url === '/public' || req.url === '/public/') {
        filePath = path.join(__dirname, 'public');
        
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          const files = fs.readdirSync(filePath);
          const fileList = files.map(file => {
            const fullPath = path.join(filePath, file);
            const stats = fs.statSync(fullPath);
            return {
              name: file,
              path: `/public/${file}`,
              size: stats.size,
              isDirectory: stats.isDirectory(),
              modified: stats.mtime
            };
          });
          
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            directory: '/public',
            files: fileList
          }, null, 2));
          return;
        }
      }
      
      // 检查文件是否存在
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const fileExt = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'text/javascript',
          '.json': 'application/json',
          '.xml': 'application/xml',
          '.txt': 'text/plain',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.mp3': 'audio/mpeg',
          '.mp4': 'video/mp4'
        };
        
        const contentType = mimeTypes[fileExt] || 'application/octet-stream';
        
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600'
        });
        
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        return;
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: '文件不存在',
          path: req.url
        }));
        return;
      }
      
    } catch (error) {
      console.error('处理静态文件请求时出错:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: error.message
      }));
      return;
    }
  }
  
  if (req.url === '/api/endpoint' && req.method === 'GET') {
    // 获取API接口地址的端点
    try {
      console.log('收到获取API端点的请求');
      const apiUrl = await scraper.getApiEndpoint();
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        apiEndpoint: apiUrl,
        timestamp: new Date().toISOString()
      }));
      
    } catch (error) {
      console.error('处理请求时出错:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  } else if (req.url === '/api/podcasts' && req.method === 'GET') {
    // 获取原始播客数据
    try {
      console.log('收到获取播客数据的请求');
      
      // 尝试从缓存读取数据，不重新抓取
      if (fs.existsSync(scraper.dataCacheFile)) {
        console.log('从缓存读取播客数据');
        const cachedData = JSON.parse(fs.readFileSync(scraper.dataCacheFile, 'utf8'));
        if (cachedData && cachedData.data && Array.isArray(cachedData.data.episodes)) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            data: cachedData.data.episodes,
            count: cachedData.data.episodes.length,
            timestamp: new Date().toISOString()
          }, null, 2));
          return;
        }
      }
      
      // 如果没有缓存数据，返回空数据
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        data: [],
        count: 0,
        timestamp: new Date().toISOString()
      }, null, 2));
      
    } catch (error) {
      console.error('处理播客数据请求时出错:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  } else if (req.url === '/api/update-data' && req.method === 'POST') {
    // 手动更新数据
    try {
      console.log('收到手动更新数据请求');
      const episodes = await scraper.getPodcastData();
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        count: episodes.length,
        audioCount: episodes.filter(e => e.hasAudio).length,
        message: `成功更新 ${episodes.length} 个播客数据`,
        timestamp: new Date().toISOString()
      }));
      
    } catch (error) {
      console.error('手动更新数据时出错:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  } else if (req.url === '/api/generate-xml' && req.method === 'POST') {
    // 手动生成XML
    try {
      console.log('收到手动生成XML请求');
      
      // 从缓存读取数据
      if (!fs.existsSync(scraper.dataCacheFile)) {
        throw new Error('没有可用的播客数据，请先更新数据');
      }
      
      const cachedData = JSON.parse(fs.readFileSync(scraper.dataCacheFile, 'utf8'));
      if (!cachedData || !cachedData.data || !Array.isArray(cachedData.data.episodes)) {
        throw new Error('缓存数据格式不正确');
      }
      
      await scraper.generateFeedXML(cachedData.data.episodes);
      
      // 计算生成的item数量
      const feedPath = path.join(__dirname, 'public', 'feed.xml');
      const feedContent = fs.readFileSync(feedPath, 'utf8');
      const itemCount = (feedContent.match(/<item>/g) || []).length;
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        itemCount: itemCount,
        message: `成功生成包含 ${itemCount} 个播客的 RSS 文件`,
        timestamp: new Date().toISOString()
      }));
      
    } catch (error) {
      console.error('手动生成XML时出错:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  } else if (req.url === '/api/clear-cache' && req.method === 'POST') {
    // 清除缓存
    try {
      console.log('收到清除缓存请求');
      
      if (fs.existsSync(scraper.dataCacheFile)) {
        fs.unlinkSync(scraper.dataCacheFile);
      }
      if (fs.existsSync(scraper.rssCacheFile)) {
        fs.unlinkSync(scraper.rssCacheFile);
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        message: '缓存清除成功',
        timestamp: new Date().toISOString()
      }));
      
    } catch (error) {
      console.error('清除缓存时出错:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  } else if (req.url === '/api/force-update' && req.method === 'POST') {
    // 强制全量更新
    try {
      console.log('收到强制全量更新请求');
      
      // 先清除缓存
      if (fs.existsSync(scraper.dataCacheFile)) {
        fs.unlinkSync(scraper.dataCacheFile);
      }
      
      // 重新获取数据
      const episodes = await scraper.getPodcastData();
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        count: episodes.length,
        audioCount: episodes.filter(e => e.hasAudio).length,
        message: `强制更新完成，处理了 ${episodes.length} 个播客`,
        timestamp: new Date().toISOString()
      }));
      
    } catch (error) {
      console.error('强制更新时出错:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: false,
      error: '接口不存在',
      availableEndpoints: ['/', '/api/endpoint', '/api/podcasts', '/api/update-data', '/api/generate-xml', '/api/clear-cache', '/api/force-update', '/public']
    }));
  }
});

const PORT = process.env.PORT || 5777;

server.listen(PORT, () => {
  console.log(`🚀 XYZRank 播客服务已启动`);
  console.log(`📍 服务地址: http://localhost:${PORT}`);
  console.log(`🏠 管理面板: http://localhost:${PORT}/`);
  console.log(`🔗 API端点接口: http://localhost:${PORT}/api/endpoint`);
  console.log(`📊 播客数据接口: http://localhost:${PORT}/api/podcasts`);
  console.log(`📄 RSS订阅源: http://localhost:${PORT}/public/feed.xml`);
  console.log(`📁 静态文件目录: http://localhost:${PORT}/public`);
  console.log('');
  
  // 设置定时任务：每天上午8点自动更新数据
  cron.schedule('0 8 * * *', async () => {
    try {
      console.log('⏰ 定时任务：开始自动更新数据...');
      await scraper.autoUpdateData();
      console.log('⏰ 定时任务执行完成');
    } catch (error) {
      console.error('⏰ 定时任务执行失败:', error.message);
    }
  }, {
    timezone: 'Asia/Shanghai'
  });
  
  console.log('⏰ 定时任务已设置：每天上午8点自动更新数据');
  console.log('');
  console.log('💡 使用说明:');
  console.log('   1. 访问 http://localhost:5777/ 打开管理面板');
  console.log('   2. 在管理面板中手动更新数据或生成RSS');
  console.log('   3. 订阅 http://localhost:5777/public/feed.xml 到播客客户端');
  console.log('');
  console.log('等待请求...');
});