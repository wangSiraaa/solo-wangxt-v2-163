# 透视标尺工作室（Perspective Ruler Studio）

纯前端的一点 / 两点 / 三点透视绘图工具：先建立透视标尺，二维笔画再按消失点方向
吸附；消失点允许在画布外，平行于画面的方向以**无穷远点**处理。

- **React + TypeScript**：图层、工具、开关与工程状态（`src/state`、`src/components`）
- **Konva（react-konva）**：二维笔画编辑与标尺叠加（`src/components/EditorStage.tsx`）
- **Three.js**：可选参考盒，相机由标尺参数反推，棱边对齐三个消失点（`ReferenceBoxLayer.tsx`）
- **mathjs**：齐次叉积（连线/交点）、矩阵旋转、点积与投影
- **IndexedDB**：工程自动保存 / 启动恢复，**无后端**（`src/lib/storage/idb.ts`）

## 关键几何决策

### 1. 齐次坐标表示消失点（`src/lib/geometry/homogeneous.ts`）

VP 一律用 `[X, Y, W]`：

- `W ≠ 0`：有限 VP，归一化为 `(X/W, Y/W)`，可以在画布外极远处（测试覆盖 1e7 像素量级）；
- `W = 0`：**无穷远点**，表示平行于画面的方向（一点透视的水平/竖直、两点透视的竖直）。

两线交点用叉积 `l1 × l2` 计算，平行线自然得到 `W=0`。`toEuclidean()` 对无穷远点
**直接抛错**，从类型约定上防止任何代码把极远/无穷远 VP 截到画布边缘放假点；无穷远
情形必须走 `toDirection()` 取方向，UI 与导出画的是双向箭头，不是边缘上的圆点。

退化输入显式报错：重合直线、重合点（叉积为零）不产生 NaN。

### 2. 相机变化 ≠ 画面裁切（`src/lib/viewport.ts`）

- **相机**（`Camera`：scale + offset）：滚轮缩放 / 平移的视口观察变换，只改一个外层
  Konva `Group`，不触碰任何文档数据；`zoomAt` 以鼠标为不动点。
- **裁切**（`CropRect`，文档坐标）：只影响导出区域与屏幕上的遮罩，与相机完全独立。
  两者各有独立状态与测试（`viewport.test.ts`）。

### 3. 笔画同时保留原始与约束版本（`src/lib/geometry/snap.ts`）

`Stroke` 持久化保存：

- `raw: Point2[]`：原始采样点，**永不修改**（有测试锁定）；
- `axes: (AxisId | null)[]`：逐段轴归属（容差内最佳轴，否则自由段）。

约束点从不存盘、不进 state，由 `constrainStroke(raw, axes, ruler)` 用 `useMemo` 派生：

- **链式垂足投影**：第 i 段的约束线过第 i 个*已约束*点并朝向 VP，折线首尾相接无裂缝；
- 自由段透传 raw，并在其后重新起锚；
- 有限 VP 的方向是**有向**的：背离 VP 的共线段不会误吸；无穷远 VP 按双向平行匹配。

关闭吸附只是切换 Konva 显示 raw；重新打开，约束点照样从 raw 派生——不丢笔画
（`store.test.ts` 用前后 JSON 快照锁定该行为）。

### 4. 标尺由真实针孔相机生成（`src/lib/perspective/camera3d.ts`）

`rulerFromRotation(kind, {pan, tilt}, focal, principal)` 保证三个 VP 对应互相垂直的
世界方向，VP 坐标 = `principal + f·(m0,m1)/m2`，`m2=0` 时落到无穷远。
标尺同时保存 `rotation`，Three.js 参考盒直接用同一组 pan/tilt/focal/principal 构造
相机（自定义带主点偏移的投影矩阵），缩放/平移视口后仍与 Konva 标尺像素对齐。

## 验证场景

预设面板内置（`src/lib/perspective/rulers.ts`）：

- **高位地平线**：一点（地平线 92%）、两点（地平线 90%）；
- **极端透视**：仰视 / 俯视三点，长焦 f=3.2·边长，竖直 VP 远在画框数千像素之外
  （测试断言其在画布边界之外且有限、不共线）；
- **退化共线**：三点 VP 共线（齐次行列式 ≈ 0）会被 `validateRuler` 检出并在面板警告；
  零长段、重合点/线、相机后方投影、擦角点的零长引导线均有测试。

`RulerAdjustPanel` 的 yaw 滑杆跨过使 VP 趋于无穷远的角度时，`W` 自然趋零，UI 不截边。

## 分层导出（`src/lib/export/exportLayers.ts`）

一次导出产出三张同尺寸透明 PNG：

1. **画稿层（约束后）** / 画稿层（原始 raw）；
2. **标尺层**：三轴引导线、地平线、VP 标记 / 无穷远方向箭头；
3. **合并层**：可选「按轴着色」（每段染成其归属轴颜色）。

引导线几何抽在 `src/lib/geometry/guides.ts`，Konva 显示与 PNG 导出共用同一套纯函数，
所以"视觉上对齐"不是唯一保证——`guides.test.ts` 直接检验每条引导线所在直线通过 VP
（sin 夹角 < 1e-7）、无穷远轴的引导线严格平行、出界 VP 的 `inside=false`。

裁切只平移裁剪导出上下文，不修改任何笔画/标尺数据。

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 47 个几何/状态测试（vitest）
npm run build      # 类型检查 + 生产构建
```

操作：画笔绘制（默认吸附）· Shift/中键拖拽或"平移"工具平移 · 滚轮缩放（VP 空间也可
到达）· "裁切"工具拖框 · 勾选 Three.js 参考盒核对盒棱与消失点。

## 目录

```
src/
  types.ts                     共享数据类型（Ruler/Stroke/Camera/Project，齐次 VP）
  lib/
    geometry/homogeneous.ts    齐次点线、交点、无穷远判定、Liang–Barsky 裁剪
    geometry/snap.ts           段分类 + 链式约束投影
    geometry/guides.ts         引导线/地平线/VP 标记纯几何（显示与导出共用）
    perspective/camera3d.ts    旋转→VP、投影、Three 相机同步
    perspective/rulers.ts      预设、地平线、退化共线检测、合法性校验
    storage/idb.ts             IndexedDB 增删查改
    export/exportLayers.ts     画稿/标尺/合并三层 PNG 导出
    viewport.ts                相机仿射变换 + 裁切（互相独立）
  state/store.tsx              reducer、raw/约束派生、自动保存、启动恢复
  components/                  EditorStage(Konva) / ReferenceBoxLayer(Three) / 面板
```
