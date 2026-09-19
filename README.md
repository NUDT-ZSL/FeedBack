# 多角色授权快照工作台

零外部依赖的离线全栈应用。Node 内置 HTTP 提供 API、SSE 实时推送和原生浏览器界面。

## 启动

```powershell
npm start
```

随后打开 http://localhost:3000 。

## 验收测试

```powershell
npm test
```

测试覆盖重复成员、未知角色、范围缺失边、继承成环、冲突保留、权限收窄后的页面失效和旧操作待处理。
