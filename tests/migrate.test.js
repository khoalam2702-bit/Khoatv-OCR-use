const vm=require('vm'),fs=require('fs'),assert=require('assert');
const ctx={console};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','backend_gas','Code.js'),'utf8'),ctx);
// Sheet giả: 1 dòng tiêu đề cũ (5 cột hệ thống + trường CCCD) và 1 dòng dữ liệu
const oldHeaders=['scan_timestamp','document_type','raw_file_url','raw_file_id','scanned_by','so_cccd','ho_ten','ngay_sinh','gioi_tinh','quoc_tich','que_quan','noi_thuong_tru','ngay_cap','ngay_het_han'];
const grid=[oldHeaders.slice(),oldHeaders.map((h,i)=>'v'+i)];
const sh={getLastRow:()=>grid.length,getLastColumn:()=>grid[0].length,getMaxRows:()=>1000,
 getRange:(r,c,nr=1,nc=1)=>({getDisplayValues:()=>[grid[r-1].slice(c-1,c-1+nc)],setValue(v){grid[r-1][c-1]=v;return this},setFontWeight(){return this}}),
 insertColumnBefore:(c)=>grid.forEach(row=>row.splice(c-1,0,''))};
const ss={getSheetByName:()=>sh};
ctx.__ss=ss;
vm.runInContext("sheet_(__ss,'CCCD',typeHeaders_(DOC_TYPES.CCCD))",ctx);
const want=vm.runInContext("typeHeaders_(DOC_TYPES.CCCD)",ctx);
assert.strictEqual(JSON.stringify(grid[0]),JSON.stringify(want));
assert.deepStrictEqual(grid[1].slice(0,5),['v0','v1','v2','v3','v4']);
assert.deepStrictEqual(grid[1].slice(5,7),['','']);
assert.strictEqual(grid[1][7],'v5');
console.log('migration OK:',grid[0].slice(4,9).join(','));
