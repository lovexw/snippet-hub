-- Snippet Hub · D1 表结构
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, ts);

-- 初始欢迎条目（items 为整包 JSON，与 PUT /api/items 的数组语义一致）
INSERT OR IGNORE INTO kv (key, value) VALUES ('items', '[
  {
    "id": "welcome",
    "type": "note",
    "title": "欢迎使用 Snippet Hub",
    "content": "这是你的 Cloudflare Workers + D1 私有实例，数据存在 D1 数据库里。\n\n1. 点击卡片右下角 ⧉ 一键复制全文\n2. 星标 = 常用，排在最前\n3. ⌘K 或 / 快速搜索\n4. 左下角可导出 JSON 备份",
    "tags": ["说明"],
    "fav": false,
    "createdAt": 1758000000000,
    "updatedAt": 1758000000000
  }
]');
