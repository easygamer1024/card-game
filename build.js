const fs = require('fs');
const path = require('path');

console.log('=== 开始构建 ===');

// 确保 public 目录存在
if (!fs.existsSync('public')) {
  fs.mkdirSync('public');
  console.log('创建 public 目录');
}

// 清空 public 目录（保留 .gitkeep）
const files = fs.readdirSync('public');
files.forEach(file => {
  if (file !== '.gitkeep') {
    fs.unlinkSync(path.join('public', file));
  }
});

// 直接复制文件 - 简化逻辑
const filesToCopy = ['index.html', 'manifest.json', 'health.json'];
let successCount = 0;

filesToCopy.forEach(filename => {
  try {
    if (fs.existsSync(filename)) {
      const sourceContent = fs.readFileSync(filename, 'utf8');
      fs.writeFileSync(path.join('public', filename), sourceContent);
      console.log(`✅ 已复制: ${filename}`);
      successCount++;
    } else {
      console.log(`❌ 文件不存在: ${filename}`);
    }
  } catch (error) {
    console.log(`❌ 复制失败 ${filename}:`, error.message);
  }
});

console.log(`=== 构建完成: ${successCount}/${filesToCopy.length} 个文件 ===`);

// 验证文件大小
filesToCopy.forEach(filename => {
  const destPath = path.join('public', filename);
  if (fs.existsSync(destPath)) {
    const stats = fs.statSync(destPath);
    console.log(`📄 ${filename}: ${stats.size} bytes`);
  }
});