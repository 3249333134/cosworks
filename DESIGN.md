---
name: 入戏局
description: 黑盒剧场中的单一发光操作面
colors:
  stage-ink: "#18191F"
  surface: "#22232A"
  raised: "#2B2C34"
  warm-white: "#F7F5EF"
  muted: "#AAA9B2"
  action-gold: "#EFB511"
  danger: "#FF6B61"
  success: "#53C58A"
typography:
  display:
    fontFamily: "ui-sans-serif, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "clamp(2.15rem, 8vw, 4.8rem)"
    fontWeight: 800
    lineHeight: 1.28
    letterSpacing: "-0.03em"
  body:
    fontFamily: "ui-sans-serif, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "12px"
  primary: "14px"
  sheet: "16px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action-gold}"
    textColor: "{colors.stage-ink}"
    rounded: "{rounded.primary}"
    height: "56px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.warm-white}"
    rounded: "{rounded.control}"
    height: "52px"
---

# Design System: 入戏局

## Overview

**Creative North Star: "黑盒剧场"**

界面像熄灯后的剧场：深墨背景退出视线，暖白任务成为舞台中心，金色只在真正需要行动时亮起。信息密度刻意保持低，让玩家看一眼就能放下手机回到现场互动。

主持能力属于舞台边缘的工具层，而不是另一个管理后台。关闭抽屉后，主持人立刻回到与所有玩家相同的个人任务面。

房间页允许比游戏舞台更高的信息密度：当前游戏总览置于完整聚会编排之前。主持人看到低干扰的控场与编辑入口，参与者看到相同结构的只读版本；任何未揭晓的公平性秘密都不进入总览数据。

“不要做”首次词牌和每张新词牌以纯黑全屏倒数五秒；同一浏览器返回同一场次的同一张词牌时直接展示。词牌页只保留佩戴提示、词汇、使用计数、抽下一张和三条玩法规则。

“女巫的毒药”在埋设和排查阶段始终使用玩家自己的棋盘视图。公共同步只更新已埋设和已完成人数；安全格、毒药格、埋设者与惩罚只在操作本人的私密快照中出现。

**Key Characteristics:**

- 深墨全屏舞台与大面积负空间
- 中央单一任务焦点
- 底部拇指可达的唯一主操作
- 菱形线框作为游戏标记
- 控场、规则和换题使用底部抽屉

## Colors

单一暖金强调色与中性深色阶构成克制的夜场色盘。

### Primary

- **行动金**：只用于当前屏幕最重要的动作、已选状态和少量主持标记。

### Neutral

- **舞台墨**：全屏背景，保持现场视觉安静。
- **面板黑**：输入、次级容器与抽屉内动作区。
- **暖白**：主要内容与任务字，避免纯白的刺眼感。
- **烟灰**：说明、状态和低优先级操作。

**The One Light Rule.** 每个玩家舞台只允许一个实心金色主按钮；次级动作必须退为文字、描边或抽屉内容。

## Typography

**Display Font:** 系统中文无衬线体
**Body Font:** 系统中文无衬线体

**Character:** 粗重、短句、强对比。字形保持直接清楚，不使用装饰字体牺牲现场扫读速度。

### Hierarchy

- **Display**（800，流体字号，1.28）：个人任务、房间码与入口问题。
- **Title**（700，约 1.15–1.35rem）：区域名、抽屉标题与游戏名。
- **Body**（400，1rem，1.6）：规则、提示和辅助说明。
- **Label**（400–700，约 .8–.95rem）：连接状态、字段名和按钮短文案。

**The One Breath Rule.** 游戏任务优先保持在两到三行内，内容需能在一次呼吸中读完。

## Layout

玩家游戏页固定采用 `100dvh` 三段结构：顶部状态、中央任务、底部主操作。移动端两侧留白以 20–24px 为主，内容容器在平板与桌面限制宽度。375、430、768、1024px 和手机横屏均保持无横向溢出；安全区由 `env(safe-area-inset-*)` 吸收。

## Elevation & Depth

默认不使用卡片阴影，通过相邻深色阶和细边框建立层级。只有底部抽屉使用向上的深色阴影，明确它临时覆盖舞台。

**The Flat Stage Rule.** 常驻内容保持平面；阴影只属于模态抽屉，不用于装饰普通信息。

## Shapes

常规控件使用 12–16px 柔和圆角，主按钮为 14px 圆角长条。游戏符号使用旋转 45 度的圆角菱形线框，作为跨玩法一致的舞台标记。头像使用圆形，不增加复杂徽章。

## Components

### Buttons

- **Primary:** 行动金底、深墨字、至少 56px 高，满宽贴近底部安全区。
- **Secondary:** 透明或深色面板底，至少 44px 触控高度。
- **Hover / Focus:** 轻微提亮；键盘焦点使用可见暖金环；减少动画设置下关闭非必要过渡。

### Chips

- **Style:** 主持标记与秘密提示使用低饱和深金面和细描边，不能与主按钮争夺注意力。

### Cards / Containers

- **Background:** 房间成员与游戏列表优先使用分隔线，不堆叠独立卡片。
- **Shadow Strategy:** 常驻容器无阴影。

### Inputs / Fields

- **Style:** 面板黑底、1px 中性边框、12px 圆角、至少 52px 高。
- **Focus:** 三像素暖金焦点环，文字输入保持 16px 避免移动端自动缩放。

### Navigation

玩家页只保留返回、居中游戏名和右侧连接或主持标记；不设置底部导航栏。

### Bottom Sheet

规则、换题与主持控场统一从底部进入，最高不超过视口约八成。抽屉关闭后恢复原任务，不改变连接和玩家身份。

## Do's and Don'ts

### Do:

- **Do** 每屏只给一个明确的主要决定。
- **Do** 将主持工具与玩家主按钮分层放置。
- **Do** 保持所有触控目标至少 44×44px。
- **Do** 用文字同时表达状态，不能只依赖颜色。

### Don't:

- **Don't** 把游戏舞台做成统计仪表盘或卡片墙。
- **Don't** 同时显示多个实心金色按钮。
- **Don't** 在玩家常规视图展示其他人的私密词条、身份或任务。
- **Don't** 用渐变、玻璃拟态或装饰插画填补刻意保留的舞台负空间。
