# 文镜 · 智能扫描

一个本地优先的移动端文档扫描 PWA。它提供与常见文档扫描应用相似的核心工作流，但不复制任何第三方品牌、界面或专有资源。

在线使用：<https://zhenjb168.github.io/wenjing-scanner/>

## 已实现

- 调用手机后置摄像头拍照，或批量导入相册图片
- 保守型文档边缘检测与自动裁边
- 原色、增强灰度、黑白三种滤镜
- 页面旋转、追加、缩略图切换与删除
- 中英文设备端 OCR，结果可编辑、复制并参与全文搜索
- 多页 A4 PDF 本地生成与下载
- IndexedDB 本地文档库
- 可安装 PWA 与离线应用外壳
- iPhone/iPad 主屏幕图标与 Mac Dock 安装指引
- 桌面、平板和手机响应式界面

## 本地运行

```bash
npm install
npm run dev
```

生产构建与预览：

```bash
npm run build
npm run preview
```

浏览器打开 `http://localhost:4173`。手机访问电脑显示的局域网地址时，摄像头通常要求 HTTPS；部署到 HTTPS 站点后可正常使用拍照入口。

### 安装到苹果设备

- iPhone / iPad：用 Safari 打开 HTTPS 地址，点击“分享 → 添加到主屏幕”。
- Mac：用 Safari 打开 HTTPS 地址，选择“文件 → 添加到程序坞”；Chrome 也支持从地址栏安装。
- 两台设备会各自保存一份本地文档库，目前不会自动同步。

## 隐私

图片、OCR 结果和文档元数据默认保存在浏览器 IndexedDB 中。图片处理与 PDF 生成在本机完成。首次使用 OCR 时，Tesseract.js 会下载所选语言模型，识别过程在设备端执行。

## 当前边界

- 自动裁边使用保守的矩形边缘投影算法，不包含任意四边形透视拉正。
- 尚未实现账号同步、云备份、电子签名、批注和订阅支付。
- 原生 iOS 打包需要安装完整 Xcode；当前机器只有 Command Line Tools。
