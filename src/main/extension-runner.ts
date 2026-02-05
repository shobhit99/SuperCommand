/**
 * Extension Runner
 *
 * Discovers installed community extensions, builds their commands
 * with esbuild, and returns the bundled code for the renderer.
 *
 * Build strategy:
 *   - esbuild bundles each command entry to CJS
 *   - react, react-dom, @raycast/api are kept external
 *   - The renderer provides these modules at runtime via a custom require()
 */

import { app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface ExtensionCommandInfo {
  id: string;
  title: string;
  extName: string;
  cmdName: string;
  description: string;
  mode: string;
  keywords: string[];
  iconDataUrl?: string;
}

// ─── Paths ──────────────────────────────────────────────────────────

function getExtensionsDir(): string {
  return path.join(app.getPath('userData'), 'extensions');
}

function getBuildDir(extName: string): string {
  const dir = path.join(getExtensionsDir(), extName, '.sc-build');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ─── Icon extraction ────────────────────────────────────────────────

function getExtensionIconDataUrl(
  extPath: string,
  iconFile: string
): string | undefined {
  const candidates = [
    path.join(extPath, 'assets', iconFile),
    path.join(extPath, iconFile),
  ];

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const ext = path.extname(p).toLowerCase();
      const data = fs.readFileSync(p);
      if (data.length < 50) continue;
      const mime =
        ext === '.svg'
          ? 'image/svg+xml'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : 'image/png';
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch {}
  }
  return undefined;
}

// ─── Discovery ──────────────────────────────────────────────────────

/**
 * Scan installed extensions directory and return a flat list of
 * commands that should appear in the launcher.
 */
export function discoverInstalledExtensionCommands(): ExtensionCommandInfo[] {
  const extDir = getExtensionsDir();
  if (!fs.existsSync(extDir)) return [];

  const results: ExtensionCommandInfo[] = [];

  for (const dir of fs.readdirSync(extDir)) {
    const extPath = path.join(extDir, dir);
    const pkgPath = path.join(extPath, 'package.json');

    try {
      if (!fs.statSync(extPath).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!fs.existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const iconDataUrl = getExtensionIconDataUrl(
        extPath,
        pkg.icon || 'icon.png'
      );

      for (const cmd of pkg.commands || []) {
        if (!cmd.name) continue;
        results.push({
          id: `ext-${dir}-${cmd.name}`,
          title: cmd.title || cmd.name,
          extName: dir,
          cmdName: cmd.name,
          description: cmd.description || '',
          mode: cmd.mode || 'view',
          keywords: [
            dir,
            pkg.title || '',
            cmd.name,
            cmd.title || '',
            cmd.description || '',
          ]
            .filter(Boolean)
            .map((s: string) => s.toLowerCase()),
          iconDataUrl,
        });
      }
    } catch {}
  }

  return results;
}

// ─── Build ──────────────────────────────────────────────────────────

/**
 * Resolve the source entry file for a given command.
 */
function resolveEntryFile(extPath: string, cmdName: string): string | null {
  const candidates = [
    path.join(extPath, 'src', `${cmdName}.tsx`),
    path.join(extPath, 'src', `${cmdName}.ts`),
    path.join(extPath, 'src', `${cmdName}.jsx`),
    path.join(extPath, 'src', `${cmdName}.js`),
    path.join(extPath, 'src', 'index.tsx'),
    path.join(extPath, 'src', 'index.ts'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Build an extension command using esbuild and return the JS bundle.
 * Returns null on failure.
 */
export async function buildExtensionCommand(
  extName: string,
  cmdName: string
): Promise<string | null> {
  const extPath = path.join(getExtensionsDir(), extName);
  if (!fs.existsSync(extPath)) return null;

  const entryFile = resolveEntryFile(extPath, cmdName);
  if (!entryFile) {
    console.error(
      `No entry file found for extension ${extName}/${cmdName}`
    );
    return null;
  }

  const outFile = path.join(getBuildDir(extName), `${cmdName}.js`);

  // Use cached build if entry hasn't changed
  if (fs.existsSync(outFile)) {
    try {
      const srcMtime = fs.statSync(entryFile).mtime;
      const outMtime = fs.statSync(outFile).mtime;
      if (outMtime > srcMtime) {
        return fs.readFileSync(outFile, 'utf-8');
      }
    } catch {}
  }

  try {
    // Use esbuild programmatic API
    const esbuild = require('esbuild');

    await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      outfile: outFile,
      external: [
        'react',
        'react-dom',
        '@raycast/api',
        '@raycast/utils',
      ],
      target: 'es2020',
      jsx: 'automatic',
      jsxImportSource: 'react',
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      logLevel: 'silent',
    });

    if (fs.existsSync(outFile)) {
      return fs.readFileSync(outFile, 'utf-8');
    }
  } catch (e) {
    console.error(`esbuild failed for ${extName}/${cmdName}:`, e);
  }

  return null;
}

/**
 * Get or build an extension command bundle.
 */
export async function getExtensionBundle(
  extName: string,
  cmdName: string
): Promise<{ code: string; title: string } | null> {
  const code = await buildExtensionCommand(extName, cmdName);
  if (!code) return null;

  // Read command title from package.json
  let title = cmdName;
  try {
    const pkgPath = path.join(getExtensionsDir(), extName, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const cmd = (pkg.commands || []).find((c: any) => c.name === cmdName);
    if (cmd?.title) title = cmd.title;
  } catch {}

  return { code, title };
}

