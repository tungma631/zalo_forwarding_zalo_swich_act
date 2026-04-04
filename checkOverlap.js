const fs = require('fs');
const path = require('path');
const accountsPath = path.join(process.env.APPDATA, 'antigravity_zalo', 'accounts');
const a = JSON.parse(fs.readFileSync(path.join(accountsPath, 'acc_1775272208781', 'groups.json')));
const b = JSON.parse(fs.readFileSync(path.join(accountsPath, 'acc_1775272381082', 'groups.json')));

let c = 0;
for(const gA of a) {
  const m = b.find(gB => gB.name === gA.name);
  if (m) {
    console.log('Tên chung:', gA.name);
    console.log('  Acc1 ID:', gA.id);
    console.log('  Acc2 ID:', m.id);
    console.log('  Giống nhau ID?:', gA.id === m.id);
    c++;
  }
}
console.log('Tổng số nhóm chung TÊN:', c);
