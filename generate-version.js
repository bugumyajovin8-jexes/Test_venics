import fs from 'fs';
import path from 'path';

try {
  const versionPath = path.join(process.cwd(), 'public', 'version.json');
  const timestamp = Date.now().toString();
  
  // Ensure the directory exists (just in case)
  const dir = path.dirname(versionPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(versionPath, JSON.stringify({ version: timestamp }, null, 2));
  console.log(`[Version Generator] Generated public/version.json with version ${timestamp}`);
} catch (error) {
  console.error('[Version Generator] Failed to write version.json:', error);
}
