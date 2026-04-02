import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { BINARY_THRESHOLD } from '../constants.js';
/**
 * Detects if a file is binary based on its content.
 */
export async function isBinary(filePath) {
    try {
        const handle = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(BINARY_THRESHOLD);
        const { bytesRead } = await handle.read(buffer, 0, BINARY_THRESHOLD, 0);
        await handle.close();
        if (bytesRead === 0)
            return false;
        const chunk = buffer.subarray(0, bytesRead);
        // Early null byte check
        for (let i = 0; i < bytesRead; i++) {
            if (chunk[i] === 0)
                return true;
        }
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(chunk);
            return false;
        }
        catch {
            // ignore
        }
        let highBytes = 0;
        for (let i = 0; i < bytesRead; i++) {
            if (chunk[i] > 127)
                highBytes++;
        }
        return (highBytes / bytesRead) > 0.30;
    }
    catch {
        return true;
    }
}
/**
 * Generates a SHA-256 hash of a file's content.
 */
export async function hashFile(filePath) {
    const hash = createHash('sha256');
    try {
        const stream = createReadStream(filePath);
        for await (const chunk of stream) {
            hash.update(chunk);
        }
    }
    catch {
        return "error0000000";
    }
    return hash.digest('hex').substring(0, 12);
}
