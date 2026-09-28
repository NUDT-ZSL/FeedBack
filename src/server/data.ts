import type { SkillNode, JobRequirement } from './types';

export const skills: SkillNode[] = [
  {
    id: 'html5',
    name: 'HTML5',
    domain: 'frontend',
    proficiency: 0,
    dependencies: [],
    subSkills: ['css3', 'javascript'],
    proficiencyThreshold: 70,
    description: 'HTML5是构建网页的基础标记语言，支持语义化标签、多媒体、Canvas等现代特性。',
    color: '#3b82f6',
    resources: [
      {
        id: 'html5-r1',
        title: 'MDN HTML5 完整指南',
        type: 'article',
        url: 'https://developer.mozilla.org/zh-CN/docs/Web/HTML',
        difficulty: 'beginner'
      },
      {
        id: 'html5-r2',
        title: 'HTML5 从入门到精通',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1pX4y1M7zF',
        duration: '12小时',
        difficulty: 'beginner'
      },
      {
        id: 'html5-r3',
        title: 'HTML5 权威指南',
        type: 'book',
        url: 'https://book.douban.com/subject/24527044/',
        difficulty: 'beginner'
      }
    ]
  },
  {
    id: 'css3',
    name: 'CSS3',
    domain: 'frontend',
    proficiency: 0,
    dependencies: ['html5'],
    subSkills: ['tailwindcss', 'javascript'],
    proficiencyThreshold: 70,
    description: 'CSS3用于控制网页样式，支持动画、渐变、Flexbox、Grid等现代布局特性。',
    color: '#3b82f6',
    resources: [
      {
        id: 'css3-r1',
        title: 'MDN CSS 教程',
        type: 'article',
        url: 'https://developer.mozilla.org/zh-CN/docs/Web/CSS',
        difficulty: 'beginner'
      },
      {
        id: 'css3-r2',
        title: 'CSS Grid 完全指南',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1XE411x7zq',
        duration: '6小时',
        difficulty: 'intermediate'
      },
      {
        id: 'css3-r3',
        title: 'CSS 揭秘',
        type: 'book',
        url: 'https://book.douban.com/subject/26745943/',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    domain: 'frontend',
    proficiency: 0,
    dependencies: ['html5', 'css3'],
    subSkills: ['typescript', 'react', 'vue3', 'webpack', 'vite', 'nodejs'],
    proficiencyThreshold: 75,
    description: 'JavaScript是Web开发的核心编程语言，支持前端交互和后端服务开发。',
    color: '#3b82f6',
    resources: [
      {
        id: 'js-r1',
        title: '现代JavaScript教程',
        type: 'article',
        url: 'https://zh.javascript.info/',
        difficulty: 'beginner'
      },
      {
        id: 'js-r2',
        title: 'JavaScript 高级程序设计',
        type: 'book',
        url: 'https://book.douban.com/subject/35175321/',
        difficulty: 'intermediate'
      },
      {
        id: 'js-r3',
        title: 'ES6 新标准详解',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1tK4y177tp',
        duration: '15小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    domain: 'frontend',
    proficiency: 0,
    dependencies: ['javascript'],
    subSkills: ['react', 'vue3', 'vite'],
    proficiencyThreshold: 70,
    description: 'TypeScript是JavaScript的超集，添加了静态类型检查，提升代码可维护性。',
    color: '#3b82f6',
    resources: [
      {
        id: 'ts-r1',
        title: 'TypeScript 官方文档',
        type: 'article',
        url: 'https://www.typescriptlang.org/docs/',
        difficulty: 'intermediate'
      },
      {
        id: 'ts-r2',
        title: 'TypeScript 从入门到精通',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1a5411w7iS',
        duration: '20小时',
        difficulty: 'intermediate'
      },
      {
        id: 'ts-r3',
        title: '深入理解TypeScript',
        type: 'book',
        url: 'https://book.douban.com/subject/35134660/',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'react',
    name: 'React',
    domain: 'frontend',
    proficiency: 0,
    dependencies: ['javascript', 'typescript'],
    subSkills: ['nextjs'],
    proficiencyThreshold: 75,
    description: 'React是由Facebook开发的声明式UI库，采用组件化和虚拟DOM构建用户界面。',
    color: '#3b82f6',
    resources: [
      {
        id: 'react-r1',
        title: 'React 官方文档',
        type: 'article',
        url: 'https://react.dev/',
        difficulty: 'intermediate'
      },
      {
        id: 'react-r2',
        title: 'React 18 完整教程',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1bG4y1A7tT',
        duration: '30小时',
        difficulty: 'intermediate'
      },
      {
        id: 'react-r3',
        title: 'React 设计原理',
        type: 'book',
        url: 'https://book.douban.com/subject/36147819/',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'vue3',
    name: 'Vue3',
    domain: 'frontend',
    proficiency: 0,
    dependencies: ['javascript', 'typescript'],
    subSkills: [],
    proficiencyThreshold: 75,
    description: 'Vue3是渐进式JavaScript框架，提供Composition API和响应式系统，易于上手且功能强大。',
    color: '#3b82f6',
    resources: [
      {
        id: 'vue3-r1',
        title: 'Vue3 官方文档',
        type: 'article',
        url: 'https://cn.vuejs.org/',
        difficulty: 'intermediate'
      },
      {
        id: 'vue3-r2',
        title: 'Vue3 + TypeScript 实战',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1Za411J72j',
        duration: '25小时',
        difficulty: 'intermediate'
      },
      {
        id: 'vue3-r3',
        title: 'Vue.js 设计与实现',
        type: 'book',
        url: 'https://book.douban.com/subject/35768338/',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'webpack',
    name: 'Webpack',
    domain: 'frontend',
    proficiency: 0,
    dependencies: ['javascript'],
    subSkills: [],
    proficiencyThreshold: 65,
    description: 'Webpack是现代JavaScript应用的静态模块打包工具，支持代码分割、懒加载等优化。',
    color: '#3b82f6',
    resources: [
      {
        id: 'webpack-r1',
        title: 'Webpack 官方文档',
        type: 'article',
        url: 'https://webpack.js.org/concepts/',
        difficulty: 'intermediate'
      },
      {
        id: 'webpack-r2',
        title: 'Webpack5 完全指南',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1mT411P7uV',
        duration: '15小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'vite',
    name: 'Vite',
    domain: 'frontend',
    proficiency: 0,
    dependencies: ['javascript', 'typescript'],
    subSkills: [],
    proficiencyThreshold: 65,
    description: 'Vite是下一代前端构建工具，利用ES模块实现极速冷启动和热更新。',
    color: '#3b82f6',
    resources: [
      {
        id: 'vite-r1',
        title: 'Vite 官方文档',
        type: 'article',
        url: 'https://cn.vitejs.dev/',
        difficulty: 'intermediate'
      },
      {
        id: 'vite-r2',
        title: 'Vite 原理与实战',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1t84y1K7z6',
        duration: '10小时',
        difficulty: 'intermediate'
      },
      {
        id: 'vite-r3',
        title: 'Vite 插件开发指南',
        type: 'article',
        url: 'https://cn.vitejs.dev/guide/api-plugin.html',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    domain: 'frontend',
    proficiency: 0,
    dependencies: ['react'],
    subSkills: [],
    proficiencyThreshold: 70,
    description: 'Next.js是React的全栈框架，支持SSR、SSG、ISR等多种渲染模式，内置路由和API。',
    color: '#3b82f6',
    resources: [
      {
        id: 'nextjs-r1',
        title: 'Next.js 官方文档',
        type: 'article',
        url: 'https://nextjs.org/docs',
        difficulty: 'intermediate'
      },
      {
        id: 'nextjs-r2',
        title: 'Next.js 14 全栈开发',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV18H4y1J7zW',
        duration: '20小时',
        difficulty: 'intermediate'
      },
      {
        id: 'nextjs-r3',
        title: 'Next.js 企业级实战',
        type: 'course',
        url: 'https://www.udemy.com/course/nextjs-enterprise/',
        duration: '30小时',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'tailwindcss',
    name: 'TailwindCSS',
    domain: 'frontend',
    proficiency: 0,
    dependencies: ['css3', 'javascript'],
    subSkills: [],
    proficiencyThreshold: 65,
    description: 'TailwindCSS是实用优先的CSS框架，通过原子化类快速构建现代UI。',
    color: '#3b82f6',
    resources: [
      {
        id: 'tailwind-r1',
        title: 'TailwindCSS 官方文档',
        type: 'article',
        url: 'https://tailwindcss.com/docs',
        difficulty: 'beginner'
      },
      {
        id: 'tailwind-r2',
        title: 'TailwindCSS 实战教程',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1D24y1A7mH',
        duration: '8小时',
        difficulty: 'beginner'
      }
    ]
  },
  {
    id: 'nodejs',
    name: 'Node.js',
    domain: 'backend',
    proficiency: 0,
    dependencies: ['javascript'],
    subSkills: ['express', 'graphql'],
    proficiencyThreshold: 75,
    description: 'Node.js是基于V8引擎的JavaScript运行时，用于构建高性能的后端服务。',
    color: '#22c55e',
    resources: [
      {
        id: 'node-r1',
        title: 'Node.js 官方文档',
        type: 'article',
        url: 'https://nodejs.org/docs/latest/api/',
        difficulty: 'intermediate'
      },
      {
        id: 'node-r2',
        title: 'Node.js 零基础到进阶',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1gM411W7ex',
        duration: '25小时',
        difficulty: 'intermediate'
      },
      {
        id: 'node-r3',
        title: '深入浅出 Node.js',
        type: 'book',
        url: 'https://book.douban.com/subject/25768396/',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'express',
    name: 'Express',
    domain: 'backend',
    proficiency: 0,
    dependencies: ['nodejs', 'restapi'],
    subSkills: [],
    proficiencyThreshold: 70,
    description: 'Express是Node.js的轻量级Web框架，提供路由、中间件等核心功能。',
    color: '#22c55e',
    resources: [
      {
        id: 'express-r1',
        title: 'Express 官方文档',
        type: 'article',
        url: 'https://expressjs.com/',
        difficulty: 'intermediate'
      },
      {
        id: 'express-r2',
        title: 'Express 4.x 实战教程',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1fE411x7qE',
        duration: '15小时',
        difficulty: 'intermediate'
      },
      {
        id: 'express-r3',
        title: 'Express REST API 开发',
        type: 'course',
        url: 'https://www.udemy.com/course/nodejs-express-masterclass/',
        duration: '20小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'python',
    name: 'Python',
    domain: 'backend',
    proficiency: 0,
    dependencies: [],
    subSkills: ['django', 'restapi'],
    proficiencyThreshold: 75,
    description: 'Python是简洁优雅的通用编程语言，广泛应用于Web开发、数据科学和人工智能。',
    color: '#22c55e',
    resources: [
      {
        id: 'python-r1',
        title: 'Python 官方教程',
        type: 'article',
        url: 'https://docs.python.org/zh-cn/3/tutorial/',
        difficulty: 'beginner'
      },
      {
        id: 'python-r2',
        title: 'Python 编程从入门到实践',
        type: 'book',
        url: 'https://book.douban.com/subject/35196328/',
        difficulty: 'beginner'
      },
      {
        id: 'python-r3',
        title: 'Python 全栈开发',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1wD4y1o7AS',
        duration: '40小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'django',
    name: 'Django',
    domain: 'backend',
    proficiency: 0,
    dependencies: ['python', 'restapi'],
    subSkills: [],
    proficiencyThreshold: 70,
    description: 'Django是Python的高级Web框架，遵循MTV架构，内置ORM、认证、管理后台等功能。',
    color: '#22c55e',
    resources: [
      {
        id: 'django-r1',
        title: 'Django 官方文档',
        type: 'article',
        url: 'https://docs.djangoproject.com/zh-hans/',
        difficulty: 'intermediate'
      },
      {
        id: 'django-r2',
        title: 'Django 从入门到精通',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1uJ411k7wy',
        duration: '30小时',
        difficulty: 'intermediate'
      },
      {
        id: 'django-r3',
        title: 'Django REST Framework 实战',
        type: 'course',
        url: 'https://www.udemy.com/course/django-rest-framework/',
        duration: '25小时',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'java',
    name: 'Java',
    domain: 'backend',
    proficiency: 0,
    dependencies: [],
    subSkills: ['springboot', 'restapi'],
    proficiencyThreshold: 75,
    description: 'Java是企业级开发首选语言，具有强类型、跨平台、高可靠性等特点。',
    color: '#22c55e',
    resources: [
      {
        id: 'java-r1',
        title: 'Java 官方教程',
        type: 'article',
        url: 'https://docs.oracle.com/en/java/javase/17/docs/api/index.html',
        difficulty: 'beginner'
      },
      {
        id: 'java-r2',
        title: 'Java 核心技术',
        type: 'book',
        url: 'https://book.douban.com/subject/34898998/',
        difficulty: 'beginner'
      },
      {
        id: 'java-r3',
        title: 'Java 从零基础到就业',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1zT4y1P7g3',
        duration: '60小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'springboot',
    name: 'Spring Boot',
    domain: 'backend',
    proficiency: 0,
    dependencies: ['java', 'restapi'],
    subSkills: [],
    proficiencyThreshold: 75,
    description: 'Spring Boot简化了Spring应用的配置和部署，是Java企业级开发的事实标准。',
    color: '#22c55e',
    resources: [
      {
        id: 'spring-r1',
        title: 'Spring Boot 官方文档',
        type: 'article',
        url: 'https://spring.io/projects/spring-boot',
        difficulty: 'intermediate'
      },
      {
        id: 'spring-r2',
        title: 'Spring Boot 实战教程',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1Fw411K7is',
        duration: '40小时',
        difficulty: 'intermediate'
      },
      {
        id: 'spring-r3',
        title: 'Spring Boot 源码深度解析',
        type: 'book',
        url: 'https://book.douban.com/subject/30459530/',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'go',
    name: 'Go',
    domain: 'backend',
    proficiency: 0,
    dependencies: [],
    subSkills: ['gin', 'restapi'],
    proficiencyThreshold: 70,
    description: 'Go是Google开发的静态类型语言，以简洁、高效、并发能力强著称，适合云原生开发。',
    color: '#22c55e',
    resources: [
      {
        id: 'go-r1',
        title: 'Go 语言圣经',
        type: 'article',
        url: 'https://gopl-zh.github.io/',
        difficulty: 'beginner'
      },
      {
        id: 'go-r2',
        title: 'Go 语言实战',
        type: 'book',
        url: 'https://book.douban.com/subject/27015617/',
        difficulty: 'intermediate'
      },
      {
        id: 'go-r3',
        title: 'Go 从入门到精通',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1sC4y1B7PM',
        duration: '35小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'gin',
    name: 'Gin',
    domain: 'backend',
    proficiency: 0,
    dependencies: ['go', 'restapi'],
    subSkills: [],
    proficiencyThreshold: 65,
    description: 'Gin是Go语言的高性能Web框架，基于Radix树路由，提供中间件、参数绑定等功能。',
    color: '#22c55e',
    resources: [
      {
        id: 'gin-r1',
        title: 'Gin 官方文档',
        type: 'article',
        url: 'https://gin-gonic.com/zh-cn/docs/',
        difficulty: 'intermediate'
      },
      {
        id: 'gin-r2',
        title: 'Gin 框架实战教程',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1qJ411w7iX',
        duration: '20小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'restapi',
    name: 'REST API',
    domain: 'backend',
    proficiency: 0,
    dependencies: [],
    subSkills: ['express', 'django', 'springboot', 'gin', 'graphql'],
    proficiencyThreshold: 70,
    description: 'REST是一种软件架构风格，定义了构建Web服务的约束和最佳实践。',
    color: '#22c55e',
    resources: [
      {
        id: 'rest-r1',
        title: 'REST API 设计指南',
        type: 'article',
        url: 'https://www.rfc-editor.org/rfc/rfc7231',
        difficulty: 'intermediate'
      },
      {
        id: 'rest-r2',
        title: 'RESTful API 最佳实践',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1zE411j7q1',
        duration: '10小时',
        difficulty: 'intermediate'
      },
      {
        id: 'rest-r3',
        title: 'Web API 设计',
        type: 'book',
        url: 'https://book.douban.com/subject/24756770/',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'graphql',
    name: 'GraphQL',
    domain: 'backend',
    proficiency: 0,
    dependencies: ['restapi', 'nodejs'],
    subSkills: [],
    proficiencyThreshold: 70,
    description: 'GraphQL是一种API查询语言，允许客户端精确请求所需数据，替代传统REST的多个端点。',
    color: '#22c55e',
    resources: [
      {
        id: 'graphql-r1',
        title: 'GraphQL 官方文档',
        type: 'article',
        url: 'https://graphql.org/learn/',
        difficulty: 'intermediate'
      },
      {
        id: 'graphql-r2',
        title: 'GraphQL 从入门到实战',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1N4411T7g6',
        duration: '15小时',
        difficulty: 'intermediate'
      },
      {
        id: 'graphql-r3',
        title: 'Apollo Server 实战',
        type: 'course',
        url: 'https://www.udemy.com/course/graphql-apollo-server/',
        duration: '20小时',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'mysql',
    name: 'MySQL',
    domain: 'database',
    proficiency: 0,
    dependencies: [],
    subSkills: ['postgresql'],
    proficiencyThreshold: 75,
    description: 'MySQL是最流行的开源关系型数据库，广泛应用于Web应用的数据存储。',
    color: '#f97316',
    resources: [
      {
        id: 'mysql-r1',
        title: 'MySQL 官方文档',
        type: 'article',
        url: 'https://dev.mysql.com/doc/',
        difficulty: 'beginner'
      },
      {
        id: 'mysql-r2',
        title: 'MySQL 必知必会',
        type: 'book',
        url: 'https://book.douban.com/subject/3354490/',
        difficulty: 'beginner'
      },
      {
        id: 'mysql-r3',
        title: 'MySQL 从入门到精通',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1UE41147KC',
        duration: '30小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    domain: 'database',
    proficiency: 0,
    dependencies: ['mysql'],
    subSkills: [],
    proficiencyThreshold: 70,
    description: 'PostgreSQL是功能强大的开源关系型数据库，支持复杂查询、JSON、全文搜索等高级特性。',
    color: '#f97316',
    resources: [
      {
        id: 'pg-r1',
        title: 'PostgreSQL 官方文档',
        type: 'article',
        url: 'https://www.postgresql.org/docs/',
        difficulty: 'intermediate'
      },
      {
        id: 'pg-r2',
        title: 'PostgreSQL 实战教程',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1nJ411M7ZJ',
        duration: '25小时',
        difficulty: 'intermediate'
      },
      {
        id: 'pg-r3',
        title: 'PostgreSQL 技术内幕',
        type: 'book',
        url: 'https://book.douban.com/subject/30420898/',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    domain: 'database',
    proficiency: 0,
    dependencies: [],
    subSkills: ['elasticsearch'],
    proficiencyThreshold: 70,
    description: 'MongoDB是流行的文档型NoSQL数据库，以灵活的Schema和高性能著称。',
    color: '#f97316',
    resources: [
      {
        id: 'mongo-r1',
        title: 'MongoDB 官方文档',
        type: 'article',
        url: 'https://www.mongodb.com/docs/',
        difficulty: 'beginner'
      },
      {
        id: 'mongo-r2',
        title: 'MongoDB 实战教程',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1xz4y1X7cW',
        duration: '20小时',
        difficulty: 'intermediate'
      },
      {
        id: 'mongo-r3',
        title: 'MongoDB 权威指南',
        type: 'book',
        url: 'https://book.douban.com/subject/26678805/',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'redis',
    name: 'Redis',
    domain: 'database',
    proficiency: 0,
    dependencies: [],
    subSkills: ['elasticsearch'],
    proficiencyThreshold: 70,
    description: 'Redis是高性能的内存键值存储系统，常用于缓存、会话管理和消息队列。',
    color: '#f97316',
    resources: [
      {
        id: 'redis-r1',
        title: 'Redis 官方文档',
        type: 'article',
        url: 'https://redis.io/docs/',
        difficulty: 'intermediate'
      },
      {
        id: 'redis-r2',
        title: 'Redis 设计与实现',
        type: 'book',
        url: 'https://book.douban.com/subject/25900156/',
        difficulty: 'advanced'
      },
      {
        id: 'redis-r3',
        title: 'Redis 实战教程',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV15J4112785',
        duration: '18小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'elasticsearch',
    name: 'Elasticsearch',
    domain: 'database',
    proficiency: 0,
    dependencies: ['mongodb', 'redis'],
    subSkills: [],
    proficiencyThreshold: 65,
    description: 'Elasticsearch是分布式搜索引擎，支持全文搜索、日志分析和数据可视化。',
    color: '#f97316',
    resources: [
      {
        id: 'es-r1',
        title: 'Elasticsearch 官方文档',
        type: 'article',
        url: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html',
        difficulty: 'advanced'
      },
      {
        id: 'es-r2',
        title: 'Elasticsearch 实战',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1iJ411x73R',
        duration: '22小时',
        difficulty: 'advanced'
      },
      {
        id: 'es-r3',
        title: 'Elasticsearch 权威指南',
        type: 'book',
        url: 'https://book.douban.com/subject/26975482/',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'docker',
    name: 'Docker',
    domain: 'devops',
    proficiency: 0,
    dependencies: [],
    subSkills: ['kubernetes', 'gitlabci', 'aws', 'nginx'],
    proficiencyThreshold: 75,
    description: 'Docker是容器化技术的事实标准，实现应用的快速部署、可移植性和资源隔离。',
    color: '#a855f7',
    resources: [
      {
        id: 'docker-r1',
        title: 'Docker 官方文档',
        type: 'article',
        url: 'https://docs.docker.com/',
        difficulty: 'beginner'
      },
      {
        id: 'docker-r2',
        title: 'Docker 从入门到实践',
        type: 'book',
        url: 'https://yeasy.gitbook.io/docker_practice/',
        difficulty: 'beginner'
      },
      {
        id: 'docker-r3',
        title: 'Docker 实战教程',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1og4y1q7M4',
        duration: '20小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    domain: 'devops',
    proficiency: 0,
    dependencies: ['docker'],
    subSkills: [],
    proficiencyThreshold: 75,
    description: 'Kubernetes是容器编排平台，用于自动化部署、扩展和管理容器化应用。',
    color: '#a855f7',
    resources: [
      {
        id: 'k8s-r1',
        title: 'Kubernetes 官方文档',
        type: 'article',
        url: 'https://kubernetes.io/zh-cn/docs/',
        difficulty: 'advanced'
      },
      {
        id: 'k8s-r2',
        title: 'Kubernetes 实战教程',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1wE411J7fE',
        duration: '30小时',
        difficulty: 'advanced'
      },
      {
        id: 'k8s-r3',
        title: 'Kubernetes 权威指南',
        type: 'book',
        url: 'https://book.douban.com/subject/35463618/',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'gitlabci',
    name: 'GitLab CI',
    domain: 'devops',
    proficiency: 0,
    dependencies: ['docker'],
    subSkills: [],
    proficiencyThreshold: 65,
    description: 'GitLab CI是持续集成/持续部署工具，实现自动化构建、测试和部署流程。',
    color: '#a855f7',
    resources: [
      {
        id: 'gitlab-r1',
        title: 'GitLab CI 官方文档',
        type: 'article',
        url: 'https://docs.gitlab.com/ee/ci/',
        difficulty: 'intermediate'
      },
      {
        id: 'gitlab-r2',
        title: 'GitLab CI/CD 实战',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1eK4y1A7mG',
        duration: '15小时',
        difficulty: 'intermediate'
      }
    ]
  },
  {
    id: 'aws',
    name: 'AWS',
    domain: 'devops',
    proficiency: 0,
    dependencies: ['docker'],
    subSkills: [],
    proficiencyThreshold: 70,
    description: 'AWS是全球最大的云计算平台，提供计算、存储、数据库等200+云服务。',
    color: '#a855f7',
    resources: [
      {
        id: 'aws-r1',
        title: 'AWS 官方文档',
        type: 'article',
        url: 'https://docs.aws.amazon.com/',
        difficulty: 'intermediate'
      },
      {
        id: 'aws-r2',
        title: 'AWS 云从业者认证',
        type: 'course',
        url: 'https://www.udemy.com/course/aws-certified-cloud-practitioner/',
        duration: '15小时',
        difficulty: 'beginner'
      },
      {
        id: 'aws-r3',
        title: 'AWS 解决方案架构师',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1iJ411x73R',
        duration: '40小时',
        difficulty: 'advanced'
      }
    ]
  },
  {
    id: 'nginx',
    name: 'Nginx',
    domain: 'devops',
    proficiency: 0,
    dependencies: ['docker'],
    subSkills: [],
    proficiencyThreshold: 70,
    description: 'Nginx是高性能的HTTP和反向代理服务器，常用于负载均衡、静态文件服务。',
    color: '#a855f7',
    resources: [
      {
        id: 'nginx-r1',
        title: 'Nginx 官方文档',
        type: 'article',
        url: 'https://nginx.org/en/docs/',
        difficulty: 'intermediate'
      },
      {
        id: 'nginx-r2',
        title: 'Nginx 完全指南',
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1KJ411j7tM',
        duration: '12小时',
        difficulty: 'intermediate'
      },
      {
        id: 'nginx-r3',
        title: '深入理解 Nginx',
        type: 'book',
        url: 'https://book.douban.com/subject/27047420/',
        difficulty: 'advanced'
      }
    ]
  }
];

export const jobs: JobRequirement[] = [
  {
    id: 'fullstack',
    title: '全栈工程师',
    description: '负责Web应用的前后端开发，需要掌握完整的技术栈，从用户界面到后端服务和数据库。',
    requiredSkills: [
      { skillId: 'html5', minProficiency: 70 },
      { skillId: 'css3', minProficiency: 70 },
      { skillId: 'javascript', minProficiency: 75 },
      { skillId: 'typescript', minProficiency: 70 },
      { skillId: 'react', minProficiency: 75 },
      { skillId: 'nodejs', minProficiency: 75 },
      { skillId: 'express', minProficiency: 70 },
      { skillId: 'mysql', minProficiency: 70 },
      { skillId: 'mongodb', minProficiency: 65 },
      { skillId: 'gitlabci', minProficiency: 60 }
    ],
    preferredSkills: ['nextjs', 'redis', 'docker', 'graphql'],
    salaryRange: '20K-45K'
  },
  {
    id: 'devops',
    title: 'DevOps专家',
    description: '负责构建和维护自动化部署流程、监控系统和云基础设施，确保系统的高可用性和可扩展性。',
    requiredSkills: [
      { skillId: 'docker', minProficiency: 80 },
      { skillId: 'kubernetes', minProficiency: 75 },
      { skillId: 'gitlabci', minProficiency: 75 },
      { skillId: 'aws', minProficiency: 75 },
      { skillId: 'nginx', minProficiency: 70 },
      { skillId: 'python', minProficiency: 70 },
      { skillId: 'mysql', minProficiency: 65 },
      { skillId: 'redis', minProficiency: 70 },
      { skillId: 'mongodb', minProficiency: 65 },
      { skillId: 'elasticsearch', minProficiency: 65 }
    ],
    preferredSkills: ['terraform', 'prometheus', 'grafana', 'jenkins'],
    salaryRange: '25K-50K'
  },
  {
    id: 'frontend-architect',
    title: '前端架构师',
    description: '负责前端技术选型、架构设计和性能优化，制定团队开发规范，提升团队开发效率。',
    requiredSkills: [
      { skillId: 'html5', minProficiency: 80 },
      { skillId: 'css3', minProficiency: 80 },
      { skillId: 'javascript', minProficiency: 85 },
      { skillId: 'typescript', minProficiency: 80 },
      { skillId: 'react', minProficiency: 85 },
      { skillId: 'vue3', minProficiency: 75 },
      { skillId: 'webpack', minProficiency: 75 },
      { skillId: 'vite', minProficiency: 75 },
      { skillId: 'nextjs', minProficiency: 75 },
      { skillId: 'tailwindcss', minProficiency: 70 }
    ],
    preferredSkills: ['graphql', 'nodejs', 'microfrontend', 'webrtc'],
    salaryRange: '30K-60K'
  },
  {
    id: 'backend-engineer',
    title: '后端工程师',
    description: '负责后端服务的设计、开发和维护，处理业务逻辑、数据存储和系统性能优化。',
    requiredSkills: [
      { skillId: 'java', minProficiency: 80 },
      { skillId: 'springboot', minProficiency: 80 },
      { skillId: 'restapi', minProficiency: 75 },
      { skillId: 'mysql', minProficiency: 80 },
      { skillId: 'redis', minProficiency: 75 },
      { skillId: 'mongodb', minProficiency: 70 },
      { skillId: 'docker', minProficiency: 70 },
      { skillId: 'gitlabci', minProficiency: 65 },
      { skillId: 'nginx', minProficiency: 65 },
      { skillId: 'graphql', minProficiency: 65 }
    ],
    preferredSkills: ['go', 'gin', 'kubernetes', 'elasticsearch'],
    salaryRange: '22K-45K'
  }
];

export const getSkillById = (id: string): SkillNode | undefined => {
  return skills.find(skill => skill.id === id);
};

export const getJobById = (id: string): JobRequirement | undefined => {
  return jobs.find(job => job.id === id);
};

export const getSkillsByDomain = (domain: string): SkillNode[] => {
  return skills.filter(skill => skill.domain === domain);
};
