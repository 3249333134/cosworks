const s = require('fs').readFileSync('src/App.tsx','utf8');
console.log('File length:', s.length);

// 检查之前的小修改是否还在
console.log('Has tags:string[] in API:', s.includes('tags:string[]'));
console.log('Has data.tags:', s.includes('data.tags'));
console.log('Has roles[0].ipTheme:', s.includes('roles[0].ipTheme'));

// 找脚本加的损坏代码
const homeIdx = s.indexOf('常用角色');
console.log('Has cursor pointer in Home (idx=' + homeIdx + '):', s.indexOf('cursor', homeIdx, 500));

// 找到损坏位置
const badRegion = s.indexOf("roleId={role.id}");
console.log('Bad region roleId:', badRegion);

// 检查 FIX 3 是否损坏了
const fix3Idx = s.indexOf('refreshRoles');
console.log('Has refreshRoles call:', fix3Idx >= 0);

// 尝试用 tsc 精确错误
try {
  execSync('npx tsc --pretty false 2>&1', {encoding: 'utf8'});
} catch(e) {
  const lines = e.stderr.split('\n').filter(l => l.includes('error') || l.includes('App.tsx'));
  console.log('\nFirst 15 errors:');
  lines.slice(0, 15).forEach(l => console.log(' ', l.trim()));
}
