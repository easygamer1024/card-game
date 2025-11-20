const fs = require('fs');
const path = require('path');

console.log('开始构建部署文件...');

// 确保 public 目录存在
if (!fs.existsSync('public')) {
  console.log('创建 public 目录...');
  fs.mkdirSync('public');
} else {
  console.log('public 目录已存在，清空内容...');
  // 清空 public 目录
  const files = fs.readdirSync('public');
  files.forEach(file => {
    if (file !== '.gitkeep') { // 保留 .gitkeep 文件
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
filesToCopy.forEach(fileInfo => {
  const sourcePath = path.join(__dirname, fileInfo.source);
  const destPath = path.join(__dirname, 'public', fileInfo.dest);
  
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destPath);
    console.log(`✓ 已复制 ${fileInfo.source} -> public/${fileInfo.dest}`);
  } else {
    console.error(`✗ 文件不存在: ${fileInfo.source}`);
  }
});

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
  const missingFiles = requiredFiles.filter(file => !publicFiles.includes(file));
  
  if (missingFiles.length === 0) {
    console.log('✅ 所有必需文件都已正确构建');
    console.log('✅ 构建成功完成！');
  } else {
    console.error('❌ 缺失文件:', missingFiles);
    process.exit(1);
  }
} catch (error) {
  console.error('❌ 构建验证失败:', error);
  process.exit(1);
}