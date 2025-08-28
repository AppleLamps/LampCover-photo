import { spawn } from 'child_process';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import fs from 'fs';

/**
 * Secure FFmpeg wrapper to replace deprecated fluent-ffmpeg
 * Implements proper input validation and command injection prevention
 */

export interface FFmpegOptions {
  input: string;
  output: string;
  seekTime?: number;
  frames?: number;
  quality?: number;
  timeout?: number;
}

export interface FFmpegCombineOptions {
  videoInput: string;
  imageInput: string;
  output: string;
  timeout?: number;
}

/**
 * Validates file paths to prevent path traversal attacks
 */
function validatePath(filePath: string, allowedDir?: string): boolean {
  const resolvedPath = path.resolve(filePath);
  
  // Check if path contains dangerous patterns
  if (filePath.includes('..') || filePath.includes('~') || filePath.includes('$')) {
    return false;
  }
  
  // If allowedDir is specified, ensure path is within it
  if (allowedDir) {
    const resolvedAllowedDir = path.resolve(allowedDir);
    if (!resolvedPath.startsWith(resolvedAllowedDir)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Validates numeric parameters to prevent injection
 */
function validateNumeric(value: number, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Executes FFmpeg command with timeout and proper error handling
 */
function executeFFmpeg(args: string[], timeoutMs: number = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    // Validate FFmpeg binary path
    if (!ffmpegPath.path || !fs.existsSync(ffmpegPath.path)) {
      reject(new Error('FFmpeg binary not found'));
      return;
    }

    const process = spawn(ffmpegPath.path, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      process.kill('SIGKILL');
      reject(new Error('FFmpeg operation timed out'));
    }, timeoutMs);

    process.on('close', (code) => {
      clearTimeout(timeout);
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
      }
    });

    process.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`FFmpeg process error: ${error.message}`));
    });
  });
}

/**
 * Extract a frame from video at specified time
 */
export async function extractFrame(options: FFmpegOptions): Promise<void> {
  const { input, output, seekTime = 0, frames = 1, quality = 2, timeout = 30000 } = options;

  // Validate inputs
  if (!validatePath(input) || !validatePath(output)) {
    throw new Error('Invalid file paths');
  }

  if (!validateNumeric(seekTime, 0, 86400)) {
    throw new Error('Invalid seek time');
  }

  if (!validateNumeric(frames, 1, 10)) {
    throw new Error('Invalid frame count');
  }

  if (!validateNumeric(quality, 1, 31)) {
    throw new Error('Invalid quality setting');
  }

  // Check input file exists
  if (!fs.existsSync(input)) {
    throw new Error('Input file does not exist');
  }

  // Build FFmpeg arguments securely
  const args = [
    '-i', input,
    '-ss', seekTime.toString(),
    '-vframes', frames.toString(),
    '-q:v', quality.toString(),
    '-y', // Overwrite output file
    output
  ];

  await executeFFmpeg(args, timeout);
}

/**
 * Combine video with cover image
 */
export async function addCoverImage(options: FFmpegCombineOptions): Promise<void> {
  const { videoInput, imageInput, output, timeout = 60000 } = options;

  // Validate inputs
  if (!validatePath(videoInput) || !validatePath(imageInput) || !validatePath(output)) {
    throw new Error('Invalid file paths');
  }

  // Check input files exist
  if (!fs.existsSync(videoInput)) {
    throw new Error('Video input file does not exist');
  }

  if (!fs.existsSync(imageInput)) {
    throw new Error('Image input file does not exist');
  }

  // Build FFmpeg arguments securely
  const args = [
    '-i', videoInput,
    '-i', imageInput,
    '-map', '0',
    '-map', '1:v:0',
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-c:s', 'copy',
    '-c:v:1', 'mjpeg',
    '-disposition:v:1', 'attached_pic',
    '-metadata:s:v:1', 'title=Cover',
    '-y', // Overwrite output file
    output
  ];

  await executeFFmpeg(args, timeout);
}

/**
 * Get video duration (utility function)
 */
export async function getVideoDuration(inputPath: string): Promise<number> {
  if (!validatePath(inputPath)) {
    throw new Error('Invalid file path');
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error('Input file does not exist');
  }

  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-f', 'null',
      '-'
    ];

    const process = spawn(ffmpegPath.path, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', () => {
      // Parse duration from stderr
      const durationMatch = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (durationMatch) {
        const hours = parseInt(durationMatch[1]);
        const minutes = parseInt(durationMatch[2]);
        const seconds = parseFloat(durationMatch[3]);
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;
        resolve(totalSeconds);
      } else {
        reject(new Error('Could not parse video duration'));
      }
    });

    process.on('error', (error) => {
      reject(new Error(`FFmpeg process error: ${error.message}`));
    });
  });
}
