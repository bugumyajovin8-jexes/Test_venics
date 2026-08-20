import fs from 'fs';
import path from 'path';

try {
  const versionPath = path.join(process.cwd(), 'public', 'version.json');
  const timestamp = Date.now().toString();
  fs.writeFileSync(versionPath, JSON.stringify({ version: timestamp }, null, 2));
  console.log(`[Version Generator] Generated public/version.json with version ${timestamp}`);
} catch (error) {
  console.error('[Version Generator] Failed to write version.json:', error);
}
