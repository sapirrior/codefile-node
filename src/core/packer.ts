import { promises as fs, createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { GitignoreParser } from './gitignore.js';
import { isBinary, hashFile } from '../utils/file.js';
import { buildTree } from '../utils/tree.js';
import { o, g, err } from '../utils/logger.js';

export async function pack(root: string, outPath: string, scriptPath: string) {
    const gi = new GitignoreParser(root);
    const outResolved = path.resolve(outPath);
    const scriptResolved = path.resolve(scriptPath);

    const packed: Array<{ fp: string, rel: string }> = [];
    let totalBytes = 0;
    let skippedCount = 0;

    process.stdout.write(o(`Scanning: ${path.basename(root)}/\n`));

    async function walkDir(currentDir: string) {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fp = path.join(currentDir, entry.name);
            const rel = path.relative(root, fp).split(path.sep).join('/');

            if (entry.name === '.git') continue;

            if (gi.isIgnored(fp)) {
                skippedCount++;
                continue;
            }

            if (path.resolve(fp) === outResolved || path.resolve(fp) === scriptResolved) {
                skippedCount++;
                continue;
            }

            if (entry.isSymbolicLink()) {
                packed.push({ fp, rel });
                continue;
            }

            if (entry.isDirectory()) {
                await walkDir(fp);
                continue;
            }

            if (entry.isFile()) {
                const stats = await fs.stat(fp);
                totalBytes += stats.size;
                packed.push({ fp, rel });
            } else {
                skippedCount++;
            }
        }
    }

    await walkDir(root);

    process.stdout.write(g(`Packing ${packed.length} files (${(totalBytes / (1024 * 1024)).toFixed(2)} MB source), ${skippedCount} skipped.\n`));

    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const treeStr = buildTree(path.basename(root), packed.map(p => p.rel));

    const outStream = createWriteStream(outPath, { encoding: 'utf8' });
    
    const write = (data: string) => new Promise<void>((resolve, reject) => {
        if (!outStream.write(data)) {
            outStream.once('drain', resolve);
        } else {
            process.nextTick(resolve);
        }
    });

    await write(`ROOT_NAME ${path.basename(root)}\n`);
    await write(`CREATED_UTC ${timestamp}\n`);
    await write(`TOTAL_SOURCE_MB ${(totalBytes / (1024 * 1024)).toFixed(2)}\n`);
    await write(`FILE_COUNT ${packed.length}\n\n`);
    await write(`START_STRUCTURE\n${treeStr}\nEND_STRUCTURE\n\n`);

    let writeErrors = 0;
    for (const { fp, rel } of packed) {
        try {
            const stats = await fs.lstat(fp);
            if (stats.isSymbolicLink()) {
                const fid = "symlink00000";
                await write(`FILE_START ${rel} ${fid}\n`);
                await write("SYMLINK_CONTENT");
                await write(`\nFILE_END ${rel} ${fid}\n\n`);
                continue;
            }

            const size = stats.size;
            if (size === 0) {
                const fid = "empty000000";
                await write(`FILE_START ${rel} ${fid}\n`);
                await write("EMPTY_CONTENT");
                await write(`\nFILE_END ${rel} ${fid}\n\n`);
                continue;
            }

            if (await isBinary(fp)) {
                const fid = await hashFile(fp);
                await write(`FILE_START ${rel} ${fid}\n`);
                await write("BINARY_CONTENT");
                await write(`\nFILE_END ${rel} ${fid}\n\n`);
                continue;
            }

            const fid = await hashFile(fp);
            await write(`FILE_START ${rel} ${fid}\n`);
            const content = await fs.readFile(fp, 'utf8');
            await write(content);
            await write(`\nFILE_END ${rel} ${fid}\n\n`);

        } catch (e) {
            err(`Warning: skipped ${rel}: ${e}`);
            writeErrors++;
        }
    }

    outStream.end();
    await new Promise((resolve) => outStream.on('finish', resolve));

    const outStats = await fs.stat(outPath);
    let msg = o(`Done. ${path.basename(outPath)} written (${(outStats.size / (1024 * 1024)).toFixed(2)} MB).`);
    if (writeErrors) {
        msg += " " + g(`${writeErrors} file(s) had read errors.`);
    }
    process.stdout.write(msg + '\n');
}
