// Ergaenzt das von Capacitor erzeugte Android-Projekt um unsere Teile:
// nativer Netzwerk-Baustein, App-Symbol, fester Test-Schluessel, Einstellungen.
// Aufruf nach "npx cap add android": node scripts/prepare-android.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlay = path.join(root, 'android-overlay');
const app = path.join(root, 'android', 'app');
const main = path.join(app, 'src', 'main');

function patch(file, anchor, replacement) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes(replacement)) return;
  if (!text.includes(anchor)) throw new Error('Stelle nicht gefunden in ' + file + ': ' + anchor);
  fs.writeFileSync(file, text.replace(anchor, replacement));
}

// Java-Dateien
const javaDir = path.join(main, 'java', 'de', 'kalendertodos', 'app');
for (const f of fs.readdirSync(path.join(overlay, 'java'))) fs.copyFileSync(path.join(overlay, 'java', f), path.join(javaDir, f));

// Symbole und Farben
fs.cpSync(path.join(overlay, 'res'), path.join(main, 'res'), { recursive: true });

// Fester Schluessel, damit sich neue Testversionen ueber die alte installieren lassen
fs.copyFileSync(path.join(overlay, 'test-keystore.jks'), path.join(app, 'test-keystore.jks'));

// Auch Nextcloud-Server ohne https (z. B. im Heimnetz) erlauben
patch(path.join(main, 'AndroidManifest.xml'), '<application\n', '<application\n        android:usesCleartextTraffic="true"\n');

const gradle = path.join(app, 'build.gradle');
patch(
  gradle,
  '    buildTypes {',
  "    signingConfigs {\n        debug {\n            storeFile file('test-keystore.jks')\n            storePassword 'android'\n            keyAlias 'test'\n            keyPassword 'android'\n        }\n    }\n    buildTypes {"
);
patch(
  gradle,
  "    implementation project(':capacitor-android')",
  "    implementation project(':capacitor-android')\n    implementation 'com.squareup.okhttp3:okhttp:4.12.0'"
);

console.log('Android-Projekt vorbereitet.');
