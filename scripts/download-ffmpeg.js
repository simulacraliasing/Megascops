// scripts/download-ffmpeg.js
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';
import os from 'os';
import { createWriteStream, unlinkSync, statSync, readdirSync, copyFileSync } from 'fs';
import { promisify } from 'util';
import stream from 'stream';
import { fileURLToPath } from 'url';
import fs from 'fs';

const pipeline = promisify(stream.pipeline);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ffmpegDir = path.join(__dirname, '..', 'src-tauri', 'binaries');

// Create directory if it doesn't exist
if (!fs.existsSync(ffmpegDir)) {
    fs.mkdirSync(ffmpegDir, { recursive: true });
}

// Platform-specific directories
const windowsDir = path.join(ffmpegDir);
const macosDir = path.join(ffmpegDir);
const linuxDir = path.join(ffmpegDir);

// Create platform directories
[windowsDir, macosDir, linuxDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Determine platform-specific download URL
function getFFmpegInfo() {
    const platform = process.platform;

    if (platform === 'win32') {
        return {
            url: 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-7.1.1-essentials_build.zip',
            outputPath: path.join(ffmpegDir, 'ffmpeg-windows.zip'),
            extractDir: windowsDir
        };
    } else if (platform === 'darwin') {
        return {
            url: 'https://evermeet.cx/ffmpeg/getrelease/zip',
            outputPath: path.join(ffmpegDir, 'ffmpeg-macos.zip'),
            extractDir: macosDir
        };
    } else if (platform === 'linux') {
        return {
            url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
            outputPath: path.join(ffmpegDir, 'ffmpeg-linux.tar.xz'),
            extractDir: linuxDir
        };
    } else {
        throw new Error(`Unsupported platform: ${platform}`);
    }
}

// Download file from URL
async function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        const file = createWriteStream(outputPath);

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(outputPath, () => { });
            reject(err);
        });
    });
}

// Extract the downloaded file
async function extractFile(filePath, extractDir, platform) {
    console.log(`Extracting to ${extractDir}...`);

    if (platform === 'win32') {
        // For Windows, we need to use a library to extract zip files
        // You can use a library like 'extract-zip' or 'unzipper'
        // For simplicity, we'll use 7zip if available, or fallback to PowerShell
        try {
            execSync(`powershell -command "Expand-Archive -Path '${filePath}' -DestinationPath '${extractDir}' -Force"`);

            // Find the ffmpeg.exe in the extracted directory
            const ffmpegExe = findFileRecursive(extractDir, 'ffmpeg.exe');
            if (ffmpegExe) {
                // Move ffmpeg.exe to the root of the windows directory
                copyFileSync(ffmpegExe, path.join(windowsDir, 'ffmpeg-x86_64-pc-windows-msvc.exe'));
                console.log('Copied ffmpeg.exe to windows directory');
            } else {
                throw new Error('Could not find ffmpeg.exe in extracted files');
            }
        } catch (err) {
            console.error('Error extracting with PowerShell:', err);
            throw err;
        }
    } else if (platform === 'darwin') {
        try {
            execSync(`unzip -o "${filePath}" -d "${extractDir}"`);

            // macOS typically has the ffmpeg binary directly in the zip
            const ffmpegBin = findFileRecursive(extractDir, 'ffmpeg');
            if (ffmpegBin) {
                copyFileSync(ffmpegBin, path.join(macosDir, 'ffmpeg-aarch64-apple-darwin'));
                console.log('Copied ffmpeg to macos directory');

                // Make executable
                execSync(`chmod +x "${path.join(macosDir, 'ffmpeg-aarch64-apple-darwin')}"`);
            } else {
                throw new Error('Could not find ffmpeg binary in extracted files');
            }
        } catch (err) {
            console.error('Error extracting with unzip:', err);
            throw err;
        }
    } else if (platform === 'linux') {
        // For Linux, we need to use tar to extract the .tar.xz file
        try {
            execSync(`tar -xf "${filePath}" -C "${extractDir}"`);

            // Find the ffmpeg binary in the extracted directory
            const ffmpegBin = findFileRecursive(extractDir, 'ffmpeg');
            if (ffmpegBin) {
                copyFileSync(ffmpegBin, path.join(linuxDir, 'ffmpeg-x86_64-unknown-linux-gnu'));
                console.log('Copied ffmpeg to linux directory');

                // Make executable
                execSync(`chmod +x "${path.join(linuxDir, 'ffmpeg-x86_64-unknown-linux-gnu')}"`);
            } else {
                throw new Error('Could not find ffmpeg binary in extracted files');
            }
        } catch (err) {
            console.error('Error extracting with tar:', err);
            throw err;
        }
    }
}

// Helper function to find a file recursively
function findFileRecursive(dir, filename) {
    const files = readdirSync(dir);

    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = statSync(filePath);

        if (stat.isDirectory()) {
            const found = findFileRecursive(filePath, filename);
            if (found) return found;
        } else if (file === filename) {
            return filePath;
        }
    }

    return null;
}

// Clean up temporary files
function cleanUp(filePath) {
    try {
        unlinkSync(filePath);
        console.log(`Cleaned up temporary file: ${filePath}`);
    } catch (err) {
        console.error(`Failed to clean up ${filePath}:`, err);
    }
}

// Download and extract FFmpeg
async function downloadFFmpeg() {
    const platform = process.platform;
    const { url, outputPath, extractDir } = getFFmpegInfo();

    try {
        console.log(`Downloading FFmpeg for ${platform} from ${url}...`);
        await downloadFile(url, outputPath);
        console.log('Download complete!');

        await extractFile(outputPath, extractDir, platform);
        console.log('Extraction complete!');

        // Clean up the downloaded archive
        cleanUp(outputPath);

        console.log('FFmpeg has been successfully installed for your platform!');
    } catch (error) {
        console.error('Error downloading or extracting FFmpeg:', error);
        process.exit(1);
    }
}

// Run the download process
downloadFFmpeg();
