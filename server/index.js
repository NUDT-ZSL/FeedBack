const express = require('express');
const cors = require('cors');
const Datastore = require('nedb-promises');
const path = require('path');
const { analyzeCode } = require('./analyze');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const snippetsDb = Datastore.create(path.join(__dirname, 'data', 'snippets.db'));
const ratingsDb = Datastore.create(path.join(__dirname, 'data', 'ratings.db'));

const sampleSnippets = [
  {
    id: 'sample-1',
    title: '快速排序算法',
    code: "function quickSort(arr) {\n  if (arr.length <= 1) {\n    return arr;\n  }\n  \n  const pivot = arr[Math.floor(arr.length / 2)];\n  const left = arr.filter(x => x < pivot);\n  const middle = arr.filter(x => x === pivot);\n  const right = arr.filter(x => x > pivot);\n  \n  return [...quickSort(left), ...middle, ...quickSort(right)];\n}\n\n// 使用示例\nconst numbers = [64, 34, 25, 12, 22, 11, 90];\nconsole.log(quickSort(numbers));",
    language: 'javascript',
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    author: 'demo_user'
  },
  {
    id: 'sample-2',
    title: '用户登录验证',
    code: "async function loginUser(username, password) {\n  if (!username || !password) {\n    throw new Error('用户名和密码不能为空');\n  }\n\n  const user = await UserModel.findOne({ username });\n  if (!user) {\n    throw new Error('用户不存在');\n  }\n\n  const isValid = await bcrypt.compare(password, user.passwordHash);\n  if (!isValid) {\n    throw new Error('密码错误');\n  }\n\n  const token = jwt.sign(\n    { userId: user.id, username: user.username },\n    process.env.JWT_SECRET,\n    { expiresIn: '24h' }\n  );\n\n  return { user, token };\n}",
    language: 'javascript',
    createdAt: new Date(Date.now() - 86400000 * 9).toISOString(),
    author: 'demo_user'
  },
  {
    id: 'sample-3',
    title: '二分查找实现',
    code: "def binary_search(arr, target):\n    left, right = 0, len(arr) - 1\n    \n    while left <= right:\n        mid = (left + right) // 2\n        \n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    \n    return -1\n\n# 使用示例\nnumbers = [1, 3, 5, 7, 9, 11, 13, 15]\nresult = binary_search(numbers, 7)\nprint(f\"目标值索引: {result}\")",
    language: 'python',
    createdAt: new Date(Date.now() - 86400000 * 8).toISOString(),
    author: 'python_dev'
  },
  {
    id: 'sample-4',
    title: '单例模式实现',
    code: "public class Singleton {\n    private static volatile Singleton instance;\n    private String data;\n\n    private Singleton(String data) {\n        this.data = data;\n    }\n\n    public static Singleton getInstance(String data) {\n        if (instance == null) {\n            synchronized (Singleton.class) {\n                if (instance == null) {\n                    instance = new Singleton(data);\n                }\n            }\n        }\n        return instance;\n    }\n\n    public String getData() {\n        return data;\n    }\n}",
    language: 'java',
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    author: 'java_pro'
  },
  {
    id: 'sample-5',
    title: 'React Hook - useFetch',
    code: "import { useState, useEffect } from 'react';\n\nfunction useFetch(url, options = {}) {\n  const [data, setData] = useState(null);\n  const [loading, setLoading] = useState(true);\n  const [error, setError] = useState(null);\n\n  useEffect(() => {\n    const controller = new AbortController();\n\n    async function fetchData() {\n      try {\n        setLoading(true);\n        const response = await fetch(url, {\n          ...options,\n          signal: controller.signal\n        });\n\n        if (!response.ok) {\n          throw new Error('HTTP error! status: ' + response.status);\n        }\n\n        const result = await response.json();\n        setData(result);\n        setError(null);\n      } catch (err) {\n        if (err.name !== 'AbortError') {\n          setError(err.message);\n        }\n      } finally {\n        setLoading(false);\n      }\n    }\n\n    fetchData();\n\n    return () => controller.abort();\n  }, [url]);\n\n  return { data, loading, error };\n}\n\nexport default useFetch;",
    language: 'javascript',
    createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    author: 'react_dev'
  },
  {
    id: 'sample-6',
    title: 'TCP Echo Server',
    code: "package main\n\nimport (\n\t\"bufio\"\n\t\"fmt\"\n\t\"net\"\n)\n\nfunc handleConnection(conn net.Conn) {\n\tdefer conn.Close()\n\n\treader := bufio.NewReader(conn)\n\tfor {\n\t\tmessage, err := reader.ReadString('\\n')\n\t\tif err != nil {\n\t\t\tfmt.Printf(\"Client disconnected: %v\\n\", err)\n\t\t\treturn\n\t\t}\n\n\t\tfmt.Printf(\"Received: %s\", message)\n\t\t_, err = conn.Write([]byte(\"Echo: \" + message))\n\t\tif err != nil {\n\t\t\tfmt.Printf(\"Write error: %v\\n\", err)\n\t\t\treturn\n\t\t}\n\t}\n}\n\nfunc main() {\n\tlistener, err := net.Listen(\"tcp\", \":8080\")\n\tif err != nil {\n\t\tfmt.Printf(\"Failed to listen: %v\\n\", err)\n\t\treturn\n\t}\n\tdefer listener.Close()\n\n\tfmt.Println(\"Server listening on :8080\")\n\tfor {\n\t\tconn, err := listener.Accept()\n\t\tif err != nil {\n\t\t\tfmt.Printf(\"Connection error: %v\\n\", err)\n\t\t\tcontinue\n\t\t}\n\t\tgo handleConnection(conn)\n\t}\n}",
    language: 'go',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    author: 'go_master'
  },
  {
    id: 'sample-7',
    title: '装饰器模式',
    code: "from functools import wraps\nimport time\n\ndef timer(func):\n    @wraps(func)\n    def wrapper(*args, **kwargs):\n        start_time = time.time()\n        result = func(*args, **kwargs)\n        end_time = time.time()\n        duration = end_time - start_time\n        print(f\"{func.__name__} 执行时间: {duration:.4f}秒\")\n        return result\n    return wrapper\n\ndef retry(max_attempts=3, delay=1):\n    def decorator(func):\n        @wraps(func)\n        def wrapper(*args, **kwargs):\n            for attempt in range(max_attempts):\n                try:\n                    return func(*args, **kwargs)\n                except Exception as e:\n                    if attempt == max_attempts - 1:\n                        raise\n                    time.sleep(delay)\n                    print(f\"重试第 {attempt + 1} 次...\")\n        return wrapper\n    return decorator\n\n@timer\n@retry(max_attempts=3)\ndef fetch_data(url):\n    import requests\n    response = requests.get(url)\n    response.raise_for_status()\n    return response.json()",
    language: 'python',
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    author: 'python_dev'
  },
  {
    id: 'sample-8',
    title: '线程安全的计数器',
    code: "use std::sync::Mutex;\nuse std::thread;\n\nstruct Counter {\n    count: Mutex<i32>,\n}\n\nimpl Counter {\n    fn new() -> Self {\n        Counter {\n            count: Mutex::new(0),\n        }\n    }\n\n    fn increment(&self) {\n        let mut num = self.count.lock().unwrap();\n        *num += 1;\n    }\n\n    fn get_count(&self) -> i32 {\n        *self.count.lock().unwrap()\n    }\n}\n\nfn main() {\n    let counter = Counter::new();\n    let mut handles = vec![];\n\n    for _ in 0..10 {\n        let handle = thread::spawn(|| {\n            for _ in 0..1000 {\n                counter.increment();\n            }\n        });\n        handles.push(handle);\n    }\n\n    for handle in handles {\n        handle.join().unwrap();\n    }\n\n    println!(\"最终计数: {}\", counter.get_count());\n}",
    language: 'rust',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    author: 'rustacean'
  },
  {
    id: 'sample-9',
    title: '事件发射器',
    code: "class EventEmitter {\n  constructor() {\n    this.events = new Map();\n  }\n\n  on(eventName, listener) {\n    if (!this.events.has(eventName)) {\n      this.events.set(eventName, []);\n    }\n    this.events.get(eventName).push(listener);\n    return () => this.off(eventName, listener);\n  }\n\n  off(eventName, listener) {\n    const listeners = this.events.get(eventName);\n    if (listeners) {\n      const index = listeners.indexOf(listener);\n      if (index > -1) {\n        listeners.splice(index, 1);\n      }\n    }\n  }\n\n  emit(eventName) {\n    const listeners = this.events.get(eventName);\n    if (listeners) {\n      const args = Array.prototype.slice.call(arguments, 1);\n      listeners.forEach(function(listener) {\n        try {\n          listener.apply(this, args);\n        } catch (err) {\n          console.error('事件监听器错误 [' + eventName + ']:', err);\n        }\n      }, this);\n    }\n  }\n\n  once(eventName, listener) {\n    const self = this;\n    const wrapper = function() {\n      listener.apply(self, arguments);\n      self.off(eventName, wrapper);\n    };\n    return this.on(eventName, wrapper);\n  }\n}\n\nmodule.exports = EventEmitter;",
    language: 'javascript',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    author: 'node_dev'
  },
  {
    id: 'sample-10',
    title: 'SQL 连接池',
    code: "import java.sql.Connection;\nimport java.sql.SQLException;\nimport java.util.concurrent.ArrayBlockingQueue;\nimport java.util.concurrent.BlockingQueue;\n\npublic class ConnectionPool {\n    private BlockingQueue<Connection> pool;\n    private int maxSize;\n    private String url;\n    private String user;\n    private String password;\n\n    public ConnectionPool(String url, String user, String password, int maxSize) {\n        this.url = url;\n        this.user = user;\n        this.password = password;\n        this.maxSize = maxSize;\n        this.pool = new ArrayBlockingQueue<>(maxSize);\n        initializePool();\n    }\n\n    private void initializePool() {\n        try {\n            for (int i = 0; i < maxSize; i++) {\n                Connection conn = DriverManager.getConnection(url, user, password);\n                pool.offer(conn);\n            }\n        } catch (SQLException e) {\n            throw new RuntimeException(\"初始化连接池失败\", e);\n        }\n    }\n\n    public Connection getConnection() throws InterruptedException {\n        return pool.take();\n    }\n\n    public void releaseConnection(Connection conn) {\n        if (conn != null) {\n            pool.offer(conn);\n        }\n    }\n\n    public void shutdown() throws SQLException {\n        for (Connection conn : pool) {\n            if (!conn.isClosed()) {\n                conn.close();\n            }\n        }\n        pool.clear();\n    }\n}",
    language: 'java',
    createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    author: 'java_pro'
  }
];

async function initSampleData() {
  const count = await snippetsDb.count({});
  if (count === 0) {
    console.log('正在初始化示例数据...');
    const snippetsWithAnalysis = sampleSnippets.map(function(snippet) {
      return {
        id: snippet.id,
        title: snippet.title,
        code: snippet.code,
        language: snippet.language,
        createdAt: snippet.createdAt,
        author: snippet.author,
        analysis: analyzeCode(snippet.code, snippet.language)
      };
    });
    await snippetsDb.insert(snippetsWithAnalysis);
    console.log('已插入 10 条示例代码片段');
  }
}

app.post('/api/submit', async function(req, res) {
  try {
    const code = req.body.code;
    const language = req.body.language;
    const title = req.body.title;
    const author = req.body.author;

    if (!code || !language) {
      return res.status(400).json({ error: '代码和语言是必填项' });
    }

    const analysis = analyzeCode(code, language);
    const snippet = {
      id: 'snippet-' + Date.now(),
      title: title || '未命名代码片段',
      code: code,
      language: language,
      author: author || 'anonymous',
      analysis: analysis,
      createdAt: new Date().toISOString()
    };

    const result = await snippetsDb.insert(snippet);
    res.json({
      success: true,
      snippet: result,
      analysis: analysis
    });
  } catch (error) {
    console.error('提交错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.post('/api/rate', async function(req, res) {
  try {
    const snippetId = req.body.snippetId;
    const rating = req.body.rating;
    const comment = req.body.comment;
    const rater = req.body.rater;

    if (!snippetId || rating === undefined) {
      return res.status(400).json({ error: 'snippetId 和 rating 是必填项' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: '评分必须在 1 到 5 之间' });
    }

    const ratingEntry = {
      id: 'rating-' + Date.now(),
      snippetId: snippetId,
      rating: parseInt(rating),
      comment: comment || '',
      rater: rater || 'anonymous',
      createdAt: new Date().toISOString()
    };

    const result = await ratingsDb.insert(ratingEntry);
    res.json({
      success: true,
      rating: result
    });
  } catch (error) {
    console.error('评分错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/api/code-snippets', async function(req, res) {
  try {
    const language = req.query.language;
    const author = req.query.author;
    const sort = req.query.sort;
    const limit = req.query.limit;
    let query = {};

    if (language) {
      query.language = language;
    }
    if (author) {
      query.author = author;
    }

    let cursor = snippetsDb.find(query);
    
    if (sort === 'oldest') {
      cursor = cursor.sort({ createdAt: 1 });
    } else {
      cursor = cursor.sort({ createdAt: -1 });
    }

    if (limit) {
      cursor = cursor.limit(parseInt(limit));
    }

    const snippets = await cursor.exec();
    
    const snippetsWithRatings = await Promise.all(
      snippets.map(async function(snippet) {
        const ratings = await ratingsDb.find({ snippetId: snippet.id });
        const avgRating = ratings.length > 0
          ? ratings.reduce(function(sum, r) { return sum + r.rating; }, 0) / ratings.length
          : null;
        return {
          id: snippet.id,
          title: snippet.title,
          code: snippet.code,
          language: snippet.language,
          author: snippet.author,
          analysis: snippet.analysis,
          createdAt: snippet.createdAt,
          ratings: ratings.length,
          avgRating: avgRating ? Math.round(avgRating * 10) / 10 : null
        };
      })
    );

    res.json({
      success: true,
      total: snippetsWithRatings.length,
      snippets: snippetsWithRatings
    });
  } catch (error) {
    console.error('获取代码片段错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/api/user-stats', async function(req, res) {
  try {
    const author = req.query.author;

    if (!author) {
      return res.status(400).json({ error: 'author 参数是必填项' });
    }

    const userSnippets = await snippetsDb.find({ author: author });
    
    let totalScore = 0;
    let totalComplexity = 0;
    let totalCommentRate = 0;
    let totalNamingScore = 0;
    let totalLines = 0;

    const languageCount = {};

    for (let i = 0; i < userSnippets.length; i++) {
      const snippet = userSnippets[i];
      if (snippet.analysis) {
        totalScore += snippet.analysis.overallScore || 0;
        totalComplexity += snippet.analysis.cyclomaticComplexity || 0;
        totalCommentRate += snippet.analysis.commentRate || 0;
        totalNamingScore += snippet.analysis.namingStyle || 0;
        totalLines += snippet.analysis.lineCount || 0;
      }
      languageCount[snippet.language] = (languageCount[snippet.language] || 0) + 1;
    }

    const count = userSnippets.length;

    res.json({
      success: true,
      author: author,
      totalSnippets: count,
      totalLines: totalLines,
      avgScore: count > 0 ? Math.round(totalScore / count) : 0,
      avgComplexity: count > 0 ? Math.round(totalComplexity / count) : 0,
      avgCommentRate: count > 0 ? Math.round(totalCommentRate / count) : 0,
      avgNamingScore: count > 0 ? Math.round(totalNamingScore / count) : 0,
      languageDistribution: languageCount
    });
  } catch (error) {
    console.error('获取用户统计错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/api/stats', async function(req, res) {
  try {
    const snippets = await snippetsDb.find({});
    const ratings = await ratingsDb.find({});

    const languageDistribution = {};
    let totalScore = 0;
    let totalComplexity = 0;
    let totalCommentRate = 0;
    let totalNamingScore = 0;
    let totalLines = 0;
    let excellentCount = 0;
    let goodCount = 0;
    let needsWorkCount = 0;

    for (let i = 0; i < snippets.length; i++) {
      const snippet = snippets[i];
      languageDistribution[snippet.language] = (languageDistribution[snippet.language] || 0) + 1;
      
      if (snippet.analysis) {
        totalScore += snippet.analysis.overallScore || 0;
        totalComplexity += snippet.analysis.cyclomaticComplexity || 0;
        totalCommentRate += snippet.analysis.commentRate || 0;
        totalNamingScore += snippet.analysis.namingStyle || 0;
        totalLines += snippet.analysis.lineCount || 0;

        if (snippet.analysis.overallScore >= 80) {
          excellentCount++;
        } else if (snippet.analysis.overallScore >= 60) {
          goodCount++;
        } else {
          needsWorkCount++;
        }
      }
    }

    const count = snippets.length;
    const avgRating = ratings.length > 0
      ? ratings.reduce(function(sum, r) { return sum + r.rating; }, 0) / ratings.length
      : 0;

    const authorSet = new Set();
    for (let i = 0; i < snippets.length; i++) {
      authorSet.add(snippets[i].author);
    }
    const authorCount = authorSet.size;

    res.json({
      success: true,
      totalSnippets: count,
      totalRatings: ratings.length,
      totalAuthors: authorCount,
      totalLines: totalLines,
      avgScore: count > 0 ? Math.round(totalScore / count) : 0,
      avgComplexity: count > 0 ? Math.round(totalComplexity / count) : 0,
      avgCommentRate: count > 0 ? Math.round(totalCommentRate / count) : 0,
      avgNamingScore: count > 0 ? Math.round(totalNamingScore / count) : 0,
      avgRating: Math.round(avgRating * 10) / 10,
      languageDistribution: languageDistribution,
      scoreDistribution: {
        excellent: excellentCount,
        good: goodCount,
        needsWork: needsWorkCount
      }
    });
  } catch (error) {
    console.error('获取统计错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/api/health', function(req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, async function() {
  console.log('服务器运行在 http://localhost:' + PORT);
  await initSampleData();
});

module.exports = app;
