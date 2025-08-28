import { NextRequest } from 'next/server';
import { extractFrame, addCoverImage } from '@/lib/ffmpeg-secure';
import { fileTypeFromBuffer } from 'file-type';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Enhanced rate limiting system
interface RateLimitEntry {
  requests: number;
  lastReset: number;
  blocked: boolean;
  blockUntil?: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const MAX_REQUESTS_PER_MINUTE = 10; // Per IP
const MAX_REQUESTS_PER_HOUR = 50; // Per IP
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// Concurrent request limiting (global)
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 5; // Increased from 3

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    // Remove entries that haven't been accessed in the last hour
    if (now - entry.lastReset > 60 * 60 * 1000) {
      rateLimitStore.delete(ip);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Get client IP address with fallback options
 */
function getClientIP(req: NextRequest): string {
  // Try various headers to get the real client IP
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  
  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }
  
  // Fallback to a default if no IP can be determined
  return 'unknown-ip';
}

/**
 * Check rate limit for an IP address
 */
function checkRateLimit(ip: string): { allowed: boolean; resetTime?: number; reason?: string } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || {
    requests: 0,
    lastReset: now,
    blocked: false
  };

  // Check if IP is currently blocked
  if (entry.blocked && entry.blockUntil && now < entry.blockUntil) {
    return {
      allowed: false,
      resetTime: entry.blockUntil,
      reason: 'IP temporarily blocked due to excessive requests'
    };
  }

  // Reset counters if it's been more than a minute
  if (now - entry.lastReset > 60000) {
    entry.requests = 0;
    entry.lastReset = now;
    entry.blocked = false;
    delete entry.blockUntil;
  }

  // Check rate limits
  if (entry.requests >= MAX_REQUESTS_PER_MINUTE) {
    // Block this IP for 15 minutes
    entry.blocked = true;
    entry.blockUntil = now + BLOCK_DURATION_MS;
    rateLimitStore.set(ip, entry);
    
    return {
      allowed: false,
      resetTime: entry.blockUntil,
      reason: 'Rate limit exceeded - too many requests per minute'
    };
  }

  // Allow the request and increment counter
  entry.requests++;
  rateLimitStore.set(ip, entry);
  
  return { allowed: true };
}

/**
 * Validates the content of a video file by checking its magic numbers and using file-type library.
 * @param buffer The file content as a Uint8Array.
 * @returns `true` if the file is a valid and supported video type, `false` otherwise.
 */
async function isValidVideoFile(buffer: Uint8Array): Promise<boolean> {
  // Helper to check for a sequence of bytes at a specific offset
  const bytesAt = (offset: number, sequence: number[]) => {
    if (buffer.length < offset + sequence.length) {
      return false;
    }
    return sequence.every((byte, i) => buffer[offset + i] === byte);
  };

  // First, use file-type library for more comprehensive detection
  try {
    const detectedType = await fileTypeFromBuffer(buffer);
    if (detectedType) {
      const supportedMimes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg'];
      if (supportedMimes.includes(detectedType.mime)) {
        return true;
      }
    }
  } catch (error) {
    console.warn('File type detection failed:', error);
  }

  // Fallback to manual magic number checking for additional validation
  
  // Check for MP4/MOV magic numbers ('ftyp' at offset 4)
  // ISO Base Media File Format (covers .mp4, .mov, etc.)
  if (buffer.length >= 8 && bytesAt(4, [0x66, 0x74, 0x79, 0x70])) { // 'ftyp'
    // Additional validation for common MP4 brands
    const brandBytes = Array.from(buffer.slice(8, 12));
    const validBrands = [
      [0x69, 0x73, 0x6F, 0x6D], // 'isom'
      [0x6D, 0x70, 0x34, 0x31], // 'mp41'
      [0x6D, 0x70, 0x34, 0x32], // 'mp42'
      [0x71, 0x74, 0x20, 0x20]   // 'qt  '
    ];
    
    for (const brand of validBrands) {
      if (brandBytes.every((byte, i) => byte === brand[i])) {
        return true;
      }
    }
  }

  // Check for MPEG-PS (Program Stream) pack start code
  if (buffer.length >= 4 && bytesAt(0, [0x00, 0x00, 0x01, 0xBA])) {
    return true;
  }

  // MPEG-TS (Transport Stream) validation - more thorough check
  if (buffer.length >= 376 && buffer[0] === 0x47) {
    // Check for sync bytes at regular intervals (188-byte packets)
    let validSyncBytes = 0;
    for (let i = 0; i < Math.min(buffer.length, 1880); i += 188) {
      if (buffer[i] === 0x47) {
        validSyncBytes++;
      }
    }
    // Should have at least 3 valid sync bytes for a reasonable confidence
    if (validSyncBytes >= 3) {
      return true;
    }
  }

  // AVI format check
  if (buffer.length >= 12 && 
      bytesAt(0, [0x52, 0x49, 0x46, 0x46]) && // 'RIFF'
      bytesAt(8, [0x41, 0x56, 0x49, 0x20])) { // 'AVI '
    return true;
  }

  return false;
}

export async function POST(req: NextRequest) {
  // Get client IP for rate limiting
  const clientIP = getClientIP(req);
  
  // Check IP-based rate limiting
  const rateLimitCheck = checkRateLimit(clientIP);
  if (!rateLimitCheck.allowed) {
    const response = new Response(rateLimitCheck.reason || 'Rate limit exceeded', { 
      status: 429,
      headers: {
        'Retry-After': rateLimitCheck.resetTime ? 
          Math.ceil((rateLimitCheck.resetTime - Date.now()) / 1000).toString() : 
          '900' // 15 minutes
      }
    });
    return response;
  }

  // Check global concurrent request limit
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    return new Response('Server busy, please try again later', { status: 503 });
  }

  activeRequests++;

  try {
    const data = await req.formData();
    const video = data.get('video') as File | null;
    const timestampRaw = data.get('timestamp');

    if (!video) {
      return new Response('Missing file', { status: 400 });
    }

    // Enhanced timestamp validation to prevent command injection
    if (!timestampRaw || typeof timestampRaw !== 'string') {
      return new Response('Missing or invalid timestamp', { status: 400 });
    }

    // Sanitize input - remove any non-numeric characters except decimal point
    const sanitizedTimestamp = timestampRaw.replace(/[^\d.]/g, '');
    
    // Additional validation: ensure only one decimal point and valid format
    if (!/^\d+(\.\d{1,6})?$/.test(sanitizedTimestamp)) {
      return new Response('Invalid timestamp format', { status: 400 });
    }

    // Use Number.parseFloat for stricter parsing with additional validation
    const ts = Number.parseFloat(sanitizedTimestamp);

    // Comprehensive validation - check for finite number, range, and precision
    if (!Number.isFinite(ts) || ts < 0 || ts > 86400 || ts !== ts) { // Max 24 hours, NaN check
      return new Response('Invalid timestamp range', { status: 400 });
    }

    // Additional security: ensure the parsed value matches the sanitized input
    if (ts.toString() !== sanitizedTimestamp && ts.toFixed(6).replace(/\.?0+$/, '') !== sanitizedTimestamp) {
      return new Response('Timestamp validation failed', { status: 400 });
    }

    const timestamp = ts;

  // --- Start of security validation ---
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  const ALLOWED_TYPES = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo'];
  const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.mpeg', '.mpg', '.avi'];

  if (video.size > MAX_FILE_SIZE) {
    return new Response('File too large. Maximum size is 100MB.', { status: 413 });
  }

  // Enhanced MIME type validation
  if (!ALLOWED_TYPES.includes(video.type)) {
    return new Response(`Invalid file type. Allowed types are: ${ALLOWED_TYPES.join(', ')}`, { status: 400 });
  }

  // File extension validation to prevent MIME type spoofing
  const fileExt = path.extname(video.name || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(fileExt)) {
    return new Response(`Invalid file extension. Allowed extensions are: ${ALLOWED_EXTENSIONS.join(', ')}`, { status: 400 });
  }

  const videoBuffer = Buffer.from(await video.arrayBuffer());

  // Enhanced magic number validation with file-type library
  if (!(await isValidVideoFile(videoBuffer))) {
    return new Response('Invalid or unsupported video file content.', { status: 400 });
  }
  // --- End of security validation ---

  // Enhanced filename validation and sanitization
  if (!video.name || typeof video.name !== 'string') {
    return new Response('Invalid filename', { status: 400 });
  }

  // Prevent path traversal attacks
  if (video.name.includes('..') || video.name.includes('/') || video.name.includes('\\')) {
    return new Response('Invalid filename - path traversal detected', { status: 400 });
  }

  // Strict filename sanitization - only allow safe characters
  const sanitizedFilename = video.name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 100) // Limit length
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/\.+$/, '') // Remove trailing dots
    || 'video'; // Fallback if empty after sanitization

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cover-app-'));

  // Pick an input extension that matches the MIME type to help with tooling/logs
  const extFromType: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/mpeg': 'mpg',
  };
  const inputExt = extFromType[video.type] ?? 'mp4';

  // Generate secure file paths with additional validation
  const timestamp_safe = Date.now();
  const inputPath = path.join(tempDir, `input_${timestamp_safe}.${inputExt}`);
  const coverPath = path.join(tempDir, 'cover.jpg');
  const outputPath = path.join(tempDir, 'output.mp4');

  // Validate that all paths are within the temp directory (prevent path traversal)
  if (!inputPath.startsWith(tempDir) || !coverPath.startsWith(tempDir) || !outputPath.startsWith(tempDir)) {
    return new Response('Invalid file path detected', { status: 400 });
  }



  await fs.promises.writeFile(inputPath, videoBuffer);

  try {
      // Ensure timestamp is safe for FFmpeg (additional validation)
      const safeTimestamp = Math.max(0, Math.min(timestamp, 86400));

      // Extract cover image using secure wrapper
      await extractFrame({
        input: inputPath,
        output: coverPath,
        seekTime: safeTimestamp,
        frames: 1,
        quality: 2,
        timeout: 30000
      });

      // Add cover image to video using secure wrapper
      await addCoverImage({
        videoInput: inputPath,
        imageInput: coverPath,
        output: outputPath,
        timeout: 60000
      });

    const outputFileBuffer = await fs.promises.readFile(outputPath);

    // Secure filename handling for Content-Disposition header
    const base = path.parse(sanitizedFilename).name || 'output';
    const attachmentName = `${base}_with_cover.mp4`;

    // Prevent header injection by properly escaping the filename
    const safeAttachmentName = attachmentName
      .replace(/["\r\n]/g, '') // Remove quotes and newlines
      .substring(0, 100); // Limit length

    return new Response(new Uint8Array(outputFileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${safeAttachmentName}"`,
        'Content-Length': String(outputFileBuffer.length),
        'X-Content-Type-Options': 'nosniff', // Additional security header
      },
    });
    } catch (error) {
      console.error('FFmpeg processing error:', error);

      // Return appropriate error based on error type
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          return new Response("Processing timeout", { status: 408 });
        } else if (error.message.includes('Invalid')) {
          return new Response("Invalid video format", { status: 400 });
        } else if (error.message.includes('No such file')) {
          return new Response("File processing error", { status: 400 });
        } else {
          return new Response("Processing error", { status: 500 });
        }
      } else {
        return new Response("Processing error", { status: 500 });
      }
    } finally {
      // Ensure cleanup always happens
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    }
  } finally {
    // Always decrement active requests counter
    activeRequests--;
  }
}