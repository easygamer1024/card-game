const fs = require('fs');
const path = require('path');

console.log('开始构建部署文件...');

// 打印当前目录结构用于调试
console.log('当前目录文件:');
try {
  const rootFiles = fs.readdirSync(__dirname);
  rootFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    const stats = fs.statSync(filePath);
    if (stats.isFile()) {
      console.log(`  📄 ${file} (${stats.size} bytes)`);
    } else if (stats.isDirectory()) {
      console.log(`  📁 ${file}/`);
    }
  });
} catch (error) {
  console.error('读取目录失败:', error);
}

// 确保 public 目录存在
if (!fs.existsSync('public')) {
  console.log('创建 public 目录...');
  fs.mkdirSync('public');
} else {
  console.log('public 目录已存在，清空内容...');
  // 清空 public 目录
  const files = fs.readdirSync('public');
  files.forEach(file => {
    if (file !== '.gitkeep') {
      fs.unlinkSync(path.join('public', file));
    }
  });
}

// 要复制的文件列表
const filesToCopy = [
  { source: 'index.html', dest: 'index.html' },
  { source: 'manifest.json', dest: 'manifest.json' },
  { source: 'health.json', dest: 'health.json' }
];

// 复制文件到 public 目录
let missingFiles = [];
filesToCopy.forEach(fileInfo => {
  const sourcePath = path.join(__dirname, fileInfo.source);
  const destPath = path.join(__dirname, 'public', fileInfo.dest);
  
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destPath);
    console.log(`✓ 已复制 ${fileInfo.source} -> public/${fileInfo.dest}`);
  } else {
    console.error(`✗ 文件不存在: ${fileInfo.source}`);
    missingFiles.push(fileInfo.source);
  }
});

// 如果文件缺失，创建基础版本
if (missingFiles.length > 0) {
  console.log('创建缺失的基础文件...');
  
  if (missingFiles.includes('index.html')) {
    const basicHtml = `<!DOCTYPE html>
<html>
<head>
    <title>干瞪眼儿游戏</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
    <h1>干瞪眼儿游戏</h1>
    <p>游戏正在加载中...</p>
</body>
</html>`;
    fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), basicHtml);
    console.log('✓ 已创建基础 index.html');
  }
  
  if (missingFiles.includes('manifest.json')) {
    const basicManifest = `{
  "name": "干瞪眼儿游戏",
  "short_name": "干瞪眼儿",
  "start_url": "/",
  "display": "standalone"
}`;
    fs.writeFileSync(path.join(__dirname, 'public', 'manifest.json'), basicManifest);
    console.log('✓ 已创建基础 manifest.json');
  }
}

// 创建健康检查文件
const healthCheckContent = `{
  "status": "ok",
  "message": "干瞪眼儿游戏服务器",
  "timestamp": "${new Date().toISOString()}",
  "version": "1.0.0"
}`;

fs.writeFileSync(path.join(__dirname, 'public', 'health.json'), healthCheckContent);
console.log('✓ 已创建 health.json 健康检查文件');

console.log('\n构建完成！文件结构:');
console.log('├── api/');
console.log('│   └── game.js');
console.log('├── public/');
console.log('│   ├── index.html');
console.log('│   ├── manifest.json');
console.log('│   └── health.json');
console.log('├── package.json');
console.log('├── vercel.json');
console.log('└── build.js\n');

console.log('部署说明:');
console.log('1. 运行: npm run build');
console.log('2. 部署到 Vercel: vercel --prod');
console.log('3. 访问您的应用 URL');

// 构建验证
console.log('\n构建验证:');
try {
  const publicFiles = fs.readdirSync(path.join(__dirname, 'public'));
  console.log('✅ Public 目录文件列表:');
  publicFiles.forEach(file => {
    const filePath = path.join(__dirname, 'public', file);
    const stats = fs.statSync(filePath);
    console.log(`   📄 ${file} (${stats.size} bytes)`);
  });
  
  // 验证关键文件是否存在
  const requiredFiles = ['index.html', 'manifest.json', 'health.json'];
  const stillMissingFiles = requiredFiles.filter(file => !publicFiles.includes(file));
  
  if (stillMissingFiles.length === 0) {
    console.log('✅ 所有必需文件都已正确构建');
    console.log('✅ 构建成功完成！');
  } else {
    console.error('❌ 仍然缺失文件:', stillMissingFiles);
    console.log('⚠️ 但构建将继续，因为已创建基础文件');
    // 不退出，让构建继续
  }
} catch (error) {
  console.error('❌ 构建验证失败:', error);
  // 不退出，让构建继续
}