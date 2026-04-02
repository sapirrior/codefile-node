# @sapirrior/codefile

A lightweight TypeScript tool to bundle a project directory into a single structured text file. Designed to provide comprehensive context for AI models with limited file upload capabilities and to facilitate easy project reconstruction.

## Features

- **Project Bundling**: Packs all project files (respecting `.gitignore`) into one `.txt` file.
- **Reconstruction**: Rebuilds the entire project structure from the bundle.
- **Visual Tree**: Generates a clear file structure overview in the output.
- **Binary Detection**: Automatically identifies and marks binary, empty, and symbolic link files.

## Installation

Install directly from GitHub:

```bash
npm install @sapirrior/codefile
```

## Usage

### Pack a directory
```bash
npx codefile [directory] [-o output.txt]
```

### Rebuild a project
```bash
npx codefile --build [-o CodeFile.txt]
```

## Options

- `-b, --build`: Reconstruct project from a pack file.
- `-o, --output`: Specify output path for packing or input path for building.
- `-h, --help`: Show help information.

## License
MIT
