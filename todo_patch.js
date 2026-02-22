const fs = require('fs');
let caps = JSON.parse(fs.readFileSync('src-tauri/capabilities/default.json', 'utf8'));

const required = [
  "core:window:allow-create",
  "core:webview:allow-create-webview-window",
  "core:window:allow-set-focus",
  "core:window:allow-outer-position", 
  "core:window:allow-outer-size",
];

for(const p of required) {
  if (!caps.permissions.includes(p)) caps.permissions.push(p);
}

fs.writeFileSync('src-tauri/capabilities/default.json', JSON.stringify(caps, null, 2));
