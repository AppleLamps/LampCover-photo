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
  if (filePath.includes('..') || filePath.includes('~') || filePath.includes('$') || 
      filePath.includes('|') || filePath.includes('&') || filePath.includes(';') ||
      filePath.includes('`') || filePath.includes('(') || filePath.includes(')')) {
    return false;
  }
  
  // Check for null bytes and control characters
  if (filePath.includes('\0') || /[\x00-\x1f\x7f-\x9f]/.test(filePath)) {
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
  return Number.isFinite(value) && !Number.isNaN(value) && value >= min && value <= max && Number.isSafeInteger(value * 1000000);
}

/**
 * Sanitizes string parameters for FFmpeg to prevent command injection
 */
function sanitizeFFmpegParameter(param: string | number): string {
  if (typeof param === 'number') {
    // Ensure the number is safe and convert to string
    if (!Number.isFinite(param) || Number.isNaN(param)) {
      throw new Error('Invalid numeric parameter');
    }
    return param.toString();
  }
  
  // For string parameters, allow only safe characters
  const sanitized = param.replace(/[^a-zA-Z0-9._\-\/\\:]/g, '');
  
  // Ensure the sanitized version isn't empty and doesn't start with dangerous characters
  if (!sanitized || sanitized.startsWith('-') || sanitized.startsWith('/')) {
    throw new Error('Invalid parameter after sanitization');
  }
  
  return sanitized;
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

    // Sanitize all arguments to prevent command injection
    const sanitizedArgs = args.map((arg, index) => {
      // Skip sanitization for FFmpeg flags (odd indices after the first few)
      if (arg.startsWith('-') && (index === 0 || index % 2 === 1)) {
        // Validate that it's a known safe flag
        const safeFlags = ['-i', '-ss', '-vframes', '-q:v', '-y', '-map', '-c:v', '-c:a', '-c:s', '-c:v:1', 
                          '-disposition:v:1', '-metadata:s:v:1', '-f', '-'];
        if (!safeFlags.includes(arg)) {
          throw new Error(`Unsafe FFmpeg flag: ${arg}`);
        }
        return arg;
      }
      
      // For file paths and values, use existing validation
      return arg; // Already validated by calling functions
    });

    const process = spawn(ffmpegPath.path, sanitizedArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';

    process.stdout?.on('data', (data) => {
      // Log stdout for debugging but don't store (reduce memory usage)
      console.debug('FFmpeg stdout:', data.toString().substring(0, 200));
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

  // Validate inputs with enhanced security
  if (!validatePath(input) || !validatePath(output)) {
    throw new Error('Invalid file paths');
  }

  // Enhanced numeric validation with safer bounds
  if (!validateNumeric(seekTime, 0, 86400)) { // Max 24 hours
    throw new Error('Invalid seek time - must be between 0 and 86400 seconds');
  }

  if (!validateNumeric(frames, 1, 10)) {
    throw new Error('Invalid frame count - must be between 1 and 10');
  }

  if (!validateNumeric(quality, 1, 31)) {
    throw new Error('Invalid quality setting - must be between 1 and 31');
  }

  if (!validateNumeric(timeout, 1000, 300000)) { // 1 second to 5 minutes
    throw new Error('Invalid timeout - must be between 1000 and 300000 ms');
  }

  // Check input file exists and is readable
  if (!fs.existsSync(input)) {
    throw new Error('Input file does not exist');
  }

  try {
    await fs.promises.access(input, fs.constants.R_OK);
  } catch {
    throw new Error('Input file is not readable');
  }

  // Build FFmpeg arguments securely with additional validation
  const args = [
    '-i', input,
    '-ss', Math.floor(seekTime * 1000000) / 1000000, // Limit precision to prevent injection
    '-vframes', frames,
    '-q:v', quality,
    '-y', // Overwrite output file
    output
  ].map(arg => arg.toString());

  await executeFFmpeg(args, timeout);
}

/**
 * Combine video with cover image
 */
export async function addCoverImage(options: FFmpegCombineOptions): Promise<void> {
  const { videoInput, imageInput, output, timeout = 60000 } = options;

  // Validate inputs with enhanced security
  if (!validatePath(videoInput) || !validatePath(imageInput) || !validatePath(output)) {
    throw new Error('Invalid file paths');
  }

  if (!validateNumeric(timeout, 1000, 600000)) { // 1 second to 10 minutes
    throw new Error('Invalid timeout - must be between 1000 and 600000 ms');
  }

  // Check input files exist and are readable
  const inputFiles = [videoInput, imageInput];
  for (const file of inputFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(`Input file does not exist: ${path.basename(file)}`);
    }
    
    try {
      await fs.promises.access(file, fs.constants.R_OK);
    } catch {
      throw new Error(`Input file is not readable: ${path.basename(file)}`);
    }
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
