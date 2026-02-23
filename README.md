# map3d-react-component-workspace

这个仓库包含两个部分：

- `map3d-react/`：可复用的 `Map3D` React 组件库
- `map3d-demo/`：验收与功能演示页面（包含本地 geojson 下钻示例）

## 快速开始（整仓库）

```bash
npm run setup
npm run demo
```

说明：

- `npm run setup`：安装组件库与 demo 依赖
- `npm run demo`：先构建组件库，再启动 demo

## 常用脚本（根目录）

- `npm run typecheck`：检查组件库 + demo 类型
- `npm run build`：构建组件库 + demo
- `npm run demo:build`：先构建组件库，再构建 demo

## 不发布 npm 的使用方式

如果不发 npm，只通过 GitHub/GitLab 交付，建议按下面方式使用：

1. 克隆整个仓库
2. 在根目录执行 `npm run setup`
3. 用 `npm run demo` 验收

组件也支持本地文件依赖方式接入其他项目：

```json
{
  "dependencies": {
    "@xwvike/map3d-react": "file:../map3d-react"
  }
}
```

## 目录结构

```text
.
├── map3d-react/   # 组件库源码与打包配置
└── map3d-demo/    # 演示页面与本地 geojson 数据
```
