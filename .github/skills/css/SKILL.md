---
name: css
description: '编写与整理 CSS / styled-components 样式。Use when: 新增或修改样式、调整布局、编写 styled-components、重构 CSS。'
---

# CSS 编写规范

## 何时使用

- 新增或修改 CSS / styled-components 样式
- 调整组件布局
- 重构样式代码

## 核心原则

### 1. 不写无实际作用的样式

- 不要写“兜底”或“暂时没有实际作用”的属性。
- 每个属性都应当有明确的当前用途；如果只是为了“以防万一”，则不要写。

### 2. 属性顺序

总体顺序满足两条规则：

1. **从外到内**
   - 先写作为子元素与父元素布局相关的属性。
   - 再写自身布局相关的属性。
   - 最后写其他属性以及嵌套子元素的样式（需要时）。
2. **从重要到次要**
   - 先写对整体效果有明显影响的属性。
   - 再写装饰性、相对次要的属性。

#### 推荐顺序示例

```
/* 1. 与父元素布局相关 */
position / flex / flex-grow / flex-shrink / align-self / justify-self / grid-area / order
margin

/* 2. 自身布局相关 */
display
flex-direction / flex-wrap / align-items / justify-content / gap
width / height / min-width / min-height / max-width / max-height
box-sizing
padding

/* 3. 定位与层叠 */
position: absolute / fixed / sticky / relative
top / right / bottom / left
z-index
overflow / overflow-x / overflow-y

/* 4. 盒模型细节 */
border / border-radius / outline / box-shadow
background / color / opacity

/* 5. 文本与字体 */
font-size / font-weight / line-height / text-align / white-space / text-overflow

/* 6. 变换与动画 */
transform / transition / animation

/* 7. 嵌套子元素样式（需要时） */
${Child} {
  ...
}
```

> 以上顺序是参考，不是强制逐条检查清单。实际编写时按“从外到内、从重要到次要”判断即可。

### 3. 父子布局样式由父元素负责

对于通用或会在文件外被复用的子元素，其与父元素布局相关的样式应由父元素所在位置编写。

#### styled-components 中的两种写法

**写法一：父元素中嵌套选择**

```tsx
const Parent = styled.div`
  display: flex;

  ${Child} {
    flex: 1;
  }
`;
```

**写法二：在父元素附近扩展子元素**

```tsx
const Child = styled(Child_)`
  flex: 1;
`;
```

- 不要把这种“父级上下文相关”的样式写进子元素本身的默认样式里。
- 子元素本身只保留其通用、可复用的样式。

## 注意事项

- 优先使用项目已有的 CSS 变量 / theme token，避免硬编码颜色、间距等值。
- 保持选择器简单，避免过度嵌套。
- 删除已失效或重复的样式，而不是注释保留。
