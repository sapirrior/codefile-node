/**
 * Detects if a file is binary based on its content.
 */
export declare function isBinary(filePath: string): Promise<boolean>;
/**
 * Generates a SHA-256 hash of a file's content.
 */
export declare function hashFile(filePath: string): Promise<string>;
